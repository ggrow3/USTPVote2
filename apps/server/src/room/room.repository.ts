import { Injectable } from '@nestjs/common';
import { FieldValue, type CollectionReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  EMPTY_FEED,
  ROOM_TERMS,
  voiceLive,
  type RoomConsentRecord,
  type RoomFeedRecord,
  type RoomJobRecord,
  type RoomMemoryRecord,
  type RoomMessageRecord,
  type RoomSignalRecord,
  type RoomVoiceRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/** A message or memory item the vector search found, nearest first. */
export interface Nearest<T> {
  readonly record: T;
  readonly distance: number;
}

/**
 * Storage of the members' room (design §5.10, §11): `room_consents`, `room_messages`, `room_memory`, `room_jobs`,
 * `room_voice`, `room_signals` and `room_state/feed`. Only the room context uses it. Members' messages and memory items carry an `embedding` (a
 * Firestore vector, top-level so the emulator finds it too) and `embedModel`, the model that made it, null until the
 * assistant embeds them; the vector search needs the vector indexes in `firestore.indexes.json`.
 */
@Injectable()
export class RoomRepository {
  constructor(private readonly firebase: Firebase) {}

  private consents() {
    return this.firebase.db.collection(Collections.roomConsents);
  }

  private messages() {
    return this.firebase.db.collection(Collections.roomMessages);
  }

  private memory() {
    return this.firebase.db.collection(Collections.roomMemory);
  }

  private jobs() {
    return this.firebase.db.collection(Collections.roomJobs);
  }

  private feedDoc() {
    return this.firebase.db.collection(Collections.roomState).doc('feed');
  }

  private voice() {
    return this.firebase.db.collection(Collections.roomVoice);
  }

  private signals() {
    return this.firebase.db.collection(Collections.roomSignals);
  }

  // --- consent ---------------------------------------------------------------------------------------------------

  async findConsent(accountId: string): Promise<RoomConsentRecord | null> {
    return ((await this.consents().doc(accountId).get()).data() as RoomConsentRecord | undefined) ?? null;
  }

  async getConsent(tx: Transaction, accountId: string): Promise<RoomConsentRecord | null> {
    return ((await tx.get(this.consents().doc(accountId))).data() as RoomConsentRecord | undefined) ?? null;
  }

  setConsent(tx: Transaction, consent: RoomConsentRecord): void {
    tx.set(this.consents().doc(consent.accountId), consent);
  }

  /** Everyone who accepted the current terms and has not left (some may no longer be Active). */
  async consentedIds(): Promise<string[]> {
    const snap = await this.consents().where('withdrawnAt', '==', null).where('termsVersion', '==', ROOM_TERMS.version).get();
    return snap.docs.map((d) => (d.data() as RoomConsentRecord).accountId);
  }

  // --- the feed --------------------------------------------------------------------------------------------------

  /** The feed, with defaults for fields added since it was written. */
  async findFeed(): Promise<RoomFeedRecord> {
    return { ...EMPTY_FEED, ...((await this.feedDoc().get()).data() as RoomFeedRecord | undefined) };
  }

  async getFeed(tx: Transaction): Promise<RoomFeedRecord> {
    return { ...EMPTY_FEED, ...((await tx.get(this.feedDoc())).data() as RoomFeedRecord | undefined) };
  }

  setFeed(tx: Transaction, feed: RoomFeedRecord): void {
    tx.set(this.feedDoc(), feed);
  }

  /** Calls `onSeq` with the feed's number now and at every change, until the returned function is called. */
  watchFeed(onSeq: (seq: number) => void, onError: (e: Error) => void): () => void {
    return this.feedDoc().onSnapshot((snap) => onSeq((snap.data() as RoomFeedRecord | undefined)?.seq ?? 0), onError);
  }

  // --- messages --------------------------------------------------------------------------------------------------

  /** A new message; members' messages wait to be embedded. */
  createMessage(tx: Transaction, message: RoomMessageRecord): void {
    tx.create(this.messages().doc(message.messageId), { ...message, ...(message.kind === 'member' && { embedModel: null }) });
  }

  /** A changed message; a deleted one loses its vector, so no search finds it. */
  setMessage(tx: Transaction, message: RoomMessageRecord): void {
    tx.set(this.messages().doc(message.messageId), message.deletedAt ? { ...message, embedding: FieldValue.delete() } : message, { merge: true });
  }

  async getMessage(tx: Transaction, messageId: string): Promise<RoomMessageRecord | null> {
    const snap = await tx.get(this.messages().doc(messageId));
    return snap.exists ? asMessage(snap) : null;
  }

  /** Up to `limit` messages before `before` (or the latest), newest first, with one more to tell whether older ones exist. */
  async history(before: string | undefined, limit: number): Promise<RoomMessageRecord[]> {
    let query = this.messages().orderBy('messageId', 'desc');
    if (before) query = query.where('messageId', '<', before);
    return (await query.limit(limit + 1).get()).docs.map(asMessage);
  }

  /** Messages made or changed after feed number `since`, in that order, up to `limit`. */
  async changedSince(since: number, limit: number): Promise<RoomMessageRecord[]> {
    return (await this.messages().where('seq', '>', since).orderBy('seq').limit(limit).get()).docs.map(asMessage);
  }

  /** The latest members' messages, newest first. */
  async recentMemberMessages(limit: number): Promise<RoomMessageRecord[]> {
    const snap = await this.messages().where('kind', '==', 'member').orderBy('messageId', 'desc').limit(limit).get();
    return snap.docs.map(asMessage).filter((m) => !m.deletedAt);
  }

  /** The assistant's answers citing a message or memory item, which are erased with it. */
  async getAnswersCiting(tx: Transaction, id: string): Promise<RoomMessageRecord[]> {
    return (await tx.get(this.messages().where('cites', 'array-contains', id))).docs.map(asMessage);
  }

  /** Notices about a memory item, which are erased with it. */
  async getNoticesAbout(tx: Transaction, itemId: string): Promise<RoomMessageRecord[]> {
    return (await tx.get(this.messages().where('ref.itemId', '==', itemId))).docs.map(asMessage);
  }

  /** How many messages the member posted since `since`. */
  async postedSince(authorId: string, since: string): Promise<number> {
    const snap = await this.messages().where('authorId', '==', authorId).where('createdAt', '>=', since).count().get();
    return snap.data().count;
  }

  // --- the call --------------------------------------------------------------------------------------------------

  /** Everyone with a record in the call, live or not (eight or so). */
  async allVoice(): Promise<RoomVoiceRecord[]> {
    return (await this.voice().get()).docs.map((d) => d.data() as RoomVoiceRecord);
  }

  async getAllVoice(tx: Transaction): Promise<RoomVoiceRecord[]> {
    return (await tx.get(this.voice())).docs.map((d) => d.data() as RoomVoiceRecord);
  }

  async getVoiceOf(tx: Transaction, accountId: string): Promise<RoomVoiceRecord | null> {
    return ((await tx.get(this.voice().doc(accountId))).data() as RoomVoiceRecord | undefined) ?? null;
  }

  setVoice(tx: Transaction, record: RoomVoiceRecord): void {
    tx.set(this.voice().doc(record.accountId), record);
  }

  deleteVoice(tx: Transaction, accountId: string): void {
    tx.delete(this.voice().doc(accountId));
  }

  createSignal(tx: Transaction, signal: RoomSignalRecord): void {
    tx.create(this.signals().doc(signal.signalId), signal);
  }

  /** Handshakes sent to the member after feed number `since`, in order. */
  async signalsFor(accountId: string, since: number): Promise<RoomSignalRecord[]> {
    const snap = await this.signals().where('to', '==', accountId).where('seq', '>', since).orderBy('seq').limit(50).get();
    return snap.docs.map((d) => d.data() as RoomSignalRecord);
  }

  /**
   * Drops from the call everyone whose page went quiet (closed without leaving, or lost), telling open pages; returns
   * how many went.
   */
  async sweepVoice(now: string): Promise<number> {
    return this.firebase.db.runTransaction(async (tx) => {
      const [feed, call] = await Promise.all([this.getFeed(tx), this.getAllVoice(tx)]);
      const stale = call.filter((v) => !voiceLive(v, now));
      if (!stale.length) return 0;
      for (const v of stale) this.deleteVoice(tx, v.accountId);
      this.setFeed(tx, { ...feed, seq: feed.seq + 1, voiceSeq: feed.seq + 1 });
      return stale.length;
    });
  }

  // --- memory ----------------------------------------------------------------------------------------------------

  /** A new or changed item; a changed one waits to be embedded again. */
  setItem(tx: Transaction, item: RoomMemoryRecord): void {
    tx.set(this.memory().doc(item.itemId), { ...item, embedModel: null, embedding: FieldValue.delete() }, { merge: true });
  }

  async getItem(tx: Transaction, itemId: string): Promise<RoomMemoryRecord | null> {
    const snap = await tx.get(this.memory().doc(itemId));
    return snap.exists ? asItem(snap) : null;
  }

  deleteItem(tx: Transaction, itemId: string): void {
    tx.delete(this.memory().doc(itemId));
  }

  /** Everything in memory (a room's decisions and action items run to hundreds, not more). */
  async allItems(): Promise<RoomMemoryRecord[]> {
    return (await this.memory().limit(5000).get()).docs.map(asItem);
  }

  async latestDecisions(limit: number): Promise<RoomMemoryRecord[]> {
    const snap = await this.memory().where('kind', '==', 'decision').orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map(asItem);
  }

  async openActions(limit: number): Promise<RoomMemoryRecord[]> {
    return (await this.memory().where('kind', '==', 'action').where('status', '==', 'open').limit(limit).get()).docs.map(asItem);
  }

  // --- jobs ------------------------------------------------------------------------------------------------------

  createJob(tx: Transaction, job: RoomJobRecord): void {
    tx.create(this.jobs().doc(job.jobId), job);
  }

  setJob(tx: Transaction, job: RoomJobRecord): void {
    tx.set(this.jobs().doc(job.jobId), job);
  }

  async getJob(tx: Transaction, jobId: string): Promise<RoomJobRecord | null> {
    return ((await tx.get(this.jobs().doc(jobId))).data() as RoomJobRecord | undefined) ?? null;
  }

  async getJobsFor(tx: Transaction, questionIds: readonly string[]): Promise<RoomJobRecord[]> {
    if (!questionIds.length) return [];
    return (await tx.get(this.jobs().where('questionId', 'in', questionIds.slice(0, 30)))).docs.map((d) => d.data() as RoomJobRecord);
  }

  /** How many questions the member asked since `since` (finished jobs are kept a day, so this counts them). */
  async askedSince(accountId: string, since: string): Promise<number> {
    return (await this.jobs().where('askedBy', '==', accountId).where('createdAt', '>=', since).count().get()).data().count;
  }

  /** Questions still waiting or running that were asked before `before`. */
  async staleJobs(before: string): Promise<RoomJobRecord[]> {
    const snap = await this.jobs().where('state', 'in', ['queued', 'running']).where('createdAt', '<', before).limit(50).get();
    return snap.docs.map((d) => d.data() as RoomJobRecord);
  }

  // --- the assistant's search ------------------------------------------------------------------------------------

  /** Members' messages and memory items not yet embedded by `model` (nothing deleted). */
  async unembedded(limit: number): Promise<{ messages: RoomMessageRecord[]; items: RoomMemoryRecord[] }> {
    const [messages, items] = await Promise.all([
      this.messages().where('kind', '==', 'member').where('embedModel', '==', null).where('deletedAt', '==', null).limit(limit).get(),
      this.memory().where('embedModel', '==', null).limit(limit).get(),
    ]);
    return { messages: messages.docs.map(asMessage), items: items.docs.map(asItem) };
  }

  /** Stores vectors; a message deleted or an item changed or forgotten meanwhile is left alone. */
  async saveEmbeddings(kind: 'message' | 'item', vectors: readonly { id: string; vector: number[]; stamp: string }[], model: string): Promise<void> {
    const collection = kind === 'message' ? this.messages() : this.memory();
    await Promise.all(
      vectors.map(({ id, vector, stamp }) =>
        this.firebase.db.runTransaction(async (tx) => {
          const snap = await tx.get(collection.doc(id));
          const data = snap.data();
          if (!data || data.embedModel !== null || (kind === 'message' ? data.deletedAt !== null : data.updatedAt !== stamp)) return;
          tx.update(collection.doc(id), { embedding: FieldValue.vector(vector), embedModel: model });
        }),
      ),
    );
  }

  async nearestMessages(vector: number[], limit: number): Promise<Nearest<RoomMessageRecord>[]> {
    return this.nearest(this.messages(), vector, limit);
  }

  async nearestItems(vector: number[], limit: number): Promise<Nearest<RoomMemoryRecord>[]> {
    return this.nearest(this.memory(), vector, limit);
  }

  private async nearest<T>(collection: CollectionReference, vector: number[], limit: number): Promise<Nearest<T>[]> {
    const snap = await collection
      .findNearest({ vectorField: 'embedding', queryVector: vector, limit, distanceMeasure: 'COSINE', distanceResultField: '_distance' })
      .get();
    return snap.docs.map((d) => ({ record: strip<T>(d), distance: Number(d.get('_distance')) }));
  }

  // --- retention -------------------------------------------------------------------------------------------------

  /**
   * Deletes up to `limit` each of messages, action items, finished jobs and handshakes whose `expireAt` is before
   * `now`; returns how many went.
   */
  async deleteExpired(now: string, limit: number): Promise<number> {
    const [messages, items, jobs, signals] = await Promise.all([
      this.messages().where('expireAt', '<', now).limit(limit).get(),
      this.memory().where('expireAt', '<', now).limit(limit).get(),
      this.jobs().where('expireAt', '<', now).limit(limit).get(),
      this.signals().where('expireAt', '<', now).limit(limit).get(),
    ]);
    const docs = [...messages.docs, ...items.docs, ...jobs.docs, ...signals.docs];
    for (let i = 0; i < docs.length; i += 400) {
      const batch = this.firebase.db.batch();
      for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
    return docs.length;
  }
}

/** A record without the search fields, which never leave the repository. */
function strip<T>(doc: DocumentSnapshot): T {
  const { embedding: _embedding, embedModel: _model, _distance: _d, ...record } = doc.data() as Record<string, unknown>;
  return record as T;
}

const asMessage = (doc: DocumentSnapshot) => strip<RoomMessageRecord>(doc);
const asItem = (doc: DocumentSnapshot) => strip<RoomMemoryRecord>(doc);
