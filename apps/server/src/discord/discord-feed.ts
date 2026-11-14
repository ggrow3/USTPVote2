import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Collections,
  DISCORD_MIN_HOURS_FOR_REMINDER,
  DISCORD_REMINDER_HOURS,
  discordLedgerInterest,
  discordMessage,
  discordPost,
  discordPostId,
  discordTestPost,
  isRehearsalRoll,
  type CourseRecord,
  type CourseVersionRecord,
  type DiscordFeedItem,
  type DiscordFeedState,
  type DiscordPostedPayload,
  type DiscordPostRecord,
  type DiscordSettingsRecord,
  type DiscordTestRecord,
  type ElectionRecord,
  type LedgerEntry,
} from 'ustp-domain';
import { PublicBillTitles } from '../bills/public-bill-titles.js';
import { PublishedEvents } from '../communications/published-events.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { DISCORD_API, type DiscordApi } from './discord-api.js';
import { DiscordSettingsService } from './discord-settings.js';
import { DiscordToken } from './discord-token.js';

/** Posts in one tick at most: Discord allows a bot a few a second in a channel, and the next tick is a minute away. */
const MAX_POSTS = 10;
/** Ledger entries read in one tick at most. */
const MAX_ENTRIES = 200;
const HOUR_MS = 3_600_000;
/** Courses are looked for from a little before the last look, so one published as the worker looked is not missed. */
const OVERLAP_MS = 2 * 60_000;

type Outcome = 'posted' | 'skipped' | 'failed' | 'later';

/**
 * The Discord bot's feed (design §10.18), a step of the worker's tick. It reads the ledger from where it left off and
 * posts about the entries on its allow-list (news published, voting opened, results, events, public bills), then about
 * courses published, votes closing within a day and events starting within a day. Each post is recorded first under an
 * ID made from what it is about, so the same thing is never posted twice, and ledgered once Discord has it. Rehearsal
 * elections are left out. A post Discord refuses for good (no such channel, no permission) is recorded as failed and
 * passed over; when Discord is busy or out of reach the step stops, and goes on from the same place next tick.
 */
