import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  citations,
  newMessage,
  ROOM_LIMITS,
  ROOM_RETENTION,
  expiresAfter,
  uuidv7,
  type RoomJobRecord,
  type RoomMemoryRecord,
  type RoomMessageRecord,
  type RoomSource,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { ROOM_MODEL, RoomModelBudgetSpent, RoomModelWaking, type AskSource, type RoomModel } from './room-model.js';
import { RoomRepository } from './room.repository.js';

/** Sources a question is answered from, at most: the nearest by meaning first, then the latest decisions and open tasks. */
const MAX_SOURCES = 40;
/** Messages and memory items embedded per round, and rounds per question (the rest wait for the next). */
const EMBED_BATCH = 64;
const EMBED_ROUNDS = 8;
/**
 * How long a run may take: inside the worker's 300-second request (and the task's deadline), so a model slow to start
 * fails the question with a reply rather than being cut off mid-run, which would leave it waiting 10 minutes.
 */
const RUN_MS = 270_000;
/** Embedding stops while this much of the run is left, for the answer. */
const ANSWER_MS = 150_000;

interface Candidate {
  readonly prompt: AskSource;
  readonly source: RoomSource;
}

/**
 * The room's assistant answering a question (design §5.10): run by the worker for the Cloud Task the api queued (or by
 * the api itself with the emulators). It embeds what the room said since the last question, finds the messages and
 * memory nearest the question, adds the latest decisions and open action items, has the room's model answer from those
 * alone, keeps only citations of what it was given, and posts the answer with links to its sources. A question it
 * cannot answer gets a reply saying why, never the room's text in a log.
 */
@Injectable()
export class RoomAssistant {
  private readonly logger = new Logger(RoomAssistant.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly repo: RoomRepository,
    @Inject(ROOM_MODEL) private readonly model: RoomModel,
    private readonly members: MemberDirectory,
  ) {}

  /**
   * Answers the job's question once; a job already taken, finished or cancelled is skipped. If the model on Vertex AI is
   * still waking up, the job goes back in the queue (`waking`) for its task to be tried again.
   */
  async run(jobId: string): Promise<'answered' | 'failed' | 'skipped' | 'waking'> {
    const job = await this.claim(jobId);
    if (!job) return 'skipped';
    const until = Date.now() + RUN_MS;
    try {
      if (this.model.kind === 'off') throw new Error('the room has no model on this deployment');
      await this.embedPending(until);
      // Switched off, or the question deleted, meanwhile: nothing more goes to the model.
      if (!(await this.stillRunning(jobId))) return 'skipped';
      const candidates = await this.sources(job, until);
      const [asker] = await this.members.findMany([job.askedBy]);
      if (!(await this.stillRunning(jobId))) return 'skipped';
      const raw = await this.model.answer(
        { text: job.question, by: asker ? (asker.preferredName ?? asker.legalName) : 'a member', today: new Date().toISOString().slice(0, 10) },
        candidates.map((c) => c.prompt),
        until,
      );
      const { text, cited } = citations(raw, candidates.length);
      await this.finish(job, text || 'The room’s memory does not say.', cited.map((i) => candidates[i - 1]!.source));
      return 'answered';
    } catch (e) {
      if (e instanceof RoomModelWaking && (await this.requeue(jobId))) return 'waking';
      const reason = e instanceof Error ? e.message : 'something went wrong';
      this.logger.warn(`room question ${jobId} failed: ${reason}`);
      await this.fail(jobId, reason, !(e instanceof RoomModelBudgetSpent));
      return 'failed';
    }
  }

  /** Puts a running job back in the queue, for its task's next try; false if it is no longer running. */
  private requeue(jobId: string): Promise<boolean> {
    return this.firebase.db.runTransaction(async (tx) => {
      const job = await this.repo.getJob(tx, jobId);
      if (job?.state !== 'running') return false;
      this.repo.setJob(tx, { ...job, state: 'queued', startedAt: null });
      return true;
    });
  }

