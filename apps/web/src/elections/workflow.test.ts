import {
  ELECTION_STEPS,
  electionProgress,
  type ApprovalRequestRecord,
  type ElectionRecord,
  type ProgressInput,
  type StepStatus,
} from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  cancelledNote,
  LANE_SIZES,
  laneLayout,
  LANES,
  STEP_LABELS,
  swimLanes,
  waitingText,
  type SwimLanes,
} from './workflow.js';

const at = '2026-11-01T11:00:00Z';
const election: ElectionRecord = {
  electionId: 'e1',
  title: 'Officers "2026" ]) --> x',
  description: 'end',
  secrecy: 'secret',
  opensAt: at,
  closesAt: '2026-11-08T12:00:00Z',
  kAnonymity: 10,
  state: 'open',
  createdBy: 'ea',
  createdAt: at,
  updatedAt: at,
  definitionHash: '12'.repeat(32),
  rollSnapshotId: 'r1',
  tieBreakSeedCommitment: null,
  tieBreakSeedRef: null,
  scheduledAt: at,
  cancelledAt: null,
  poolKeyVersion: '1',
  openedAt: at,
  closedAt: null,
  sealedAt: null,
  certifiedAt: null,
  poolKeyDestroyedAt: null,
};
const detail: ProgressInput = { election, problems: [], roll: null, pending: [], results: null, ballotsCast: null, officeTerms: null };
const now = new Date('2026-11-02T00:00:00Z');

const request = (action: ApprovalRequestRecord['action']): ApprovalRequestRecord => ({
  id: `a-${action}`,
  action,
  subject: 'e1',
  payload: {},
  payloadHash: 'cd'.repeat(32),
  reason: 'test',
  requestedBy: 'ea',
  requestedAt: at,
  approverRole: 'auditor',
  status: 'pending',
  expiresAt: '2026-11-08T11:00:00Z',
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
});

const draft: ElectionRecord = {
  ...election,
  state: 'draft',
  opensAt: '2026-11-03T00:00:00Z',
  definitionHash: null,
  rollSnapshotId: null,
  scheduledAt: null,
  poolKeyVersion: null,
  openedAt: null,
};
const lanesOf = (e: Partial<ElectionRecord>, rest: Partial<ProgressInput> = {}) => {
  const input = { ...detail, election: { ...election, ...e }, ...rest };
  const progress = electionProgress(input, now);
  return { progress, lanes: swimLanes(progress, input.election) };
};
/** Every action's status, by its ID. */
const statuses = (lanes: SwimLanes) =>
  Object.fromEntries(lanes.bands.flatMap((b) => b.rows.flat()).map((a) => [a.id, a.status]));
const bands = (lanes: SwimLanes) => Object.fromEntries(lanes.bands.map((b) => [b.band, b.status]));

const FIXTURES: Record<string, ReturnType<typeof lanesOf>> = {
  'a draft with problems and a pending roll': lanesOf(draft, {
    problems: ['x'],
    roll: null,
    pending: [request('roll.approve')],
  }),
  'a draft waiting on scheduling': lanesOf({ ...draft, rollSnapshotId: 'r1' }, { pending: [request('election.schedule')] }),
  'a scheduled election without its key': lanesOf({ state: 'scheduled', openedAt: null, opensAt: '2026-11-03T00:00:00Z', poolKeyVersion: null }),
  'an open election with a cancellation requested': lanesOf({}, { pending: [request('election.cancel')] }),
  'an open election past its closing time': lanesOf({ closesAt: at }),
  'a closed election waiting on certification': lanesOf(
    { state: 'closed', closedAt: at, sealedAt: at },
    { results: { status: 'provisional', resultsHash: 'ef'.repeat(32), computedAt: at, ledgerSeq: 4, certifiedAt: null, certifiedLedgerSeq: null } },
  ),
  'a certified election with its key still there': lanesOf(
    { state: 'certified', closedAt: at, sealedAt: at, certifiedAt: at },
    { results: { status: 'certified', resultsHash: 'ef'.repeat(32), computedAt: at, ledgerSeq: 4, certifiedAt: at, certifiedLedgerSeq: 5 } },
  ),
};