@Injectable()
export class DiscordFeed {
  private readonly logger = new Logger(DiscordFeed.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly settings: DiscordSettingsService,
    private readonly token: DiscordToken,
    private readonly ledger: LedgerService,
    private readonly elections: ElectionReader,
    private readonly events: PublishedEvents,
    private readonly bills: PublicBillTitles,
    @Inject(DISCORD_API) private readonly discord: DiscordApi | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Sends a waiting test post, then what is due. Returns how many posts Discord took. */
  async postDue(now: Date = new Date()): Promise<number> {
    const origin = this.config.webOrigin;
    if (!this.discord || !origin) return 0;
    const test = await this.waitingTest();
    const settings = await this.settings.current();
    if (!test && !settings.enabled) return 0;
    const token = await this.token.read();
    let posted = test ? await this.sendTest(test, token, origin, now) : 0;
    if (!settings.enabled || !token) return posted;

    const stateRef = this.firebase.db.collection(Collections.discordState).doc('feed');
    const state = (await stateRef.get()).data() as DiscordFeedState | undefined;
    // Switching the bot on writes where it starts; without that (settings written another way), it starts from now.
    if (!state) {
      await stateRef.set({ seq: await this.headSeq(), since: now.toISOString() } satisfies DiscordFeedState);
      return posted;
    }

    const run = { settings, token, origin, now, left: MAX_POSTS };
    let seq = state.seq;
    let stopped = false;
    for (const entry of await this.ledger.list(state.seq, MAX_ENTRIES)) {
      if (run.left <= 0) {
        stopped = true;
        break;
      }
      const item = await this.fromLedger(entry);
      const outcome = item ? await this.post(item, run) : 'skipped';
      if (outcome === 'later') {
        stopped = true;
        break;
      }
      if (outcome === 'posted') posted++;
      seq = entry.seq;
    }

    let since = state.since;
    if (!stopped) {
      const looked = new Date(now.getTime() - OVERLAP_MS).toISOString();
      const timed = [...(await this.courses(state.since)), ...(await this.closingVotes(now)), ...(await this.comingEvents(now))];
      for (const item of timed) {
        if (run.left <= 0) {
          stopped = true;
          break;
        }
        const outcome = await this.post(item, run);
        if (outcome === 'later') {
          stopped = true;
          break;
        }
        if (outcome === 'posted') posted++;
      }
      if (!stopped) since = looked;
    }
    if (seq !== state.seq || since !== state.since) await stateRef.set({ seq, since } satisfies DiscordFeedState);
    return posted;
  }

  /**
   * Claims the post's record, sends it, and ledgers it. `skipped`: its kind has no channel, or it was posted (or tried)
   * before. `later`: Discord could not take it now, and the claim is given up so the next tick tries again.
   */
  private async post(
    item: DiscordFeedItem,
    run: { readonly settings: DiscordSettingsRecord; readonly token: string; readonly origin: string; readonly now: Date; left: number },
  ): Promise<Outcome> {
    const post = discordPost(item, run.origin);
    const channelId = run.settings.channels[post.kind];
    if (!channelId) return 'skipped';
    const db = this.firebase.db;
    const ref = db.collection(Collections.discordPosts).doc(discordPostId(post.ref));
    const record: DiscordPostRecord = { ...post, status: 'sending', channelId, messageId: null, problem: null, createdAt: run.now.toISOString(), sentAt: null };
    const claimed = await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false;
      tx.create(ref, record);
      return true;
    });
    if (!claimed) return 'skipped';
    run.left--;
    const sent = await this.discord!.send(run.token, channelId, discordMessage(post));
    if (!sent.ok && sent.retry) {
      await ref.delete();
      this.logger.warn(`Discord could not take a post just now (${sent.problem}); it goes with the next tick`);
      return 'later';
    }
    if (!sent.ok) {
      await ref.update({ status: 'failed', problem: sent.problem });
      this.logger.warn({ message: `Discord refused a post: ${sent.problem}`, ref: post.ref, kind: post.kind });
      return 'failed';
    }
    await db.runTransaction(async (tx) => {
      const payload: DiscordPostedPayload = { ref: post.ref, kind: post.kind, channelId, messageId: sent.messageId };
      await this.ledger.record(tx, [{ type: 'discord.posted', actor: 'system', subject: null, payload: { ...payload } }]);
      tx.update(ref, { status: 'sent', messageId: sent.messageId, sentAt: new Date().toISOString() });
    });
    return 'posted';
  }

  /** What a ledger entry is to Discord, with its record read where the entry does not say enough; null for nothing. */
  private async fromLedger(entry: LedgerEntry): Promise<DiscordFeedItem | null> {
    const interest = discordLedgerInterest(entry);
    if (!interest) return null;
    if ('electionId' in interest) {
      const election = await this.elections.find(interest.electionId);
      if (!election || (await this.isRehearsal(election))) return null;
      return { what: interest.what, electionId: election.electionId, title: election.title, closesAt: election.closesAt };
    }
    if (interest.what === 'bill_published') {
      const title = await this.bills.title(interest.billId);
      return title ? { what: 'bill_published', billId: interest.billId, title } : null;
    }
    return interest;
  }

  private async isRehearsal(election: Pick<ElectionRecord, 'rollSnapshotId'>): Promise<boolean> {
    return isRehearsalRoll((await this.elections.approvedRoll(election))?.criteria);
  }

  /** Courses with a version published since, once each, and only while still published. */
  private async courses(since: string): Promise<DiscordFeedItem[]> {
    const db = this.firebase.db;
    const versions = await db.collection(Collections.courseVersions).where('publishedAt', '>=', since).get();
    const courseIds = [...new Set(versions.docs.map((d) => (d.data() as CourseVersionRecord).courseId))];
    if (!courseIds.length) return [];
    const snaps = await db.getAll(...courseIds.map((id) => db.collection(Collections.courses).doc(id)));
    return snaps
      .map((snap) => snap.data() as CourseRecord | undefined)
      .filter((course): course is CourseRecord => course?.status === 'published')
      .map((course) => ({ what: 'course_published' as const, courseId: course.courseId, title: course.title }));
  }

  /** Open votes that close within a day, other than rehearsals and votes too short for a reminder to be news. */
  private async closingVotes(now: Date): Promise<DiscordFeedItem[]> {
    const items: DiscordFeedItem[] = [];
    for (const election of await this.elections.inState('open')) {
      const closes = Date.parse(election.closesAt);
      if (closes <= now.getTime() || closes - now.getTime() > DISCORD_REMINDER_HOURS * HOUR_MS) continue;
      if (closes - Date.parse(election.opensAt) < DISCORD_MIN_HOURS_FOR_REMINDER * HOUR_MS) continue;
      if (await this.isRehearsal(election)) continue;
      items.push({ what: 'voting_closing', electionId: election.electionId, title: election.title, closesAt: election.closesAt });
    }
    return items;
  }

  /** Published events that start within a day. */
  private async comingEvents(now: Date): Promise<DiscordFeedItem[]> {
    const until = new Date(now.getTime() + DISCORD_REMINDER_HOURS * HOUR_MS).toISOString();
    return (await this.events.startingBetween(now.toISOString(), until)).map((event) => ({ what: 'event_tomorrow' as const, ...event }));
  }

  private async waitingTest(): Promise<DiscordTestRecord | null> {
    const test = (await this.testRef().get()).data() as DiscordTestRecord | undefined;
    return test?.status === 'waiting' ? test : null;
  }

  /** A Communications Admin's test post, which goes whether or not the bot is switched on. Returns 1 if Discord took it. */
  private async sendTest(test: DiscordTestRecord, token: string | null, origin: string, now: Date): Promise<number> {
    const done = (status: 'sent' | 'failed', problem: string | null) => this.testRef().update({ status, problem, doneAt: now.toISOString() });
    if (!token) {
      await done('failed', "the bot's token has not been added: a System Admin adds it under Admin › API keys");
      return 0;
    }
    const sent = await this.discord!.send(token, test.channelId, discordMessage(discordTestPost(test.kind, origin)));
    await done(sent.ok ? 'sent' : 'failed', sent.ok ? null : sent.problem);
    return sent.ok ? 1 : 0;
  }

  private async headSeq(): Promise<number> {
    const snap = await this.firebase.db.collection(Collections.auditEvents).orderBy('seq', 'desc').limit(1).get();
    return (snap.docs[0]?.data() as LedgerEntry | undefined)?.seq ?? 0;
  }

  private testRef() {
    return this.firebase.db.collection(Collections.discordState).doc('test');
  }
}