  /**
   * Gives up on a question with a reply saying why: the model failed, the question could not be queued, it waited past
   * `ROOM_LIMITS.jobMinutes`, or the model's monthly budget is spent (then without "ask again in a minute"). Nothing
   * happens to one already finished or cancelled.
   */
  async fail(jobId: string, reason: string, askAgain = true): Promise<boolean> {
    return this.firebase.db.runTransaction(async (tx) => {
      const job = await this.repo.getJob(tx, jobId);
      if (!job || (job.state !== 'queued' && job.state !== 'running')) return false;
      const feed = await this.repo.getFeed(tx);
      const at = new Date().toISOString();
      const seq = feed.seq + 1;
      const reply = newMessage(
        { messageId: uuidv7(), kind: 'assistant', authorId: null, body: `I could not answer this: ${reason}.${askAgain ? ' Ask again in a minute.' : ''}`, createdAt: at, replyTo: job.questionId },
        seq,
      );
      this.repo.createMessage(tx, reply);
      this.repo.setJob(tx, { ...job, state: 'failed', finishedAt: at, answerId: reply.messageId, error: reason, expireAt: expiresAfter(at, ROOM_RETENTION.jobDays) });
      this.repo.setFeed(tx, { ...feed, seq, pending: feed.pending.filter((id) => id !== job.questionId) });
      return true;
    });
  }

  /** Fails the questions waiting longer than `ROOM_LIMITS.jobMinutes` (a lost task, a crashed run); for the tick. */
  async failStale(): Promise<number> {
    const before = new Date(Date.now() - ROOM_LIMITS.jobMinutes * 60_000).toISOString();
    let failed = 0;
    for (const job of await this.repo.staleJobs(before)) {
      if (await this.fail(job.jobId, `it took longer than ${ROOM_LIMITS.jobMinutes} minutes`)) failed++;
    }
    return failed;
  }

  private async stillRunning(jobId: string): Promise<boolean> {
    return (await this.firebase.db.runTransaction((tx) => this.repo.getJob(tx, jobId)))?.state === 'running';
  }

  /**
   * Starts the model server and loads both models, after a System Admin switches it on, so the next question need not
   * wait for them. Nothing from the room is sent. True if the models answered.
   */
  async warm(): Promise<boolean> {
    if (this.model.kind === 'off' || !(await this.repo.findFeed()).serverOn) return false;
    await this.model.warm(Date.now() + RUN_MS);
    return true;
  }

  /** Takes a queued job; while the assistant or its server is switched off, cancels it instead. */
  private claim(jobId: string): Promise<RoomJobRecord | null> {
    return this.firebase.db.runTransaction(async (tx) => {
      const job = await this.repo.getJob(tx, jobId);
      if (!job || job.state !== 'queued') return null;
      const feed = await this.repo.getFeed(tx);
      const at = new Date().toISOString();
      if (!feed.assistantOn || !feed.serverOn) {
        this.repo.setJob(tx, { ...job, state: 'cancelled', finishedAt: at, expireAt: expiresAfter(at, ROOM_RETENTION.jobDays) });
        return null;
      }
      const running: RoomJobRecord = { ...job, state: 'running', startedAt: at };
      this.repo.setJob(tx, running);
      return running;
    });
  }

