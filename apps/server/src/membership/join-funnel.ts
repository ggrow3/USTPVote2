import { Controller, Get, Injectable, Query } from '@nestjs/common';
import {
  Collections,
  ElectionCollections,
  JOIN_FUNNEL_MAX_ACCOUNTS,
  JOIN_FUNNEL_PERIODS,
  joinFunnelReport,
  periodDays,
  visitDay,
  type AccountRecord,
  type ApplicationRecord,
  type FirstStep,
  type JoinFunnelPerson,
  type JoinFunnelReport,
  type PageHitsRecord,
} from 'ustp-domain';
import { Roles } from '../auth/decorators.js';
import { Firebase } from '../infra/firebase.js';

/** Approved accounts whose first steps are looked up at once. */
const LOOKUPS_AT_ONCE = 20;
/** Documents read in one `getAll`. */
const GET_ALL_BATCH = 300;

/**
 * The join funnel (design §5.15), made on request from records that exist anyway: the Register page's hit counter,
 * the accounts made in the period, their applications, and for the approved whether they have since voted, started a
 * course, joined a team, entered the room or posted. Accounts a Membership Admin added (§5.13) and test personas
 * (§10.4) never registered, so they are left out. The report is counts: it names nobody.
 */
@Injectable()
export class JoinFunnelService {
  constructor(private readonly firebase: Firebase) {}

  async report(days: number, now: Date = new Date()): Promise<JoinFunnelReport> {
    const db = this.firebase.db;
    const dayList = periodDays(visitDay(now), days);
    const fromDay = dayList[0]!;
    const from = `${fromDay}T00:00:00.000Z`;
    const [hitsSnap, accountsSnap, applicationsSnap, personasSnap, electionsSnap] = await Promise.all([
      db.collection(Collections.pageHits).doc('register').get(),
      db.collection(Collections.accounts).where('createdAt', '>=', from).orderBy('createdAt').limit(JOIN_FUNNEL_MAX_ACCOUNTS + 1).get(),
      db.collection(Collections.applications).where('submittedAt', '>=', from).orderBy('submittedAt').get(),
      db.collection(Collections.testingPersonas).select().get(),
      // A new member can only have voted in an election still open after the period began.
      db.collection(Collections.elections).where('closesAt', '>=', from).select().get(),
    ]);
    const hits = hitsSnap.data() as Partial<PageHitsRecord> | undefined;
    const sumOver = (counts: Readonly<Record<string, number>> | undefined) =>
      dayList.reduce((total, day) => total + (typeof counts?.[day] === 'number' ? counts[day] : 0), 0);

    const personas = new Set(personasSnap.docs.map((d) => d.id));
    const accounts = accountsSnap.docs
      .slice(0, JOIN_FUNNEL_MAX_ACCOUNTS)
      .map((d) => d.data() as AccountRecord)
      .filter((a) => a.addedAt === undefined && !personas.has(a.accountId));

    const applications = new Map<string, ApplicationRecord[]>();
    for (const doc of applicationsSnap.docs) {
      const application = doc.data() as ApplicationRecord;
      applications.set(application.accountId, [...(applications.get(application.accountId) ?? []), application]);
    }
    const electionIds = electionsSnap.docs.map((d) => d.id);

    const people: JoinFunnelPerson[] = [];
    for (let i = 0; i < accounts.length; i += LOOKUPS_AT_ONCE) {
      people.push(
        ...(await Promise.all(
          accounts.slice(i, i + LOOKUPS_AT_ONCE).map(async (account): Promise<JoinFunnelPerson> => {
            const own = applications.get(account.accountId) ?? [];
            const settled = own.find((a) => a.status === 'approved') ?? own.find((a) => a.status === 'pending') ?? own.at(-1) ?? null;
            return {
              createdAt: account.createdAt,
              emailVerified: account.emailVerified,
              appliedAt: own[0]?.submittedAt ?? null,
              decision: settled?.status ?? null,
              decidedAt: settled?.decidedAt ?? null,
              did: settled?.status === 'approved' ? await this.firstSteps(account.accountId, electionIds) : [],
            };
          }),
        )),
      );
    }
    return joinFunnelReport({
      days,
      from: fromDay,
      now: now.toISOString(),
      registerOpens: sumOver(hits?.days),
      registerOpensSignedIn: sumOver(hits?.signedIn),
      people,
      truncated: accountsSnap.size > JOIN_FUNNEL_MAX_ACCOUNTS,
    });
  }

  /** What the member has done, each from the first record that says so. */
  private async firstSteps(accountId: string, electionIds: readonly string[]): Promise<FirstStep[]> {
    const db = this.firebase.db;
    const any = async (collection: string, field: string) => !(await db.collection(collection).where(field, '==', accountId).limit(1).get()).empty;
    const voted = async () => {
      for (let i = 0; i < electionIds.length; i += GET_ALL_BATCH) {
        const refs = electionIds
          .slice(i, i + GET_ALL_BATCH)
          .map((id) => db.collection(Collections.elections).doc(id).collection(ElectionCollections.participation).doc(accountId));
        if ((await db.getAll(...refs)).some((snap) => snap.exists)) return true;
      }
      return false;
    };
    const [hasVoted, course, team, inRoom, post, comment] = await Promise.all([
      voted(),
      any(Collections.courseProgress, 'accountId'),
      any(Collections.teamMembers, 'accountId'),
      any(Collections.roomConsents, 'accountId'),
      any(Collections.forumPosts, 'authorId'),
      any(Collections.forumComments, 'authorId'),
    ]);
    return [hasVoted && 'voted', course && 'course', team && 'team', inRoom && 'room', (post || comment) && 'posted'].filter(
      (step): step is FirstStep => typeof step === 'string',
    );
  }
}

/** Membership Admins read the join funnel (design §5.15). */
@Controller('v1/admin/join-funnel')
export class JoinFunnelController {
  constructor(private readonly funnel: JoinFunnelService) {}

  @Get()
  @Roles('membership_admin')
  report(@Query('days') days?: string): Promise<JoinFunnelReport> {
    const n = Number(days);
    return this.funnel.report((JOIN_FUNNEL_PERIODS as readonly number[]).includes(n) ? n : 30);
  }
}
