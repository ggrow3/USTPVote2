import { BadRequestException, Injectable } from '@nestjs/common';
import {
  addDays,
  MAIL_CAUSED_BY_SYSTEM,
  MAIL_DAY_PEOPLE,
  MAIL_DAY_SCAN,
  parseMailLogCursor,
  tallyMailDay,
  zoneDay,
  zoneDayBounds,
  type MailDayQuery,
  type MailDaysQuery,
  type MailDaysView,
  type MailDayView,
  type MailLogPage,
  type MailLogQuery,
} from 'ustp-domain';
import { DirectoryService } from '../auth/directory.service.js';
import { ElectionReader } from '../elections/election-reader.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { MailRepository } from './mail.repository.js';

/** Accounts' names and addresses as they are now. */
interface Names {
  /** A member's own name first, then the account's, then its address. */
  readonly name: (id: string | null | undefined) => string | null;
  readonly address: (id: string | null | undefined) => string | null;
}

/**
 * The email log (design §10.12): every email the site sent, for System and Site Admins. The records are the ones the
 * worker keeps of each message the mail service took (§6.8); this reads them a page at a time and names the accounts in
 * them as they are now, a member by their name (a deleted account's records went with it, §4), with the address each
 * went to and the address the recipient's account has now. It also counts them by day, and one day's by person.
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
    const electionIds = [...new Set(records.flatMap((r) => (r.electionId ? [r.electionId] : [])))];
    const [names, titles] = await Promise.all([
      this.names([...accountIds]),
      Promise.all(electionIds.map(async (id) => [id, (await this.elections.find(id))?.title ?? null] as const)).then((pairs) => new Map(pairs)),
    ]);
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
        accountName: names.name(r.accountId),
        accountEmail: names.address(r.accountId),
        to: r.to ?? null,
        causedBy: r.causedBy ?? null,
        causedByName: r.causedBy === MAIL_CAUSED_BY_SYSTEM ? null : names.name(r.causedBy),
        ref: r.ref,
        electionId: r.electionId,
        electionTitle: (r.electionId && titles.get(r.electionId)) || null,
      })),
      next,
      scanLimited,
    };
  }

  /** How many emails were sent each of the last `days` days in the admin's time zone, today last. Counted by Firestore. */
  async days(query: MailDaysQuery): Promise<MailDaysView> {
    const today = zoneDay(new Date(), query.tz);
    const days = Array.from({ length: query.days }, (_, i) => addDays(today, i - query.days + 1));
    return {
      zone: query.tz,
      days: await Promise.all(
        days.map(async (day) => {
          const { start, end } = zoneDayBounds(day, query.tz);
          return { day, start, end, emails: await this.mail.countBetween(start, end) };
        }),
      ),
    };
  }

  /** One day's emails in the admin's time zone: how many in all, by kind, by what became of them, and by person. */
  async day(query: MailDayQuery): Promise<MailDayView> {
    const { start, end } = zoneDayBounds(query.day, query.tz);
    const [emails, records] = await Promise.all([this.mail.countBetween(start, end), this.mail.between(start, end, MAIL_DAY_SCAN)]);
    const tally = tallyMailDay(records);
    const shown = tally.people.slice(0, MAIL_DAY_PEOPLE);
    const names = await this.names(shown.flatMap((p) => (p.accountId ? [p.accountId] : [])));
    return {
      day: query.day,
      zone: query.tz,
      start,
      end,
      emails: Math.max(emails, records.length),
      read: records.length,
      scanLimited: records.length >= MAIL_DAY_SCAN && emails > records.length,
      addresses: tally.addresses,
      byKind: tally.byKind,
      byStatus: tally.byStatus,
      people: shown.map((p) => ({
        ...p,
        name: names.name(p.accountId),
        addressNow: p.accountId && !p.addresses.length ? names.address(p.accountId) : null,
      })),
      peopleCount: tally.people.length,
    };
  }

  private async names(ids: readonly string[]): Promise<Names> {
    const [members, names, mailboxes] = await Promise.all([this.members.findMany(ids), this.directory.displayNames(ids), this.directory.mailboxes(ids)]);
    const memberNames = new Map(ids.flatMap((id, i) => (members[i] ? [[id, members[i].preferredName || members[i].legalName] as const] : [])));
    return {
      name: (id) => (id ? (memberNames.get(id) ?? names.get(id) ?? mailboxes.get(id)?.email ?? null) : null),
      address: (id) => (id ? (mailboxes.get(id)?.email ?? null) : null),
    };
  }
}