  /** Posts the answer, unless the assistant was switched off meanwhile (the job is then cancelled). */
  private async finish(job: RoomJobRecord, body: string, sources: readonly RoomSource[]): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const current = await this.repo.getJob(tx, job.jobId);
      if (current?.state !== 'running') return;
      const feed = await this.repo.getFeed(tx);
      const at = new Date().toISOString();
      const seq = feed.seq + 1;
      const answer = newMessage({ messageId: uuidv7(), kind: 'assistant', authorId: null, body, createdAt: at, replyTo: job.questionId, sources: [...sources] }, seq);
      this.repo.createMessage(tx, answer);
      this.repo.setJob(tx, { ...current, state: 'done', finishedAt: at, answerId: answer.messageId, expireAt: expiresAfter(at, ROOM_RETENTION.jobDays) });
      this.repo.setFeed(tx, { ...feed, seq, pending: feed.pending.filter((id) => id !== job.questionId) });
    });
  }

  /** Embeds members' messages and memory items made or changed since the last question, while time allows. */
  private async embedPending(until: number): Promise<void> {
    for (let round = 0; round < EMBED_ROUNDS && until - Date.now() > ANSWER_MS; round++) {
      const { messages, items } = await this.repo.unembedded(EMBED_BATCH);
      if (!messages.length && !items.length) return;
      if (messages.length) {
        const vectors = await this.model.embed(messages.map((m) => m.body), 'document', until);
        await this.repo.saveEmbeddings('message', messages.map((m, i) => ({ id: m.messageId, vector: vectors[i]!, stamp: '' })), this.model.embedder);
      }
      if (items.length) {
        const vectors = await this.model.embed(items.map(itemText), 'document', until);
        await this.repo.saveEmbeddings('item', items.map((it, i) => ({ id: it.itemId, vector: vectors[i]!, stamp: it.updatedAt })), this.model.embedder);
      }
    }
  }

  /**
   * The sources for a question, numbered as the model sees them: the messages and memory nearest the question by
   * meaning, then the latest decisions, open action items and the last messages, at most `MAX_SOURCES`, shown as
   * decisions, then action items, then messages in the order they were posted.
   */
  private async sources(job: RoomJobRecord, until: number): Promise<Candidate[]> {
    const [query] = await this.model.embed([job.question], 'query', until);
    const [nearMessages, nearItems, decisions, actions, recent] = await Promise.all([
      this.repo.nearestMessages(query!, 20),
      this.repo.nearestItems(query!, 12),
      this.repo.latestDecisions(10),
      this.repo.openActions(20),
      this.repo.recentMemberMessages(15),
    ]);
    // Members' messages only, not questions put to the assistant: a question is not something the room knows.
    const usable = (m: RoomMessageRecord) => m.kind === 'member' && !m.ask && !m.deletedAt;
    const picked = new Map<string, Picked>();
    const add = (p: Picked) => {
      const id = p.type === 'message' ? p.record.messageId : p.record.itemId;
      if (picked.size < MAX_SOURCES && !picked.has(id)) picked.set(id, p);
    };
    const message = (record: RoomMessageRecord): Picked => ({ type: 'message', record });
    const item = (record: RoomMemoryRecord): Picked => ({ type: 'item', record });
    nearItems.forEach((n) => add(item(n.record)));
    nearMessages.map((n) => n.record).filter(usable).forEach((m) => add(message(m)));
    decisions.forEach((d) => add(item(d)));
    actions.forEach((a) => add(item(a)));
    recent.filter(usable).forEach((m) => add(message(m)));

    const all = [...picked.values()];
    const ids = [
      ...new Set(
        all.flatMap((p) => (p.type === 'message' ? (p.record.authorId ? [p.record.authorId] : []) : p.record.kind === 'action' ? [p.record.ownerId] : [])),
      ),
    ];
    const found = await this.members.findMany(ids);
    const names = new Map(ids.map((id, i) => [id, found[i] ? (found[i]!.preferredName ?? found[i]!.legalName) : 'a former member']));
    const rank = (p: Picked) => (p.type === 'message' ? 2 : p.record.kind === 'decision' ? 0 : 1);
    return all
      .sort((a, b) => rank(a) - rank(b) || a.record.createdAt.localeCompare(b.record.createdAt))
      .map((p): Candidate => {
        if (p.type === 'message') {
          const m = p.record;
          return {
            prompt: { kind: 'message', at: m.createdAt, who: m.authorId ? (names.get(m.authorId) ?? null) : null, text: m.body, detail: null },
            source: { kind: 'message', id: m.messageId, excerpt: m.body.slice(0, 200), at: m.createdAt },
          };
        }
        const r = p.record;
        const who = r.kind === 'action' ? (names.get(r.ownerId) ?? null) : null;
        const detail = r.kind === 'action' ? [r.due && `due ${r.due}`, r.status].filter(Boolean).join(', ') : null;
        return {
          prompt: { kind: r.kind, at: r.createdAt, who, text: itemText(r), detail },
          source: { kind: r.kind, id: r.itemId, excerpt: r.text.slice(0, 200), at: r.createdAt },
        };
      });
  }
}

/** A source picked for a question: a message or a memory item (a decision has a `messageId` too, so tag them). */
type Picked = { readonly type: 'message'; readonly record: RoomMessageRecord } | { readonly type: 'item'; readonly record: RoomMemoryRecord };

/** What a memory item says, for the search and the model: a decision with the message it came from. */
function itemText(item: RoomMemoryRecord): string {
  return item.kind === 'decision' && item.quote ? `${item.text} (from the message: ${item.quote})` : item.text;
}
