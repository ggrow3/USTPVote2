import {
  BadGatewayException,
  BadRequestException,
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
  checkDiscordToken,
  Collections,
  DISCORD_BOT_TOKEN_SECRET,
  discordSettingsSchema,
  discordTestSchema,
  discordTokenHint,
  discordTokenSchema,
  type AccountRecord,
  type DiscordAdminView,
  type DiscordPostRecord,
  type DiscordSettingsInput,
  type DiscordTestInput,
  type DiscordTestRecord,
  type DiscordTokenChangedPayload,
  type DiscordTokenInput,
  type DiscordTokenRecord,
  type DiscordTokenStatus,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { SECRET_STORE, type SecretStore, type SecretVersion } from '../infra/secret-store.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { DISCORD_API, type DiscordApi } from './discord-api.js';
import { DiscordSettingsService } from './discord-settings.js';
import { DiscordToken } from './discord-token.js';

const RECENT_POSTS = 20;

/**
 * The Discord bot's page for Communications Admins (design §10.18): its switch, the channel for each kind of post, a
 * test post, and what it posted lately. A test post is queued for the worker, which alone can read the bot's token.
 */
@Injectable()
export class DiscordAdminService {
  constructor(
    private readonly firebase: Firebase,
    private readonly settings: DiscordSettingsService,
    private readonly token: DiscordToken,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async view(): Promise<DiscordAdminView> {
    const db = this.firebase.db;
    this.settings.invalidate();
    const [settings, version, tokenSnap, testSnap, posts] = await Promise.all([
      this.settings.current(),
      this.tokenVersion(),
      db.collection(Collections.discordSettings).doc('token').get(),
      this.testRef().get(),
      db.collection(Collections.discordPosts).orderBy('createdAt', 'desc').limit(RECENT_POSTS).get(),
    ]);
    const tokenRecord = tokenSnap.data() as DiscordTokenRecord | undefined;
    return {
      settings,
      mode: this.config.discord,
      tokenSet: version === 'unknown' ? null : version !== null,
      botName: version && version !== 'unknown' && tokenRecord?.version === version.name ? tokenRecord.botName : null,
      canLink: !!this.config.webOrigin,
      test: (testSnap.data() as DiscordTestRecord | undefined) ?? null,
      recent: posts.docs.map((d) => d.data() as DiscordPostRecord),
    };
  }

  /** Queues a test post to a kind's channel; the worker sends it within a minute, whether or not the bot is switched on. */
  async requestTest(ctx: RequestContext, input: DiscordTestInput): Promise<DiscordAdminView> {
    const actor = requireAccount(ctx);
    if (this.config.discord === 'off') throw new ServiceUnavailableException('the Discord bot is switched off in this deployment');
    if (!this.config.webOrigin) throw new ServiceUnavailableException("the site's own address is not set in this deployment (WEB_ORIGIN), and every post links to it");
    const settings = await this.settings.current();
    const channelId = settings.channels[input.kind];
    if (!channelId) throw new ConflictException('save a channel for this kind of post first');
    if (!(await this.token.current())) throw new ConflictException("the bot's token has not been added yet: a System Admin adds it under Admin › API keys");
    const test: DiscordTestRecord = {
      kind: input.kind,
      channelId,
      requestedBy: actor,
      requestedAt: new Date().toISOString(),
      status: 'waiting',
      problem: null,
      doneAt: null,
    };
    await this.testRef().set(test);
    return this.view();
  }

  /** The token's version, null for none, or `unknown` when this server may not look yet (its Terraform is not applied). */
  private async tokenVersion(): Promise<SecretVersion | null | 'unknown'> {
    try {
      return await this.token.current();
    } catch (e) {
      if (e instanceof ServiceUnavailableException) return 'unknown';
      throw e;
    }
  }

  private testRef() {
    return this.firebase.db.collection(Collections.discordState).doc('test');
  }
}

/**
 * A System Admin adds, replaces or removes the Discord bot's token (design §10.18), as they do the Anthropic API key
 * (§5.6). The token goes from the request to Discord (to try it) and to Secret Manager, and nowhere else: no record,
 * ledger entry, log line or answer holds it. Each change is ledgered.
 */
@Injectable()
export class DiscordTokenAdminService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly token: DiscordToken,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(DISCORD_API) private readonly discord: DiscordApi | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async status(): Promise<DiscordTokenStatus> {
    const tried = this.config.discord === 'live';
    let version: SecretVersion | null;
    try {
      version = await this.token.current();
    } catch (e) {
      if (!(e instanceof ServiceUnavailableException)) throw e;
      return { set: false, addedAt: null, addedBy: null, hint: null, botName: null, tried, unavailable: e.message };
    }
    const record = (await this.recordRef().get()).data() as DiscordTokenRecord | undefined;
    // Who added it is known only for a token added here; one added with gcloud since is just "set".
    const ours = version && record?.version === version.name ? record : null;
    return {
      set: !!version,
      addedAt: version?.createdAt ?? null,
      addedBy: ours ? { accountId: ours.addedBy, name: ours.addedByName } : null,
      hint: ours?.hint ?? null,
      botName: ours?.botName ?? null,
      tried,
      unavailable: null,
    };
  }

  /** Tries the token, then keeps it as the secret's only live version. A token Discord refuses is never kept. */
  async add(ctx: RequestContext, input: DiscordTokenInput): Promise<DiscordTokenStatus> {
    const actor = requireAccount(ctx);
    if (!this.discord) throw new ServiceUnavailableException('the Discord bot is switched off in this deployment');
    assertCheck(checkDiscordToken(input.token), BadRequestException);
    const trial = await this.discord.whoAmI(input.token);
    if (!trial.ok) {
      throw trial.refusal === 'unreachable' ? new BadGatewayException(trial.reason) : new UnprocessableEntityException(trial.reason);
    }
    const db = this.firebase.db;
    const account = (await db.collection(Collections.accounts).doc(actor).get()).data() as AccountRecord | undefined;
    const version = await this.secrets.replace(DISCORD_BOT_TOKEN_SECRET, input.token);
    const record: DiscordTokenRecord = {
      version,
      hint: discordTokenHint(input.token),
      botName: trial.botName,
      addedAt: new Date().toISOString(),
      addedBy: actor,
      addedByName: account?.displayName || account?.primaryEmail || actor,
    };
    await db.runTransaction(async (tx) => {
      const payload: DiscordTokenChangedPayload = { change: 'added' };
      await this.ledger.record(tx, [{ type: 'discord.token_changed', actor, subject: null, payload: { ...payload } }]);
      tx.set(this.recordRef(), record);
    });
    return this.status();
  }

  /** Destroys every version, so the bot posts nothing until a token is added again. */
  async remove(ctx: RequestContext): Promise<DiscordTokenStatus> {
    const actor = requireAccount(ctx);
    if (!(await this.token.current())) throw new NotFoundException('no bot token is set, so there is none to remove');
    await this.secrets.clear(DISCORD_BOT_TOKEN_SECRET);
    await this.firebase.db.runTransaction(async (tx) => {
      const payload: DiscordTokenChangedPayload = { change: 'removed' };
      await this.ledger.record(tx, [{ type: 'discord.token_changed', actor, subject: null, payload: { ...payload } }]);
      tx.delete(this.recordRef());
    });
    return this.status();
  }

  private recordRef() {
    return this.firebase.db.collection(Collections.discordSettings).doc('token');
  }
}

/** The Discord bot, for Communications Admins (design §10.18). */
@Controller('v1/admin/discord')
@Roles('communications_admin')
export class DiscordAdminController {
  constructor(
    private readonly admin: DiscordAdminService,
    private readonly settings: DiscordSettingsService,
  ) {}

  @Get()
  view() {
    return this.admin.view();
  }

  @Put('settings')
  async update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(discordSettingsSchema)) body: DiscordSettingsInput) {
    await this.settings.update(ctx, body);
    return this.admin.view();
  }

  @Post('test')
  @HttpCode(200)
  test(@Ctx() ctx: RequestContext, @Body(new ZodPipe(discordTestSchema)) body: DiscordTestInput) {
    return this.admin.requestTest(ctx, body);
  }
}

/** The Discord bot's token (design §10.18): whether one is set and by whom, never the token itself. */
@Controller('v1/admin/discord-token')
@Roles('system_admin')
export class DiscordTokenController {
  constructor(private readonly tokens: DiscordTokenAdminService) {}

  @Get()
  status() {
    return this.tokens.status();
  }

  @Put()
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(discordTokenSchema)) body: DiscordTokenInput) {
    return this.tokens.add(ctx, body);
  }

  @Delete()
  remove(@Ctx() ctx: RequestContext) {
    return this.tokens.remove(ctx);
  }
}