describe('swimLanes', () => {
  it.each(Object.entries(FIXTURES))('puts what %s waits on in the lane of whoever does it', (_, { progress, lanes }) => {
    const current = lanes.bands.flatMap((b) => b.rows.flat()).filter((a) => a.status === 'current');
    expect(current.length).toBeGreaterThan(0);
    const by = new Set<string>(progress.waiting.map((w) => w.by));
    // Members are the one lane nobody waits on: they vote while the election waits for its closing time.
    for (const a of current) expect(a.lane === 'members' ? progress.current === 'open' : by.has(a.lane)).toBe(true);
  });

  it('shows a pending request as made, and the decision as what comes next', () => {
    const s = statuses(FIXTURES['a draft with problems and a pending roll']!.lanes);
    expect(s).toMatchObject({ build: 'current', request_roll: 'done', approve_roll: 'current', request_scheduling: 'upcoming' });
    expect(s).toMatchObject({ cancel_draft: 'possible', request_cancel: 'possible', delete: 'possible' });
  });

  it('has members voting until the closing time, then the worker closing it', () => {
    const open = FIXTURES['an open election with a cancellation requested']!.lanes;
    expect(statuses(open)).toMatchObject({
      approve_scheduling: 'done',
      make_key: 'done',
      open: 'done',
      vote: 'current',
      close: 'upcoming',
      seal: 'upcoming',
      cancel_draft: 'not_reached',
      request_cancel: 'done',
      approve_cancel: 'current',
    });
    expect(bands(open)).toMatchObject({ draft: 'done', scheduled: 'done', open: 'current', closed: 'upcoming', cancelled: 'possible' });
    expect(statuses(FIXTURES['an open election past its closing time']!.lanes)).toMatchObject({ vote: 'done', close: 'current' });
  });

  it('keeps a cancelled election’s way out, and not the step it never took', () => {
    const { lanes } = lanesOf({ state: 'cancelled', openedAt: null, cancelledAt: at, poolKeyDestroyedAt: at });
    expect(statuses(lanes)).toMatchObject({
      approve_scheduling: 'done',
      make_key: 'done',
      open: 'not_reached',
      vote: 'not_reached',
      cancel_draft: 'not_reached',
      request_cancel: 'done',
      approve_cancel: 'done',
      destroy_cancelled_key: 'done',
    });
    expect(bands(lanes)).toMatchObject({ draft: 'done', scheduled: 'done', open: 'not_reached', cancelled: 'current' });
    const asDraft = lanesOf({ ...draft, state: 'cancelled', cancelledAt: at }).lanes;
    expect(statuses(asDraft)).toMatchObject({ cancel_draft: 'done', request_cancel: 'not_reached', destroy_cancelled_key: 'not_reached' });
  });

  it('leaves the key out of a roll-call election, and follows scheduling with opening', () => {
    const { lanes } = lanesOf({ secrecy: 'open', poolKeyVersion: null });
    const ids = lanes.bands.flatMap((b) => b.rows.flat()).map((a) => a.id);
    expect(ids).not.toContain('make_key');
    expect(ids).not.toContain('destroy_key');
    expect(lanes.bands.find((b) => b.band === 'certified')!.rows).toEqual([]);
    expect(lanes.links).toContainEqual(['approve_scheduling', 'open']);
    expect(lanes.links.at(-1)).toEqual(['tally', 'request_certification']);
  });

  it('links each row of the states to the next, and the ways out only where one follows another', () => {
    const { lanes } = FIXTURES['a certified election with its key still there']!;
    expect(lanes.links).toEqual([
      ['build', 'request_roll'],
      ['approve_roll', 'request_scheduling'],
      ['approve_scheduling', 'make_key'],
      ['make_key', 'open'],
      ['open', 'email_open'],
      ['vote', 'remind'],
      ['remind', 'close'],
      ['close', 'seal'],
      ['seal', 'tally'],
      ['tally', 'request_certification'],
      ['certify', 'destroy_key'],
      ['approve_cancel', 'destroy_cancelled_key'],
    ]);
    expect(statuses(lanes)).toMatchObject({ certify: 'done', destroy_key: 'current', cancel_draft: 'not_reached' });
    expect(bands(lanes)).toMatchObject({ closed: 'done', certified: 'current', cancelled: 'not_reached' });
  });

  it('shows the emails to voters with the status their counts give, beside voting', () => {
    const input = { ...detail, election };
    const progress = electionProgress(input, now);
    const emails = (open: StepStatus, soon: StepStatus) =>
      swimLanes(progress, election, [
        { kind: 'voting_open', status: open, notice: null },
        { kind: 'closing_soon', status: soon, notice: null },
      ]);
    expect(statuses(emails('done', 'upcoming'))).toMatchObject({ email_open: 'done', vote: 'current', remind: 'upcoming', close: 'upcoming' });
    expect(statuses(emails('current', 'upcoming'))).toMatchObject({ email_open: 'current', vote: 'current' });
    // Email not set up: neither goes, and the lines into them are dashed.
    const off = laneLayout(emails('not_reached', 'not_reached'), 400);
    // The line coming down into each from the row above.
    const into = (id: string) => {
      const box = off.boxes.find((b) => b.action.id === id)!;
      return off.lines.find((l) => l.points.at(-1)![0] === box.x + box.width / 2 && l.points.at(-1)![1] === box.y);
    };
    expect(into('email_open')).toMatchObject({ dashed: true });
    expect(into('remind')).toMatchObject({ dashed: true });
    expect(into('close')).toMatchObject({ dashed: false });
    expect(statuses(emails('not_reached', 'not_reached'))).toMatchObject({ vote: 'current' });
  });

  it('leaves the reminder out where voting is open a day or less', () => {
    const { lanes } = lanesOf({ opensAt: '2026-11-01T11:00:00Z', closesAt: '2026-11-02T11:00:00Z' });
    expect(Object.keys(statuses(lanes))).not.toContain('remind');
    expect(lanes.links).toContainEqual(['vote', 'close']);
    expect(Object.keys(statuses(lanes))).toContain('email_open');
  });
});

