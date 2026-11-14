import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Collections,
  DISCORD_LOOPS,
  digestIsEmpty,
  discordDigestText,
  discordLoopDue,
  discordLoopRef,
  discordMembersWeekHasNews,
  discordMembersWeekText,
  discordMessage,
  discordPollMessage,
  discordPostId,
  discordStartHereMessage,
  type CourseCertificateRecord,
  type CourseRecord,
  type DiscordLinkRecord,
  type DiscordLoop,
  type DiscordMembersWeek,
  type DiscordPostedPayload,
  type DiscordPostRecord,
  type DiscordQuestionRecord,
  type DiscordStartHereRecord,
} from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { WeeklyDigest } from '../notifications/weekly-digest.js';
import { DISCORD_API, type DiscordApi, type DiscordSend } from './discord-api.js';
import { DiscordSettingsService } from './discord-settings.js';
import { DiscordToken } from './discord-token.js';

const WEEK_MS = 7 * 86_400_000;

/** What a loop has to say this week: a post, or nothing (and then none is made). */
interface Draft {
  readonly title: string;
  readonly text: string;
  readonly message: Record<string, unknown>;
  /** The question a poll was made from, marked posted once Discord has it. */
  readonly questionId?: string;
}

/** `discord_state/loops`: the last week each loop was dealt with (posted, or found to have nothing to say). */
type LoopsState = Partial<Record<DiscordLoop, string>>;

/**
 * The Discord bot's weekly posts and its Start here message (design §10.18, "Loops"), a step of the worker's tick.
 * Each weekly post has a switch of its own and goes to the community channel on its day, once: Monday the week on the
 * site (what the weekly digest email says), Wednesday the oldest waiting question as a Discord poll, Friday what
 * members did, in totals, naming only members who chose to be named. A week with nothing to say gets no post.
 *
 * The Start here message is posted, or changed in place, when a Communications Admin asks, whether or not the bot is
 * switched on, as a test post is.
 */
@Injectable()
export class DiscordLoops {
  private readonly logger = new Logger(DiscordLoops.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly settings: DiscordSettingsService,
    private readonly token: DiscordToken,
    private readonly ledger: LedgerService,
    private readonly digest: WeeklyDigest,
    private readonly members: MemberDirectory,
    @Inject(DISCORD_API) private readonly discord: DiscordApi | null,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** Returns how many posts Discord took. */
  async run(now: Date = new Date()): Promise<number> {
    const origin = this.config.webOrigin;
    if (!this.discord || !origin) return 0;
    let posted = await this.startHere(origin, now);

    const settings = await this.settings.current();
    const channelId = settings.channels.community;
    const due = DISCORD_LOOPS.flatMap((loop) => {
      const week = settings.loops[loop] ? discordLoopDue(loop, now) : null;
      return week ? [{ loop, week }] : [];
    });
    if (!settings.enabled || !channelId || !due.length) return posted;

    const stateRef = this.firebase.db.collection(Collections.discordState).doc('loops');
    const state = ((await stateRef.get()).data() as LoopsState | undefined) ?? {};
    for (const { loop, week } of due) {
      if (state[loop] === week) continue;
      const token = await this.token.read();
      if (!token) return posted;
      const draft = await this.draft(loop, week, origin, now);
      const outcome = draft ? await this.post(loop, week, draft, channelId, token, origin, now) : 'nothing';
      if (outcome === 'later') return posted;
      if (outcome === 'posted') posted++;
      await stateRef.set({ [loop]: week }, { merge: true });
    }
    return posted;
  }

  private draft(loop: DiscordLoop, week: string, origin: string, now: Date): Promise<Draft | null> {
    const since = new Date(now.getTime() - WEEK_MS).toISOString();
    if (loop === 'digest') return this.digestDraft(since, origin);
    if (loop === 'question') return this.questionDraft();
    return this.membersDraft(week, since, origin);
  }

  private async digestDraft(since: string, origin: string): Promise<Draft | null> {
    const content = await this.digest.content(since);
    if (digestIsEmpty(content)) return null;
    const title = 'This week on the site';
    const text = discordDigestText(content, origin);
    return { title, text, message: discordMessage({ title, text, url: `${origin}/?utm_source=discord` }) };
  }

  /** The oldest question still waiting. */
  private async questionDraft(): Promise<Draft | null> {
    const waiting = await this.firebase.db.collection(Collections.discordQuestions).where('status', '==', 'waiting').get();
    const question = waiting.docs.map((d) => d.data() as DiscordQuestionRecord).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!question) return null;
    return { title: `Question of the week: ${question.question}`.slice(0, 256), text: question.answers.join(' · '), message: discordPollMessage(question), questionId: question.questionId };
  }

