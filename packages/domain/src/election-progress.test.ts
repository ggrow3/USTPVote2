import { describe, expect, it } from 'vitest';
import { ELECTION_STEPS, cancelledFrom, electionProgress, type ProgressInput, type StepStatus } from './election-progress.js';
import type { ElectionRecord } from './elections.js';
import type { ApprovalRequestRecord } from './records.js';

const now = new Date('2026-11-01T12:00:00Z');
const before = '2026-11-01T11:00:00Z';
const later = '2026-11-08T12:00:00Z';

const draft: ElectionRecord = {
  electionId: 'e1',
  title: '2026 Officer Election',
  description: '',
  secrecy: 'secret',
  opensAt: '2026-11-02T00:00:00Z',
  closesAt: later,
  kAnonymity: 10,
  state: 'draft',
  createdBy: 'ea',
  createdAt: before,
  updatedAt: before,
  definitionHash: null,
  rollSnapshotId: null,
  tieBreakSeedCommitment: null,
  tieBreakSeedRef: null,
  scheduledAt: null,
  cancelledAt: null,
  poolKeyVersion: null,
  openedAt: null,
  closedAt: null,
  sealedAt: null,
  certifiedAt: null,
  poolKeyDestroyedAt: null,
};

const roll = (status: 'pending' | 'approved' | 'rejected'): NonNullable<ProgressInput['roll']> => ({
  snapshotId: 'r1',
  electionId: 'e1',
  criteria: { status: 'active' },
  asOf: before,
  count: 25,
  merkleRoot: 'ab'.repeat(32),
  status,
  requestedBy: 'ea',
  requestedAt: before,
  approvalId: 'a-roll',
  decidedBy: status === 'pending' ? null : 'au',
  decidedAt: status === 'pending' ? null : before,
  signature: null,
});

const request = (action: ApprovalRequestRecord['action']): ApprovalRequestRecord => ({
  id: `a-${action}`,
  action,
  subject: 'e1',
  payload: {},
  payloadHash: 'cd'.repeat(32),
  reason: 'test',
  requestedBy: 'ea',
  requestedAt: before,
  approverRole: 'auditor',
  status: 'pending',
  expiresAt: later,
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
});

const results = (status: 'provisional' | 'certified'): NonNullable<ProgressInput['results']> => ({
  status,
  resultsHash: 'ef'.repeat(32),
  computedAt: before,
  ledgerSeq: 40,
  certifiedAt: status === 'certified' ? before : null,
  certifiedLedgerSeq: status === 'certified' ? 41 : null,
});

const input = (election: Partial<ElectionRecord>, rest: Partial<ProgressInput> = {}): ProgressInput => ({
  election: { ...draft, ...election },
  problems: [],
  roll: null,
  pending: [],
  results: null,
  ballotsCast: null,
  ...rest,
});

const scheduledElection: Partial<ElectionRecord> = {
  state: 'scheduled',
  scheduledAt: before,
  rollSnapshotId: 'r1',
  definitionHash: '12'.repeat(32),
  poolKeyVersion: '7',
};
const openElection: Partial<ElectionRecord> = { ...scheduledElection, state: 'open', opensAt: before, openedAt: before };
const closedElection: Partial<ElectionRecord> = { ...openElection, state: 'closed', closesAt: before, closedAt: before };

/** Step statuses as one map, for compact assertions. */
function statuses(i: ProgressInput): Record<string, StepStatus> {
  return Object.fromEntries(electionProgress(i, now).steps.map((s) => [s.step, s.status]));
}