describe('laneLayout', () => {
  const { lanes } = FIXTURES['an open election with a cancellation requested']!;

  it.each([271, 640])('keeps every action inside its lane at %i px, one row under another', (width) => {
    const layout = laneLayout(lanes, width);
    const column = new Map(LANES.map((l, i) => [l.lane, layout.lanes[i]!]));
    for (const box of layout.boxes) {
      const lane = column.get(box.action.lane)!;
      expect(box.x).toBeGreaterThan(lane.x);
      expect(box.x + box.width).toBeLessThan(lane.x + lane.width);
      expect(box.y + LANE_SIZES.box).toBeLessThan(layout.height);
    }
    expect(layout.lanes.at(-1)!.x + layout.lanes.at(-1)!.width).toBeCloseTo(width);
    const ys = [...new Set(layout.boxes.map((b) => b.y))].sort((a, b) => a - b);
    ys.slice(1).forEach((y, i) => expect(y - ys[i]!).toBeGreaterThanOrEqual(LANE_SIZES.box + LANE_SIZES.rowGap));
  });

  it('ends each line on the edge of the action it leads to', () => {
    const layout = laneLayout(lanes, 400);
    const box = new Map(layout.boxes.map((b) => [b.action.id, b]));
    const vote = box.get('vote')!;
    const remind = box.get('remind')!;
    // From the bottom of "Vote" round into the top of "Sends a reminder", turning above it.
    expect(layout.lines).toContainEqual({
      points: [
        [vote.x + vote.width / 2, vote.y + LANE_SIZES.box],
        [vote.x + vote.width / 2, remind.y - LANE_SIZES.turn],
        [remind.x + remind.width / 2, remind.y - LANE_SIZES.turn],
        [remind.x + remind.width / 2, remind.y],
      ],
      dashed: false,
    });
    const request = box.get('request_cancel')!;
    const approve = box.get('approve_cancel')!;
    // Across a row, from one action's side to the next one's, dashed in a way out.
    expect(layout.lines).toContainEqual({
      points: [
        [request.x + request.width, request.y + LANE_SIZES.box / 2],
        [approve.x, request.y + LANE_SIZES.box / 2],
      ],
      dashed: true,
    });
  });

  it('has a label for every step', () => {
    expect(Object.keys(STEP_LABELS).sort()).toEqual([...ELECTION_STEPS].sort());
  });
});

describe('workflow text', () => {
  it('says who an approval waits on and since when', () => {
    const text = waitingText({ for: 'approve_scheduling', step: 'scheduling', by: 'auditor', at }, 0);
    expect(text).toMatch(/^An Auditor approves scheduling \(requested .+\)\.$/);
    expect(waitingText({ for: 'fix_definition', step: 'readiness', by: 'election_admin', at: null }, 1)).toBe(
      'An Election Admin fixes the problem the readiness checks list.',
    );
    expect(waitingText({ for: 'fix_definition', step: 'readiness', by: 'election_admin', at: null }, 3)).toContain('the 3 problems');
  });

  it('says where a cancelled election stopped', () => {
    expect(cancelledNote({ scheduledAt: at, openedAt: null, cancelledAt: null })).toBe('Cancelled while scheduled.');
    expect(cancelledNote({ scheduledAt: null, openedAt: null, cancelledAt: null })).toBe('Cancelled as a draft.');
  });
});