  /**
   * The week's totals, and the Discord accounts of the new members and course finishers who ticked "Celebrate my
   * milestones on Discord". Nobody else is named, and nothing here is about votes.
   */
  private async membersDraft(week: string, since: string, origin: string): Promise<Draft | null> {
    const db = this.firebase.db;
    const [joined, certificates, celebrating] = await Promise.all([
      this.members.approvedSince(since),
      db.collection(Collections.courseCertificates).where('issuedAt', '>=', since).get(),
      db.collection(Collections.discordLinks).where('celebrate', '==', true).get(),
    ]);
    const named = new Map(
      celebrating.docs.map((d) => d.data() as DiscordLinkRecord).flatMap((link) => (link.accountId && !link.unlinkedAt ? [[link.accountId, link.discordUserId] as const] : [])),
    );
    const finished = certificates.docs.map((d) => d.data() as CourseCertificateRecord).filter((c) => !c.revokedAt);
    const courseIds = [...new Set(finished.filter((c) => named.has(c.accountId)).map((c) => c.courseId))];
    const courses = courseIds.length ? await db.getAll(...courseIds.map((id) => db.collection(Collections.courses).doc(id))) : [];
    const titles = new Map(courses.map((snap) => [snap.id, (snap.data() as CourseRecord | undefined)?.title ?? 'A course']));
    const members: DiscordMembersWeek = {
      week,
      joined: joined.length,
      coursesFinished: finished.length,
      welcome: joined.flatMap((id) => (named.has(id) ? [named.get(id)!] : [])),
      finishers: finished.flatMap((c) => (named.has(c.accountId) ? [{ discordUserId: named.get(c.accountId)!, course: titles.get(c.courseId) ?? 'A course' }] : [])),
    };
    if (!discordMembersWeekHasNews(members)) return null;
    const title = 'What members did this week';
    const text = discordMembersWeekText(members);
    return { title, text, message: discordMessage({ title, text, url: `${origin}/?utm_source=discord` }) };
  }

  /** Claims the week's record, sends the post and ledgers it; `later` gives the claim up for the next tick. */
  private async post(loop: DiscordLoop, week: string, draft: Draft, channelId: string, token: string, origin: string, now: Date): Promise<'posted' | 'skipped' | 'failed' | 'later'> {
    const db = this.firebase.db;
    const postRef = discordLoopRef(loop, week);
    const ref = db.collection(Collections.discordPosts).doc(discordPostId(postRef));
    const record: DiscordPostRecord = {
      kind: 'community',
      ref: postRef,
      title: draft.title,
      text: draft.text,
      url: `${origin}/?utm_source=discord`,
      status: 'sending',
      channelId,
      messageId: null,
      problem: null,
      createdAt: now.toISOString(),
      sentAt: null,
    };
    const claimed = await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return false;
      tx.create(ref, record);
      return true;
    });
    if (!claimed) return 'skipped';
    const sent = await this.discord!.send(token, channelId, draft.message);
    if (!sent.ok && sent.retry) {
      await ref.delete();
      this.logger.warn(`Discord could not take a weekly post just now (${sent.problem}); it goes with the next tick`);
      return 'later';
    }
    if (!sent.ok) {
      const problem = loop === 'question' && /may not post/.test(sent.problem) ? `${sent.problem}, and Send Polls for the question of the week` : sent.problem;
      await ref.update({ status: 'failed', problem });
      this.logger.warn({ message: `Discord refused a weekly post: ${sent.problem}`, ref: postRef });
      return 'failed';
    }
    await db.runTransaction(async (tx) => {
      const payload: DiscordPostedPayload = { ref: postRef, kind: 'community', channelId, messageId: sent.messageId };
      await this.ledger.record(tx, [{ type: 'discord.posted', actor: 'system', subject: null, payload: { ...payload } }]);
      tx.update(ref, { status: 'sent', messageId: sent.messageId, sentAt: new Date().toISOString() });
      if (draft.questionId) {
        tx.update(db.collection(Collections.discordQuestions).doc(draft.questionId), { status: 'posted', week, postedAt: now.toISOString(), messageId: sent.messageId });
      }
    });
    return 'posted';
  }

  /**
   * A Communications Admin's request for the Start here message: posted and pinned the first time, changed in place
   * after that (posted anew if someone deleted it, or the channel changed). Returns 1 if Discord took a new post.
   */
  private async startHere(origin: string, now: Date): Promise<number> {
    const ref = this.firebase.db.collection(Collections.discordState).doc('start_here');
    const asked = (await ref.get()).data() as DiscordStartHereRecord | undefined;
    if (asked?.status !== 'waiting') return 0;
    const done = (change: Partial<DiscordStartHereRecord>) => ref.update({ ...change, doneAt: now.toISOString() });
    const token = await this.token.read();
    if (!token) {
      await done({ status: 'failed', problem: "the bot's token has not been added: a System Admin adds it under Admin › API keys" });
      return 0;
    }
    const message = discordStartHereMessage(origin);
    let sent: DiscordSend | null = null;
    let fresh = false;
    if (asked.messageId && asked.postedIn === asked.channelId) {
      sent = await this.discord!.edit(token, asked.channelId, asked.messageId, message);
      if (!sent.ok && sent.retry) return 0;
    }
    if (!sent?.ok) {
      sent = await this.discord!.send(token, asked.channelId, message);
      fresh = sent.ok;
      if (!sent.ok && sent.retry) return 0;
    }
    if (!sent.ok) {
      await done({ status: 'failed', problem: sent.problem });
      return 0;
    }
    const pinned = fresh ? await this.discord!.pin(token, asked.channelId, sent.messageId) : null;
    await done({
      status: 'posted',
      messageId: sent.messageId,
      postedIn: asked.channelId,
      pinned: pinned ? pinned.ok : asked.pinned,
      problem: pinned && !pinned.ok ? `it was posted, but not pinned: ${pinned.problem}` : null,
    });
    return fresh ? 1 : 0;
  }
}
