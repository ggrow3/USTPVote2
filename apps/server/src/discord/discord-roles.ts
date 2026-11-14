import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Collections,
  DISCORD_UNLINK_KEEP_DAYS,
  discordRoleNextCheck,
  discordRolesSet,
  discordRoleStep,
  type DiscordLinkRecord,
  type DiscordRoleProblem,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { DISCORD_API, type DiscordApi } from './discord-api.js';
import { DiscordSettingsService } from './discord-settings.js';
import { DiscordToken } from './discord-token.js';

/** Links looked at in one tick at most; the next tick is a minute away. */
const MAX_LINKS = 20;
const DAY_MS = 86_400_000;

/**
 * Keeps the Member role on Discord in step with membership (design §10.18, "Linking"), a step of the worker's tick. A
 * linked account holds the role while its membership is Active; it loses it when the membership lapses, is suspended
 * or resigned, when the member unlinks, and when the account is deleted. Each link is looked at when it is made or
 * ended, and again every hour, which is how a change of membership is noticed; a new link whose person has not joined
 * the server yet is looked at every two minutes for its first hour, and every link at once when the admins save
 * another server or role.
 *
 * It works whether or not the bot is switched on to post: the switch is for what the bot posts by itself. Role
 * changes are not ledgered: they follow from the membership and the link, whose changes are.
 */
@Injectable()
export class DiscordRoles {
  private readonly logger = new Logger(DiscordRoles.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly settings: DiscordSettingsService,
    private readonly token: DiscordToken,
    private readonly members: MemberDirectory,
    @Inject(DISCORD_API) private readonly discord: DiscordApi | null,
  ) {}

  /** Returns how many roles were given or taken away. */
  async run(now: Date = new Date()): Promise<number> {
    if (!this.discord) return 0;
    const settings = await this.settings.current();
    await this.noticeNewRole(`${settings.guildId ?? ''}:${settings.memberRoleId ?? ''}`, now);
    const due = await this.firebase.db.collection(Collections.discordLinks).where('roleCheckAt', '<=', now.toISOString()).orderBy('roleCheckAt').limit(MAX_LINKS).get();
    if (due.empty) return 0;
    const rolesSet = discordRolesSet(settings);
    const links = due.docs.map((doc) => doc.data() as DiscordLinkRecord);
    const accountIds = [...new Set(links.flatMap((link) => (link.accountId ? [link.accountId] : [])))];
    const found = accountIds.length ? await this.members.findMany(accountIds) : [];
    const activeIds = new Set(accountIds.filter((_, i) => found[i]?.status === 'active'));
    let token: string | null | undefined;
    let changed = 0;

    for (const [i, link] of links.entries()) {
      const ref = due.docs[i]!.ref;
      const active = !!link.accountId && activeIds.has(link.accountId);
      const step = discordRoleStep(link, active, rolesSet, now);
      const next = (problem: DiscordRoleProblem | null) => discordRoleNextCheck(link, problem, now);
      if (step === 'forget') {
        await ref.delete();
        continue;
      }
      if (step === 'nothing') {
        await ref.update({ roleCheckAt: next(link.roleProblem) });
        continue;
      }
      token ??= await this.token.read();
      if (!token) {
        await ref.update({ roleCheckAt: next(null) });
        continue;
      }
      const give = step === 'give';
      const done = await this.discord.setRole(token, settings.guildId!, link.discordUserId, settings.memberRoleId!, give);
      if (!done.ok && done.reason === 'retry') {
        this.logger.warn(`Discord could not change a role just now (${done.problem}); it goes with the next tick`);
        break;
      }
      // A person who is not on the server holds no role there: for taking it away, that is the same as done.
      const gone = !done.ok && done.reason === 'not_in_server';
      if (done.ok || (gone && !give)) {
        if (done.ok) changed++;
        if (link.unlinkedAt) await ref.delete();
        else await ref.update({ role: give ? 'given' : 'none', roleAt: give ? now.toISOString() : link.roleAt, roleProblem: null, roleCheckAt: next(null) });
        continue;
      }
      if (gone) {
        await ref.update({ role: 'none', roleProblem: 'not_in_server', roleCheckAt: next('not_in_server') });
        continue;
      }
      // The bot's own setup is wrong (no Manage Roles, its role too low, no such role): the admins' page says so.
      this.logger.warn({ message: `Discord would not change a role: ${done.problem}` });
      if (link.unlinkedAt && now.getTime() - Date.parse(link.unlinkedAt) > DISCORD_UNLINK_KEEP_DAYS * DAY_MS) await ref.delete();
      else {
        const problem: DiscordRoleProblem = done.reason === 'no_such_role' ? 'no_such_role' : 'not_allowed';
        await ref.update({ roleProblem: problem, roleCheckAt: next(problem) });
      }
    }
    return changed;
  }

  /**
   * When the admins save another server or role (or the first), every link is looked at now rather than within the
   * hour, and counts as not holding the role: the new one is still to give. The old role is not chased; whoever holds
   * it keeps it until an admin removes it in Discord.
   */
  private async noticeNewRole(key: string, now: Date): Promise<void> {
    const db = this.firebase.db;
    const ref = db.collection(Collections.discordState).doc('roles');
    const before = ((await ref.get()).data() as { readonly key?: string } | undefined)?.key ?? ':';
    if (before !== key) {
      const links = await db.collection(Collections.discordLinks).select().get();
      const writer = db.bulkWriter();
      for (const doc of links.docs) void writer.update(doc.ref, { role: 'none', roleAt: null, roleProblem: null, roleCheckAt: now.toISOString() });
      await writer.close();
      await ref.set({ key });
    }
  }
}
