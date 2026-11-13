import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  billId,
  billLabel,
  checkPositions,
  congressLabel,
  isMemberId,
  memberScorecard,
  PUBLIC_BILL_LIMITS,
  publicBillCard,
  publicBillView,
  publicSnapshot,
  scorecard,
  sortPublicBills,
  type BillPublicChangedPayload,
  type BillRef,
  type BillTopic,
  type PublicBillCard,
  type PublicBillInput,
  type PublicBillRecord,
  type PublicBillTeamView,
  type PublicBillView,
  type PublicRollCall,
  type RollCallRecord,
  type ScorecardMemberView,
  type ScorecardView,
} from 'ustp-domain';
import { assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { BILL_SOURCE, type BillSource } from './bill-source.js';
import { BillRepository } from './bill.repository.js';
import { ROLL_CALL_SOURCE, type RollCallSource } from './roll-call-source.js';
import { sourceError } from './source-error.js';

/** What the public pages read: every public bill and the roll calls on them that have been read. */
interface Snapshot {
  readonly bills: readonly PublicBillRecord[];
  readonly rollCalls: ReadonlyMap<string, RollCallRecord>;
}

/** How long one instance keeps what the public pages read; a save on the same instance clears it at once. */
const SNAPSHOT_MS = 60_000;
/** Roll calls read while a team member waits on Save; the worker reads the rest within the half hour. */
const ROLL_CALLS_PER_SAVE = 6;
/** Roll calls the worker reads per bill per read, the rest half an hour later. */
const ROLL_CALLS_PER_REFRESH = 10;
/** The worker reads public bills for at most this long a tick, so the tick's other steps are not kept waiting. */
const TICK_BUDGET_MS = 20_000;

/**
 * The public Legislation page and scorecard (design §5.14, "Legislation and the scorecard"): the bills the legislative
 * team shows the public, each with the team's summary and the party's position on its roll calls, a copy of what
 * Congress.gov says of it, and every member's vote on those roll calls. The api serves them from that copy (read again
 * by the worker every six hours), so visitors never wait on Congress.gov, and nothing of the team's tags, notes or
 * names reaches them. Who may change them is the Bills tool's (`BillsService`), which calls `save` and `withdraw`.
 */
@Injectable()
export class PublicBills {
  private readonly logger = new Logger(PublicBills.name);
  private cached: { readonly at: number; readonly value: Promise<Snapshot> } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly repo: BillRepository,
    private readonly ledger: LedgerService,
    @Inject(BILL_SOURCE) private readonly source: BillSource,
    @Inject(ROLL_CALL_SOURCE) private readonly votes: RollCallSource,
  ) {}

  // --- What the public reads -----------------------------------------------------------------------------------

  private snapshot(): Promise<Snapshot> {
    if (this.cached && Date.now() - this.cached.at < SNAPSHOT_MS) return this.cached.value;
    const value = (async () => {
      const bills = await this.repo.allPublic();
      const ids = [...new Set(bills.flatMap((b) => b.rollCalls.map((r) => r.voteId)))];
      const rollCalls = await this.repo.rollCallsFor(ids);
      return { bills, rollCalls: new Map(rollCalls.map((r) => [r.voteId, r])) };
    })();
    this.cached = { at: Date.now(), value };
    value.catch(() => {
      if (this.cached?.value === value) this.cached = null;
    });
    return value;
  }

  private invalidate(): void {
    this.cached = null;
  }

  /** `GET /v1/public/bills`: the public bills, the latest action first, of one topic or all. */
  async list(topic: BillTopic | null): Promise<PublicBillCard[]> {
    const { bills } = await this.snapshot();
    return sortPublicBills(bills.filter((b) => !topic || b.topic === topic).map(publicBillCard));
  }

  /** `GET /v1/public/bills/{billId}`: one public bill; 404 for any bill the team does not show. */
  async bill(id: string): Promise<PublicBillView> {
    const { bills, rollCalls } = await this.snapshot();
    const bill = bills.find((b) => b.billId === id);
    if (!bill) throw new NotFoundException('the party does not follow that bill here');
    return publicBillView(bill, rollCalls);
  }

  /** `GET /v1/public/scorecard`. */
  async scorecard(): Promise<ScorecardView> {
    const { bills, rollCalls } = await this.snapshot();
    return scorecard(bills, rollCalls);
  }

  /** `GET /v1/public/scorecard/{memberId}`; 404 for someone in none of the public bills' roll calls. */
  async member(memberId: string): Promise<ScorecardMemberView> {
    const { bills, rollCalls } = await this.snapshot();
    const view = isMemberId(memberId) ? memberScorecard(memberId, bills, rollCalls) : null;
    if (!view) throw new NotFoundException('that member of Congress has no vote on the bills the party follows here');
    return view;
  }

  /** The public bills' pages for the sitemap, each last changed when it moved or the team edited it. */
  async sitemap(): Promise<{ readonly billId: string; readonly lastModified: string }[]> {
    const { bills } = await this.snapshot();
    return bills.map((b) => {
      const moved = b.latestAction?.date ? `${b.latestAction.date}T00:00:00.000Z` : b.updatedAt;
      return { billId: b.billId, lastModified: moved > b.updatedAt ? moved : b.updatedAt };
    });
  }

  // --- The legislative team ------------------------------------------------------------------------------------

  /** Whether each of these bills is shown publicly, for the watchlist. */
  publicIds(): Promise<Set<string>> {
    return this.repo.publicIds();
  }

  /** What the public sees of a bill, for the team's page of it; null when it is not public. Read fresh. */
  async teamView(id: string): Promise<PublicBillTeamView | null> {
    const record = await this.repo.findPublic(id);
    return record ? this.teamViewOf(record) : null;
  }

  private async teamViewOf(record: PublicBillRecord): Promise<PublicBillTeamView> {
    const kept = await this.repo.rollCallsKept(record.rollCalls.map((r) => r.voteId));
    return {
      topic: record.topic,
      summary: record.summary,
      positions: record.positions,
      rollCalls: record.rollCalls,
      unread: record.rollCalls.filter((r) => !kept.has(r.voteId)).map((r) => r.voteId),
      publishedAt: record.publishedAt,
      updatedAt: record.updatedAt,
      checkedAt: record.checkedAt,
      refreshFailedAt: record.refreshFailedAt,
      version: record.version,
    };
  }

  /**
   * Shows a watched bill publicly, or changes its topic, summary and positions, from the version edited (409 if someone
   * saved since); ledgered as `bills.public_changed`. Congress.gov is read for the bill now, and the chambers for its
   * roll calls not yet kept; a roll call that cannot be read is tried again by the worker.
   */
  async save(actor: string, ref: BillRef, input: PublicBillInput): Promise<PublicBillTeamView> {
    const id = billId(ref);
    if (!(await this.repo.findWatched(id))) throw new ConflictException(`${billLabel(ref)} is not on the watchlist: add it there first, then show it publicly`);
    const record = await this.source.bill(ref).catch(sourceError);
    if (!record) throw new NotFoundException(`Congress.gov has no ${billLabel(ref)} in the ${congressLabel(ref.congress)}`);
    const at = new Date().toISOString();
    const snapshot = publicSnapshot(record, at);
    assertCheck(checkPositions(input.positions, snapshot.rollCalls));
    const unread = await this.readRollCalls(snapshot.rollCalls, ROLL_CALLS_PER_SAVE);
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      if (!(await this.repo.getWatched(tx, id))) throw new ConflictException(`${billLabel(ref)} was taken off the watchlist meanwhile`);
      const current = await this.repo.getPublic(tx, id);
      if (current && input.basedOn !== current.version) throw new ConflictException('someone changed this bill’s public page since you opened it: look again and redo your change');
      if (!current && input.basedOn !== null) throw new ConflictException('this bill was taken off the public page since you opened it: show it again if it is still wanted');
      if (!current && (await this.repo.allPublicIn(tx)).length >= PUBLIC_BILL_LIMITS.bills) {
        throw new ConflictException(`the public page shows at most ${PUBLIC_BILL_LIMITS.bills} bills: take some off first`);
      }
      const next: PublicBillRecord = {
        ...ref,
        billId: id,
        ...snapshot,
        topic: input.topic,
        summary: input.summary,
        positions: input.positions,
        nextCheckAt: this.nextCheck(at, unread),
        refreshFailedAt: null,
        publishedAt: current?.publishedAt ?? at,
        publishedBy: current?.publishedBy ?? actor,
        updatedAt: at,
        updatedBy: actor,
        version: (current?.version ?? 0) + 1,
      };
      const payload: BillPublicChangedPayload = { billId: id, change: current ? 'changed' : 'published', topic: next.topic, summary: next.summary, positions: next.positions };
      await this.ledger.record(tx, [{ type: 'bills.public_changed', actor, subject: id, payload: { ...payload } }]);
      this.repo.setPublic(tx, next);
      return next;
    });
    this.invalidate();
    return this.teamViewOf(saved);
  }

  /** Takes a bill off the public page, with the roll calls no other public bill has; ledgered as `bills.public_changed`. */
  async withdraw(actor: string, ref: BillRef): Promise<void> {
    const id = billId(ref);
    await this.firebase.db.runTransaction(async (tx) => {
      const all = await this.repo.allPublicIn(tx);
      const current = all.find((b) => b.billId === id);
      if (!current) throw new NotFoundException(`${billLabel(ref)} is not on the public page`);
      const others = new Set(all.filter((b) => b.billId !== id).flatMap((b) => b.rollCalls.map((r) => r.voteId)));
      const payload: BillPublicChangedPayload = { billId: id, change: 'withdrawn', topic: null, summary: null, positions: null };
      await this.ledger.record(tx, [{ type: 'bills.public_changed', actor, subject: id, payload: { ...payload } }]);
      for (const r of current.rollCalls) if (!others.has(r.voteId)) this.repo.deleteRollCall(tx, r.voteId);
      this.repo.deletePublic(tx, id);
    });
    this.invalidate();
  }

  // --- Kept current ----------------------------------------------------------------------------------------------

  /**
   * The worker's tick (design §13): public bills last read six hours ago or more (half an hour after a failed read)
   * read again from Congress.gov, with any new roll calls, for at most 20 seconds. Returns how many were read.
   */
  async refreshDue(): Promise<number> {
    const started = Date.now();
    const due = await this.repo.publicDue(new Date().toISOString(), PUBLIC_BILL_LIMITS.refreshPerTick);
    let done = 0;
    for (const bill of due) {
      if (Date.now() - started > TICK_BUDGET_MS) break;
      if (await this.refresh(bill)) done++;
    }
    if (done) this.invalidate();
    return done;
  }

  private async refresh(bill: PublicBillRecord): Promise<boolean> {
    const at = new Date().toISOString();
    try {
      const record = await this.source.bill(bill);
      if (!record) throw new Error('Congress.gov has no such bill now');
      const snapshot = publicSnapshot(record, at);
      const unread = await this.readRollCalls(snapshot.rollCalls, ROLL_CALLS_PER_REFRESH);
      return await this.repo.refreshPublic(bill.billId, { ...snapshot, nextCheckAt: this.nextCheck(at, unread), refreshFailedAt: null });
    } catch (e) {
      this.logger.warn({ message: `could not read ${bill.billId} from Congress.gov: ${(e as Error).message}`, billId: bill.billId });
      await this.repo.publicReadFailed(bill.billId, { nextCheckAt: new Date(Date.parse(at) + PUBLIC_BILL_LIMITS.retryAfterMs).toISOString(), refreshFailedAt: at });
      return false;
    }
  }

  /**
   * Reads and keeps the roll calls not kept yet, one at a time, at most `limit` of them. A roll call held does not
   * change, so each is read once; one that cannot be read now, or past the limit, is left for the next read of its bill.
   * Returns how many are left to try again soon: those that failed or were past the limit.
   */
  private async readRollCalls(rollCalls: readonly PublicRollCall[], limit: number): Promise<number> {
    const kept = await this.repo.rollCallsKept(rollCalls.map((r) => r.voteId));
    const missing = rollCalls.filter((r) => !kept.has(r.voteId));
    let left = missing.length;
    for (const r of missing.slice(0, limit)) {
      try {
        // A roll call the chamber has no record of (the House's before the 118th Congress) is not asked for again soon.
        const record = await this.votes.rollCall(r, r.date);
        if (record) await this.repo.setRollCall(record);
        left--;
      } catch (e) {
        this.logger.warn({ message: `could not read roll call ${r.voteId}: ${(e as Error).message}`, voteId: r.voteId });
      }
    }
    return left;
  }

  /** When to read a bill again: six hours on, or half an hour while some of its roll calls are not kept. */
  private nextCheck(at: string, unread: number): string {
    return new Date(Date.parse(at) + (unread ? PUBLIC_BILL_LIMITS.retryAfterMs : PUBLIC_BILL_LIMITS.refreshAfterMs)).toISOString();
  }
}
