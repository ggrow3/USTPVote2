import { createHash, randomBytes } from 'node:crypto';
import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Put,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Collections,
  DISCORD_LINK_PATH,
  DISCORD_LINK_STATE_MINUTES,
  discordAuthorizeUrl,
  discordCelebrateSchema,
  discordLinkSchema,
  discordLinkView,
  discordRedirectUri,
  discordRolesSet,
  newDiscordLink,
  type DiscordAppState,
  type DiscordCelebrateInput,
  type DiscordLinkBlocker,
  type DiscordLinkInput,
  type DiscordLinkRecord,
  type DiscordLinksSummary,
  type DiscordLinkStart,
  type DiscordLinkStateRecord,
  type DiscordLinkView,
} from 'ustp-domain';
import { ApiKeys } from '../api-keys/api-keys.js';
import { Ctx, requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { DISCORD_API, STUB_APPLICATION, stubSignInCode, type DiscordApi } from './discord-api.js';
import { DiscordSettingsService } from './discord-settings.js';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * The records of linked Discord accounts (design §10.18, "Linking"), for the contexts that only need to end a link:
 * unlinking, and an account's deletion. The record loses its account at once and stays, marked unlinked, only until
 * the worker has taken the Member role away on Discord, which needs the Discord ID.
 */
@Injectable()
export class DiscordLinkRecords {
  constructor(private readonly firebase: Firebase) {}

  private get links() {
    return this.firebase.db.collection(Collections.discordLinks);
  }

  /** The account's link, if it has one. */
  async find(accountId: string): Promise<DiscordLinkRecord | null> {
    const snap = await this.links.where('accountId', '==', accountId).limit(1).get();
    return (snap.docs[0]?.data() as DiscordLinkRecord | undefined) ?? null;
  }

  /** Ends the account's link; whether it had one. The worker looks at the record on its next tick. */
  async forgetAccount(accountId: string, now: Date = new Date()): Promise<boolean> {
    const snap = await this.links.where('accountId', '==', accountId).get();
    const at = now.toISOString();
    await Promise.all(snap.docs.map((doc) => doc.ref.update({ accountId: null, discordName: null, celebrate: false, unlinkedAt: at, roleCheckAt: at })));
    return !snap.empty;
  }

  /** Counts for the admins' page; never who. */
  async summary(): Promise<DiscordLinksSummary> {
    const live = this.links.where('unlinkedAt', '==', null);
    const count = async (query: FirebaseFirestore.Query) => (await query.count().get()).data().count;
    const [linked, withRole, notInServer, notAllowed, noRole, celebrating] = await Promise.all([
      count(live),
      count(live.where('role', '==', 'given')),
      count(live.where('roleProblem', '==', 'not_in_server')),
      count(live.where('roleProblem', '==', 'not_allowed')),
      count(live.where('roleProblem', '==', 'no_such_role')),
      count(live.where('celebrate', '==', true)),
    ]);
    return { linked, withRole, notInServer, refused: notAllowed + noRole, celebrating };
  }
}

/**
 * A member links their Discord account (design §10.18, "Linking"). The Account page starts a sign-in at Discord, which
 * sends the member back with a code; the api trades the code for who they are on Discord (their ID and name, nothing
 * else), keeps that, and gives up Discord's pass at once. The worker then gives the Member role while the membership
 * is Active. Each link and unlink is ledgered, without the Discord ID.
 */
@Injectable()
export class DiscordLinks {
  constructor(
    private readonly firebase: Firebase,
    private readonly records: DiscordLinkRecords,
    private readonly settings: DiscordSettingsService,
    private readonly members: MemberDirectory,
    private readonly keys: ApiKeys,
    private readonly ledger: LedgerService,
    @Inject(DISCORD_API) private readonly discord: DiscordApi | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async view(accountId: string): Promise<DiscordLinkView> {
    const [link, settings, member, setup] = await Promise.all([this.records.find(accountId), this.settings.current(), this.members.find(accountId), this.setup()]);
    return discordLinkView(link, { blocker: setup.blocker, rolesSet: discordRolesSet(settings), activeMember: member?.status === 'active' });
  }

  /** Where to send the member to sign in to Discord, and the one-time word that ties their return to this account. */
  async start(accountId: string, now: Date = new Date()): Promise<DiscordLinkStart> {
    const setup = await this.ready();
    if (await this.records.find(accountId)) throw new ConflictException('this account is already linked to a Discord account: unlink it first');
    const state = randomBytes(24).toString('base64url');
    const record: DiscordLinkStateRecord = { accountId, expiresAt: new Date(now.getTime() + DISCORD_LINK_STATE_MINUTES * 60_000).toISOString() };
    await this.firebase.db.collection(Collections.discordLinkStates).doc(sha256(state)).set(record);
    if (this.config.discord === 'stub') {
      // The stand-in plays Discord: it sends the member straight back, as a made-up person named after the account.
      const id = `9${BigInt(`0x${sha256(accountId).slice(0, 14)}`).toString().padStart(17, '0').slice(0, 17)}`;
      const query = new URLSearchParams({ code: stubSignInCode(id, 'Stand-in'), state });
      return { url: `${setup.origin}${DISCORD_LINK_PATH}?${query}`, state };
    }
    return { url: discordAuthorizeUrl(setup.applicationId, setup.origin, state), state };
  }

  /** Finishes a sign-in the member started: learns who they are on Discord and keeps the link. */
  async link(accountId: string, input: DiscordLinkInput, now: Date = new Date()): Promise<DiscordLinkView> {
    const setup = await this.ready();
    const db = this.firebase.db;
    const stateRef = db.collection(Collections.discordLinkStates).doc(sha256(input.state));
    // The word is good once, for the account that started, for ten minutes.
    const started = await db.runTransaction(async (tx) => {
      const state = (await tx.get(stateRef)).data() as DiscordLinkStateRecord | undefined;
      if (!state) return false;
      tx.delete(stateRef);
      return state.accountId === accountId && Date.parse(state.expiresAt) > now.getTime();
    });
    if (!started) throw new ConflictException('this sign-in was not started from your Account page, or it took too long: start again from there');

    const who = await this.discord!.signIn(setup.applicationId, setup.clientSecret, input.code, discordRedirectUri(setup.origin));
    if (!who.ok) throw who.refusal === 'unreachable' ? new BadGatewayException(who.problem) : new UnprocessableEntityException(who.problem);

    const ref = db.collection(Collections.discordLinks).doc(who.id);
    await db.runTransaction(async (tx) => {
      const [existing, mine] = await Promise.all([tx.get(ref), tx.get(db.collection(Collections.discordLinks).where('accountId', '==', accountId).limit(1))]);
      const held = existing.data() as DiscordLinkRecord | undefined;
      if (held && !held.unlinkedAt && held.accountId !== accountId) {
        throw new ConflictException('this Discord account is already linked to another account on the site');
      }
      if (!mine.empty && mine.docs[0]!.id !== who.id) throw new ConflictException('this account is already linked to a Discord account: unlink it first');
      if (held && !held.unlinkedAt) return;
      // A record still waiting for its role to be taken away is the same person coming back: the role is kept.
      const link: DiscordLinkRecord = { ...newDiscordLink(accountId, who, now), role: held?.role ?? 'none', roleAt: held?.roleAt ?? null };
      await this.ledger.record(tx, [{ type: 'discord.linked', actor: accountId, subject: accountId, payload: {} }]);
      tx.set(ref, link);
    });
    return this.view(accountId);
  }

  async celebrate(accountId: string, input: DiscordCelebrateInput): Promise<DiscordLinkView> {
    const link = await this.records.find(accountId);
    if (!link) throw new NotFoundException('this account is not linked to a Discord account');
    await this.firebase.db.collection(Collections.discordLinks).doc(link.discordUserId).update({ celebrate: input.celebrate });
    return this.view(accountId);
  }

  async unlink(accountId: string): Promise<DiscordLinkView> {
    if (!(await this.records.forgetAccount(accountId))) throw new NotFoundException('this account is not linked to a Discord account');
    await this.firebase.db.runTransaction((tx) => this.ledger.record(tx, [{ type: 'discord.unlinked', actor: accountId, subject: accountId, payload: {} }]));
    return this.view(accountId);
  }

  /** Why members cannot link here yet; null when they can. */
  async blocker(): Promise<DiscordLinkBlocker | null> {
    return (await this.setup()).blocker;
  }

  /** What linking needs of the deployment, and what is missing. */
  private async setup(): Promise<{ blocker: DiscordLinkBlocker | null; origin: string; applicationId: string; clientSecret: string }> {
    const origin = this.config.webOrigin ?? '';
    if (!this.discord) return { blocker: 'off', origin, applicationId: '', clientSecret: '' };
    if (this.config.discord === 'stub') return { blocker: origin ? null : 'no_origin', origin, applicationId: STUB_APPLICATION.applicationId, clientSecret: 'stub' };
    const [app, secret] = await Promise.all([this.firebase.db.collection(Collections.discordState).doc('app').get(), this.keys.value('discord')]);
    const applicationId = (app.data() as DiscordAppState | undefined)?.applicationId ?? '';
    const blocker: DiscordLinkBlocker | null = !origin ? 'no_origin' : !applicationId ? 'no_application' : !secret ? 'no_secret' : null;
    return { blocker, origin, applicationId, clientSecret: secret ?? '' };
  }

  private async ready() {
    const setup = await this.setup();
    if (setup.blocker) throw new ServiceUnavailableException('Discord accounts cannot be linked on this site yet');
    return setup;
  }
}

/** A member's own Discord link (design §10.18, "Linking"), on the Account page. */
@Controller('v1/me/discord')
export class MyDiscordController {
  constructor(private readonly links: DiscordLinks) {}

  @Get()
  view(@Ctx() ctx: RequestContext) {
    return this.links.view(requireAccount(ctx));
  }

  @Post('start')
  @HttpCode(200)
  start(@Ctx() ctx: RequestContext) {
    return this.links.start(requireAccount(ctx));
  }

  @Post('link')
  @HttpCode(200)
  link(@Ctx() ctx: RequestContext, @Body(new ZodPipe(discordLinkSchema)) body: DiscordLinkInput) {
    return this.links.link(requireAccount(ctx), body);
  }

  @Put()
  celebrate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(discordCelebrateSchema)) body: DiscordCelebrateInput) {
    return this.links.celebrate(requireAccount(ctx), body);
  }

  @Delete()
  unlink(@Ctx() ctx: RequestContext) {
    return this.links.unlink(requireAccount(ctx));
  }
}
