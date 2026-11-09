import { BadRequestException, Injectable } from '@nestjs/common';
import { MAIL_CAUSED_BY_SYSTEM, parseMailLogCursor, type MailLogPage, type MailLogQuery } from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { ElectionReader } from '../elections/election-reader.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MailRepository } from './mail.repository.js';

/**
 * The email log (design §10.12): every email the site sent, for System Admins. The records are the ones the worker keeps
 * of each message the mail service took (§6.8); this reads them a page at a time and names the accounts in them as they
 * are now, a member by their name (a deleted account's records went with it, §4), with the address the recipient's
 * account has now.
 */
@Injectable()
export class MailLogService {
  constructor(
    private readonly mail: MailRepository,
    private readonly directory: DirectoryService,
    private readonly elections: ElectionReader,
    private readonly members: MemberDirectory,
  ) {}

  async page(query: MailLogQuery): Promise<MailLogPage> {
    const after = query.after ? parseMailLogCursor(query.after) : null;
    if (query.after && !after) throw new BadRequestException('invalid query parameter after');
    const { records, next, scanLimited } = await this.mail.log(query, after);
    const accountIds = new Set<string>();
    for (const r of records) {
      if (r.accountId) accountIds.add(r.accountId);
      if (r.causedBy && r.causedBy !== MAIL_CAUSED_BY_SYSTEM) accountIds.add(r.causedBy);
    }
    const ids = [...accountIds];
    const electionIds = [...new Set(records.flatMap((r) => (r.electionId ? [r.electionId] : [])))];
    const [members, names, mailboxes, titles] = await Promise.all([
      this.members.findMany(ids),
      this.directory.displayNames(ids),
      this.directory.mailboxes(ids),
      Promise.all(electionIds.map(async (id) => [id, (await this.elections.find(id))?.title ?? null] as const)).then((pairs) => new Map(pairs)),
    ]);
    // A member's own name first, then the account's, then its address.
    const memberNames = new Map(ids.flatMap((id, i) => (members[i] ? [[id, members[i].preferredName || members[i].legalName] as const] : [])));
    const nameOf = (id: string | null | undefined) => (id ? (memberNames.get(id) ?? names.get(id) ?? mailboxes.get(id)?.email ?? null) : null);
    return {
      rows: records.map((r) => ({
        messageId: r.messageId,
        kind: r.kind,
        sender: r.sender,
        handOff: r.handOff === true,
        delivery: r.delivery,
        status: r.status,
        sentAt: r.sentAt,
        deliveredAt: r.deliveredAt,
        bouncedAt: r.bouncedAt,
        complainedAt: r.complainedAt,
        bounce: r.bounce,
        accountId: r.accountId,
        accountName: nameOf(r.accountId),
        accountEmail: (r.accountId && mailboxes.get(r.accountId)?.email) || null,
        causedBy: r.causedBy ?? null,
        causedByName: r.causedBy === MAIL_CAUSED_BY_SYSTEM ? null : nameOf(r.causedBy),
        ref: r.ref,
        electionId: r.electionId,
        electionTitle: (r.electionId && titles.get(r.electionId)) || null,
      })),
      next,
      scanLimited,
    };
  }
}
