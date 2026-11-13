import { createHash, randomBytes, randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import {
  ALREADY_ANSWERED,
  checkPollAddress,
  checkPollOpen,
  closePoll,
  Collections,
  isTrappedVote,
  isUuidV7,
  newPoll,
  pollClosesAt,
  pollDay,
  pollItem,
  pollState,
  POLL_TALLY_SHARDS,
  publicPoll,
  publishPoll,
  sumPollTallies,
  updatePoll,
  uuidv7,
  type AdminPoll,
  type CreatePollInput,
  type PollAddressCountRecord,
  type PollLimitsRecord,
  type PollRecord,
  type PollResults,
  type PollTallyRecord,
  type PollVoteInput,
  type PublicPoll,
  type ShareCountsRecord,
  type UpdatePollInput,
} from 'ustp-domain';
import { accepted, assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';

/** Who answered: someone signed out, by their network address; or someone signed in, by their account. */
export type PollVoter = { readonly address: string } | { readonly accountId: string };

/** The most published polls the public list shows. */
const LIST_SIZE = 100;
/** How many closed polls' results an instance keeps. */
const CLOSED_KEPT = 500;
/** Deletes go in batches of this many. */
const BATCH = 400;

/** A short, one-way name for a key within one poll: the poll's ID is in the hash, so two polls' marks cannot be matched. */
const hashed = (pollId: string, key: string) => createHash('sha256').update(`${pollId}:${key}`).digest('hex').slice(0, 32);

/**
 * Issue polls (design §10.15): Communications Admins write and publish them; anyone answers. Not ledgered: a poll
 * decides nothing, and its marks are deleted. Each answer is one transaction: the poll is open, this browser (and
 * account) has not answered, the address has room today, then the marks are made and one of the poll's count
 * documents goes up by one.
 */
@Injectable()
export class PollsService {
  /** Today's salt for counting addresses, kept by this instance once read. */
  private salt: PollLimitsRecord | null = null;
  /**
   * Closed polls' results, which no longer change, kept by this instance so that the public list and link previews do
   * not count them again on every request.
   */
  private readonly closedResults = new Map<string, PollResults>();

  constructor(
    private readonly firebase: Firebase,
    private readonly members: MemberDirectory,
  ) {}

  private col(name: string) {
    return this.firebase.db.collection(name);
  }

  private pollRef(pollId: string) {
    return this.col(Collections.polls).doc(pollId);
  }

  private shardRefs(pollId: string): DocumentReference[] {
    return Array.from({ length: POLL_TALLY_SHARDS }, (_, shard) => this.col(Collections.pollTallies).doc(`${pollId}_${shard}`));
  }

  private browserMark(pollId: string, voter: string) {
    return this.col(Collections.pollMarks).doc(`${pollId}_b${hashed(pollId, voter)}`);
  }

  private accountMark(pollId: string, accountId: string) {
    return this.col(Collections.pollMarks).doc(`${pollId}_a${hashed(pollId, accountId)}`);
  }

  /** A poll by its ID, drafts too; null for no such poll or an ID that is not one (design §14: `%2F` in IDs). */
  async find(pollId: string): Promise<PollRecord | null> {
    if (!isUuidV7(pollId)) return null;
    const snap = await this.pollRef(pollId).get();
    return (snap.data() as PollRecord | undefined) ?? null;
  }

  /** A published poll; null for a draft or none. */
  async findPublished(pollId: string): Promise<PollRecord | null> {
    const poll = await this.find(pollId);
    return poll?.status === 'published' ? poll : null;
  }

  async results(poll: PollRecord, now = new Date()): Promise<PollResults> {
    const closed = pollState(poll, now) === 'closed';
    const kept = closed ? this.closedResults.get(poll.pollId) : undefined;
    if (kept) return kept;
    const snaps = await this.firebase.db.getAll(...this.shardRefs(poll.pollId));
    const results = sumPollTallies(
      poll.choices,
      snaps.map((s) => (s.data() as PollTallyRecord | undefined) ?? {}),
    );
    if (closed) {
      if (this.closedResults.size >= CLOSED_KEPT) this.closedResults.clear();
      this.closedResults.set(poll.pollId, results);
    }
    return results;
  }

  // --- The public --------------------------------------------------------------------------------------------------

  /** Whether this browser (by its token) or this account has answered. */
  private async answered(pollId: string, voter: string | null, accountId: string | null): Promise<boolean> {
    const refs = [...(voter ? [this.browserMark(pollId, voter)] : []), ...(accountId ? [this.accountMark(pollId, accountId)] : [])];
    if (!refs.length) return false;
    return (await this.firebase.db.getAll(...refs)).some((s) => s.exists);
  }

  /** Published polls: open ones, newest first, then closed ones, most recently closed first. */
  async list(voter: string | null, accountId: string | null = null, now = new Date()): Promise<PublicPoll[]> {
    const snap = await this.col(Collections.polls).where('status', '==', 'published').get();
    const polls = snap.docs.map((d) => d.data() as PollRecord);
    const open = polls.filter((p) => pollState(p, now) === 'open').sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!));
    const closed = polls
      .filter((p) => pollState(p, now) === 'closed')
      .sort((a, b) => pollClosesAt(b)!.localeCompare(pollClosesAt(a)!));
    return Promise.all([...open, ...closed].slice(0, LIST_SIZE).map((p) => this.view(p, voter, accountId, now)));
  }

  private async view(poll: PollRecord, voter: string | null, accountId: string | null, now: Date): Promise<PublicPoll> {
    const voted = await this.answered(poll.pollId, voter, accountId);
    const shown = voted || pollState(poll, now) === 'closed';
    return publicPoll(poll, shown ? await this.results(poll) : sumPollTallies(poll.choices, []), voted, now);
  }

  /** One published poll as `voter` (a browser's token) or `accountId` sees it; 404 for a draft or none. */
  async publicView(pollId: string, voter: string | null, accountId: string | null = null, now = new Date()): Promise<PublicPoll> {
    const poll = await this.findPublished(pollId);
    if (!poll) throw new NotFoundException('no such poll');
    return this.view(poll, voter, accountId, now);
  }

  /** Today's salt, made by the first answer of the day. */
  private async daySalt(day: string): Promise<string> {
    if (this.salt?.day === day) return this.salt.salt;
    const ref = this.col(Collections.pollLimits).doc(day);
    const record = await this.firebase.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return snap.data() as PollLimitsRecord;
      const made: PollLimitsRecord = { day, salt: randomBytes(32).toString('hex') };
      tx.create(ref, made);
      return made;
    });
    this.salt = record;
    return record.salt;
  }

  /**
   * Takes an answer. Signed out, it is held to one per browser and the address's number for the day; signed in, to
   * one per account (and per browser), and an Active member's is also counted among members. A form filler's answer
   * (the hidden field filled) is not counted, and is answered as if it were.
   */
  async vote(pollId: string, input: PollVoteInput, who: PollVoter, now = new Date()): Promise<PublicPoll> {
    const poll = await this.find(pollId);
    assertCheck(checkPollOpen(poll, now));
    if (!poll!.choices.some((c) => c.choiceId === input.choiceId)) throw new BadRequestException('choose one of the answers');
    if (isTrappedVote(input)) return publicPoll(poll!, await this.results(poll!), true, now);

    const day = pollDay(now);
    const accountId = 'accountId' in who ? who.accountId : null;
    const member = accountId ? (await this.members.find(accountId))?.status === 'active' : false;
    const marks = [this.browserMark(pollId, input.voter), ...(accountId ? [this.accountMark(pollId, accountId)] : [])];
    const address =
      'address' in who ? this.col(Collections.pollAddressCounts).doc(`${day}_${pollId}_${hashed(pollId, `${await this.daySalt(day)}:${who.address}`)}`) : null;
    const shard = this.col(Collections.pollTallies).doc(`${pollId}_${randomInt(POLL_TALLY_SHARDS)}`);
    const add = { [input.choiceId]: FieldValue.increment(1) };

    await this.firebase.db.runTransaction(async (tx) => {
      const [pollSnap, ...rest] = await tx.getAll(this.pollRef(pollId), ...marks, ...(address ? [address] : []));
      // Read again here, with the time now: a poll closed early, or reaching its time, takes no answer after.
      assertCheck(checkPollOpen((pollSnap!.data() as PollRecord | undefined) ?? null, new Date()));
      const markSnaps = rest.slice(0, marks.length);
      if (markSnaps.some((s) => s.exists)) throw new ConflictException(ALREADY_ANSWERED);
      if (address) {
        assertCheck(checkPollAddress((rest[marks.length]!.data() as PollAddressCountRecord | undefined)?.count ?? 0));
        tx.set(address, { day, pollId, count: FieldValue.increment(1) }, { merge: true });
      }
      for (const mark of marks) tx.create(mark, { pollId });
      tx.set(shard, { pollId, shard: Number(shard.id.split('_')[1]), everyone: add, ...(member ? { members: add } : {}) }, { merge: true });
    });
    return publicPoll(poll!, await this.results(poll!), true, now);
  }

  // --- Communications Admins ---------------------------------------------------------------------------------------

  private async adminView(poll: PollRecord, shares: Map<string, number>, now: Date): Promise<AdminPoll> {
    return { ...poll, state: pollState(poll, now), results: await this.results(poll), shared: shares.get(pollItem(poll.pollId)) ?? 0 };
  }

  private async shareCounts(polls: readonly PollRecord[]): Promise<Map<string, number>> {
    if (!polls.length) return new Map();
    const snaps = await this.firebase.db.getAll(...polls.map((p) => this.col(Collections.shareCounts).doc(pollItem(p.pollId))));
    return new Map(snaps.flatMap((s) => (s.exists ? [[s.id, (s.data() as ShareCountsRecord).total] as const] : [])));
  }

  /** Every poll: drafts, then open ones, then closed ones, each most recently changed first. */
  async all(now = new Date()): Promise<AdminPoll[]> {
    const polls = (await this.col(Collections.polls).get()).docs.map((d) => d.data() as PollRecord);
    const order = { draft: 0, open: 1, closed: 2 } as const;
    polls.sort((a, b) => order[pollState(a, now)] - order[pollState(b, now)] || b.updatedAt.localeCompare(a.updatedAt));
    const shares = await this.shareCounts(polls);
    return Promise.all(polls.map((p) => this.adminView(p, shares, now)));
  }

  async create(actor: string, input: CreatePollInput, now = new Date()): Promise<AdminPoll> {
    const poll = newPoll(input, uuidv7(now.getTime()), actor, now.toISOString());
    await this.pollRef(poll.pollId).create(poll);
    return this.adminView(poll, new Map(), now);
  }

  private async change(pollId: string, change: (poll: PollRecord, now: Date) => PollRecord, now = new Date()): Promise<AdminPoll> {
    const updated = await this.firebase.db.runTransaction(async (tx) => {
      const snap = isUuidV7(pollId) ? await tx.get(this.pollRef(pollId)) : null;
      const current = (snap?.data() as PollRecord | undefined) ?? null;
      if (!current) throw new NotFoundException('no such poll');
      const next = change(current, now);
      tx.set(this.pollRef(pollId), next);
      return next;
    });
    return this.adminView(updated, await this.shareCounts([updated]), now);
  }

  update(actor: string, pollId: string, input: UpdatePollInput): Promise<AdminPoll> {
    return this.change(pollId, (poll, now) => accepted(updatePoll(poll, input, actor, now.toISOString())));
  }

  publish(actor: string, pollId: string, basedOn: number): Promise<AdminPoll> {
    return this.change(pollId, (poll, now) => accepted(publishPoll(poll, basedOn, actor, now)));
  }

  close(actor: string, pollId: string, basedOn: number): Promise<AdminPoll> {
    return this.change(pollId, (poll, now) => accepted(closePoll(poll, basedOn, actor, now)));
  }

  /** Deletes a poll, draft or published, with its counts, marks and share count: it leaves the site at once. */
  async delete(pollId: string): Promise<void> {
    const poll = await this.find(pollId);
    if (!poll) throw new NotFoundException('no such poll');
    await this.deleteWhere(Collections.pollMarks, 'pollId', '==', pollId);
    await this.deleteWhere(Collections.pollAddressCounts, 'pollId', '==', pollId);
    const batch = this.firebase.db.batch();
    for (const ref of this.shardRefs(pollId)) batch.delete(ref);
    batch.delete(this.col(Collections.shareCounts).doc(pollItem(pollId)));
    batch.delete(this.pollRef(pollId));
    await batch.commit();
    this.closedResults.delete(pollId);
  }

  private async deleteWhere(collection: string, field: string, op: '==' | '<', value: string): Promise<number> {
    let deleted = 0;
    for (;;) {
      const snap = await this.col(collection).where(field, op, value).limit(BATCH).get();
      if (snap.empty) return deleted;
      const batch = this.firebase.db.batch();
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
      deleted += snap.size;
    }
  }

  /**
   * The worker's tick (design §13): the "has answered" marks of polls that have closed, which are needed only while a
   * poll is open, and the address counts and salts of days before yesterday. Returns how many marks were deleted.
   */
  async clearClosed(now = new Date()): Promise<number> {
    let deleted = 0;
    const pending = await this.col(Collections.polls).where('marksCleared', '==', false).get();
    for (const doc of pending.docs) {
      const poll = doc.data() as PollRecord;
      if (pollState(poll, now) !== 'closed') continue;
      deleted += await this.deleteWhere(Collections.pollMarks, 'pollId', '==', poll.pollId);
      await doc.ref.update({ marksCleared: true });
    }
    const yesterday = pollDay(new Date(now.getTime() - 86_400_000));
    await this.deleteWhere(Collections.pollAddressCounts, 'day', '<', yesterday);
    await this.deleteWhere(Collections.pollLimits, 'day', '<', yesterday);
    return deleted;
  }
}