describe('electionProgress', () => {
  it('lists every step once, in order', () => {
    expect(electionProgress(input({}), now).steps.map((s) => s.step)).toEqual([...ELECTION_STEPS]);
  });

  it('a draft with problems is at the readiness checks, and needs a roll too', () => {
    const p = electionProgress(input({}, { problems: ['add at least one contest'] }), now);
    expect(p.current).toBe('readiness');
    expect(p.waiting).toEqual([
      { for: 'fix_definition', step: 'readiness', by: 'election_admin', at: null },
      { for: 'request_roll', step: 'roll', by: 'election_admin', at: null },
    ]);
    expect(statuses(input({}, { problems: ['x'] }))).toMatchObject({
      readiness: 'current',
      roll: 'upcoming',
      scheduling: 'upcoming',
      certified: 'upcoming',
      cancelled: 'possible',
      deleted: 'possible',
    });
  });

  it('a pending roll waits on the Auditor, whatever the readiness checks say', () => {
    const p = electionProgress(input({}, { problems: ['x'], roll: roll('pending'), pending: [request('roll.approve')] }), now);
    expect(p.current).toBe('readiness');
    expect(p.waiting.map((w) => [w.for, w.by, w.at])).toEqual([
      ['fix_definition', 'election_admin', null],
      ['approve_roll', 'auditor', before],
    ]);
  });

  it('a roll approved before the definition is ready is done out of order', () => {
    const i = input({ rollSnapshotId: 'r1' }, { problems: ['x'], roll: roll('approved') });
    expect(statuses(i)).toMatchObject({ readiness: 'current', roll: 'done', scheduling: 'upcoming' });
    expect(electionProgress(i, now).waiting.map((w) => w.for)).toEqual(['fix_definition']);
  });

  it('a rejected roll asks for a new one', () => {
    const p = electionProgress(input({}, { roll: roll('rejected') }), now);
    expect(p.current).toBe('roll');
    expect(p.waiting.map((w) => w.for)).toEqual(['request_roll']);
  });

  it('a ready draft with an approved roll is at scheduling: first the request, then the Auditor', () => {
    const ready = input({ rollSnapshotId: 'r1' }, { roll: roll('approved') });
    expect(electionProgress(ready, now)).toMatchObject({ current: 'scheduling', waiting: [{ for: 'request_scheduling', by: 'election_admin' }] });
    const requested = { ...ready, pending: [request('election.schedule')] };
    expect(electionProgress(requested, now).waiting).toEqual([{ for: 'approve_scheduling', step: 'scheduling', by: 'auditor', at: before }]);
  });

  it('a scheduled election waits for its key, then the opening time, then the tick', () => {
    const noKey = electionProgress(input({ ...scheduledElection, poolKeyVersion: null }, { roll: roll('approved') }), now);
    expect(noKey.current).toBe('scheduled');
    expect(noKey.waiting.map((w) => w.for)).toEqual(['pool_key', 'opening_time']);
    expect(noKey.waiting[1]).toMatchObject({ by: 'worker', at: draft.opensAt });
    expect(statuses(input(scheduledElection))).toMatchObject({ readiness: 'done', roll: 'done', scheduling: 'done', scheduled: 'current', open: 'upcoming' });
    const due = electionProgress(input({ ...scheduledElection, opensAt: before }), now);
    expect(due.waiting.map((w) => w.for)).toEqual(['open_tick']);
  });

  it('a roll-call election needs no key', () => {
    const p = electionProgress(input({ ...scheduledElection, secrecy: 'open', poolKeyVersion: null }), now);
    expect(p.waiting.map((w) => w.for)).toEqual(['opening_time']);
  });

  it('an open election waits for its closing time, and shows a pending cancellation', () => {
    const p = electionProgress(input(openElection, { pending: [request('election.cancel')] }), now);
    expect(p.current).toBe('open');
    expect(p.waiting).toEqual([
      { for: 'closing_time', step: 'open', by: 'worker', at: later },
      { for: 'approve_cancellation', step: 'cancelled', by: 'auditor', at: before },
    ]);
    expect(statuses(input(openElection))).toMatchObject({ scheduled: 'done', open: 'current', sealing: 'upcoming', cancelled: 'possible' });
    expect(electionProgress(input({ ...openElection, closesAt: before }), now).waiting.map((w) => w.for)).toEqual(['close_tick']);
  });

  it('a closed election goes through sealing, the tally and certification', () => {
    const unsealed = electionProgress(input(closedElection), now);
    expect(unsealed).toMatchObject({ current: 'sealing', waiting: [{ for: 'seal', by: 'worker' }] });
    expect(statuses(input(closedElection))).toMatchObject({ open: 'done', sealing: 'current', cancelled: 'not_reached', deleted: 'not_reached' });

    const sealed = { ...closedElection, sealedAt: before };
    expect(electionProgress(input(sealed), now)).toMatchObject({ current: 'tally', waiting: [{ for: 'tally', by: 'worker' }] });

    const tallied = input(sealed, { results: results('provisional') });
    expect(electionProgress(tallied, now)).toMatchObject({
      current: 'certification',
      waiting: [{ for: 'request_certification', by: 'election_admin' }],
    });
    const requested = { ...tallied, pending: [request('election.certify')] };
    expect(electionProgress(requested, now).waiting).toEqual([{ for: 'approve_certification', step: 'certification', by: 'auditor', at: before }]);
  });

  it('a certified election is done, once the worker has destroyed its key', () => {
    const certified = { ...closedElection, state: 'certified' as const, sealedAt: before, certifiedAt: before };
    const p = electionProgress(input(certified, { results: results('certified') }), now);
    expect(p.current).toBe('certified');
    expect(p.waiting).toEqual([{ for: 'destroy_pool_key', step: 'certified', by: 'worker', at: null }]);
    expect(Object.values(statuses(input(certified, { results: results('certified') }))).filter((s) => s === 'done')).toHaveLength(8);
    expect(electionProgress(input({ ...certified, poolKeyDestroyedAt: before }, { results: results('certified') }), now).waiting).toEqual([]);
  });

  it('a cancelled election keeps what it reached; the rest was not reached', () => {
    const fromOpen = input({ ...openElection, state: 'cancelled', cancelledAt: before }, { ballotsCast: 4 });
    expect(electionProgress(fromOpen, now).current).toBe('cancelled');
    expect(statuses(fromOpen)).toMatchObject({
      scheduling: 'done',
      scheduled: 'done',
      open: 'done',
      sealing: 'not_reached',
      certified: 'not_reached',
      cancelled: 'current',
      deleted: 'not_reached',
    });
    expect(electionProgress(fromOpen, now).waiting.map((w) => w.for)).toEqual(['destroy_pool_key']);

    const fromDraft = input({ state: 'cancelled', cancelledAt: before, rollSnapshotId: 'r1' }, { roll: roll('approved'), ballotsCast: 0 });
    expect(statuses(fromDraft)).toMatchObject({ readiness: 'not_reached', roll: 'done', scheduling: 'not_reached', deleted: 'possible' });
    expect(electionProgress(fromDraft, now).waiting).toEqual([]);
  });

  it('reads the state a cancelled election was cancelled from', () => {
    expect(cancelledFrom({ scheduledAt: null, openedAt: null })).toBe('draft');
    expect(cancelledFrom({ scheduledAt: before, openedAt: null })).toBe('scheduled');
    expect(cancelledFrom({ scheduledAt: before, openedAt: before })).toBe('open');
  });
});
