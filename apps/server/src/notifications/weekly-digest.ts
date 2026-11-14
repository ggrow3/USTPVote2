import { Inject, Injectable, Logger } from '@nestjs/common';
import { sha256Hex } from 'ustp-audit';
import {
  broadcastAudienceSummary,
  Collections,
  digestIsEmpty,
  digestMessage,
  isRehearsalRoll,
  MAIL_CAUSED_BY_SYSTEM,
  nextWeeklyDigestAt,
  type BroadcastAudience,
  type BroadcastRecord,
  type BroadcastRequestedPayload,
  type CourseRecord,
  type CourseVersionRecord,
  type DigestContent,
  type DigestStateRecord,
} from 'ustp-domain';
import { PublishedNews } from '../communications/published-news.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { BroadcastRepository } from './broadcast.repository.js';
import { BroadcastAudienceReader } from './broadcasts.js';
import { NoticeSettingsService } from './notice-settings.js';

const AUDIENCE: BroadcastAudience = { kind: 'all_active' };

/**
 * The weekly digest (design §10.14), a step of the worker's tick: when it is due and switched on, it gathers what is new
 * since the last one (votes open now, news posts and courses published) and queues it as an email to members (§10.12),
 * which the broadcast sender then sends like any other: to the Active members who opted in, through the gate of all the
 * site's email, ledgered, and waiting for a System Admin where approval is switched on. The due time moves on first, in
 * a transaction, so overlapping ticks queue one digest, and a week with nothing new, or with another email to members
 * still going out, sends none.
 */
@Injectable()
export class WeeklyDigest {
  private readonly logger = new Logger(WeeklyDigest.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly settings: NoticeSettingsService,
    private readonly broadcasts: BroadcastRepository,
    private readonly audience: BroadcastAudienceReader,
    private readonly ledger: LedgerService,
    private readonly elections: ElectionReader,
    private readonly news: PublishedNews,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Queues this week's digest if it is due. Returns how many were queued: 0 or 1. */
  async queueDue(now: Date = new Date()): Promise<number> {
    const settings = await this.settings.current();
    const contact = settings.contact ?? this.config.noticeContact;
    if (!settings.emails.weeklyDigest || !settings.allEmails || this.config.mailTransport === 'off' || !this.config.webOrigin || !contact) return 0;
    const since = await this.claim(now);
    if (since === null) return 0;
    const content = await this.content(since);
    if (digestIsEmpty(content)) return 0;
    const { preview } = await this.audience.resolve(AUDIENCE);
    if (!preview.willGet) return 0;
    const message = digestMessage({ origin: this.config.webOrigin, content });
    const ref = this.broadcasts.ref();
    const approvalRequired = settings.broadcastApproval;
    const record: BroadcastRecord = {
      broadcastId: ref.id,
      subject: message.subject,
      body: message.body,
      audience: AUDIENCE,
      status: approvalRequired ? 'awaiting_approval' : 'preparing',
      createdBy: MAIL_CAUSED_BY_SYSTEM,
      createdAt: now.toISOString(),
      preview: null,
      completedAt: null,
      approval: approvalRequired ? { status: 'waiting', decidedBy: null, decidedAt: null, reason: null } : null,
    };
    const queued = await this.firebase.db.runTransaction(async (tx) => {
      // One email to members at a time (§10.12): this week's digest gives way to one an admin wrote.
      if ((await this.broadcasts.open(tx)).length) return false;
      const payload: BroadcastRequestedPayload = {
        broadcastId: ref.id,
        subject: message.subject,
        bodyHash: sha256Hex(message.body),
        audience: broadcastAudienceSummary(AUDIENCE),
        willGet: preview.willGet,
        approvalRequired,
      };
      await this.ledger.record(tx, [{ type: 'notice.broadcast_requested', actor: 'system', subject: null, payload: { ...payload } }]);
      tx.create(ref, record);
      return true;
    });
    if (!queued) this.logger.warn('the weekly digest was not queued: another email to members is still going out');
    return queued ? 1 : 0;
  }

  /**
   * Moves the due time on and returns what the digest covers from, or null when none is due. The first time, it only
   * sets when the first is due: a digest covers from when it was switched on, not everything before.
   */
  private claim(now: Date): Promise<string | null> {
    const ref = this.firebase.db.collection(Collections.mailDigest).doc('weekly');
    return this.firebase.db.runTransaction(async (tx) => {
      const state = (await tx.get(ref)).data() as DigestStateRecord | undefined;
      const next: DigestStateRecord = { dueAt: nextWeeklyDigestAt(now), lastAt: now.toISOString() };
      if (!state) {
        tx.set(ref, next);
        return null;
      }
      if (Date.parse(state.dueAt) > now.getTime()) return null;
      tx.set(ref, next);
      return state.lastAt;
    });
  }

  /** What is new since `since`; also what the Discord bot's Monday post says (§10.18). */
  async content(since: string): Promise<DigestContent> {
    const db = this.firebase.db;
    const [open, news, versions] = await Promise.all([
      this.elections.inState('open'),
      this.news.since(since),
      db.collection(Collections.courseVersions).where('publishedAt', '>=', since).get(),
    ]);
    const rolls = await Promise.all(open.map((election) => this.elections.approvedRoll(election)));
    const elections = open
      .filter((_, i) => !isRehearsalRoll(rolls[i]?.criteria))
      .sort((a, b) => a.closesAt.localeCompare(b.closesAt))
      .map((election) => ({ title: election.title, closesAt: election.closesAt }));
    // A course published twice in the week is listed once, and only while it is still published.
    const courseIds = [...new Set(versions.docs.map((d) => (d.data() as CourseVersionRecord).courseId))];
    const courseSnaps = courseIds.length ? await db.getAll(...courseIds.map((id) => db.collection(Collections.courses).doc(id))) : [];
    const courses = courseSnaps
      .map((snap) => snap.data() as CourseRecord | undefined)
      .filter((course): course is CourseRecord => course?.status === 'published')
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((course) => ({ title: course.title, courseId: course.courseId }));
    return { elections, news: news.map(({ title, slug }) => ({ title, slug })), courses };
  }
}
