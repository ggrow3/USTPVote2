import {
  cancelledFrom,
  hasReminder,
  STEP_STATE,
  type ElectionProgress,
  type ElectionRecord,
  type ElectionState,
  type ElectionStep,
  type NoticeKind,
  type NoticeStep,
  type StepStatus,
  type Waiting,
  type WaitingFor,
} from 'ustp-domain';
import { aRole } from '../approval-text.js';

/**
 * The election editor's workflow (design §6.1) in words and as swim lanes, one for each who acts. Where the election is
 * and what it waits on come from `electionProgress` in ustp-domain; this module only says it, and draws it.
 */

export const STEP_LABELS: Record<ElectionStep, string> = {
  readiness: 'Readiness checks',
  roll: 'Voter roll',
  scheduling: 'Scheduling',
  scheduled: 'Scheduled',
  open: 'Open for voting',
  sealing: 'Ballots sealed',
  tally: 'Results computed',
  certification: 'Certification',
  certified: 'Certified',
  cancelled: 'Cancelled',
  deleted: 'Deleted',
};

/** Read before each step's name by screen readers; the list shows the same with its markers. */
export const STATUS_TEXT: Record<StepStatus, string> = {
  done: 'Done',
  current: 'Current step',
  upcoming: 'To come',
  possible: 'Possible',
  not_reached: 'Not reached',
};

/**
 * What happens at each step and who does it. `rehearsal`: a rehearsal where testing mode is on, which can be deleted
 * after voting too (design §10.4).
 */
export function stepNote(step: ElectionStep, election: Pick<ElectionRecord, 'secrecy'>, rehearsal = false): string {
  const secret = election.secrecy === 'secret';
  switch (step) {
    case 'readiness':
      return 'Contests, candidates, proposal texts and voting times pass every check.';
    case 'roll':
      return 'An Election Admin requests a snapshot of the Active members; an Auditor approves it. It can be done before the checks pass.';
    case 'scheduling':
      return 'An Election Admin requests it; an Auditor approves, which freezes the definition and the roll.';
    case 'scheduled':
      return secret
        ? 'The worker prepares the ballot encryption key, then opens voting at the opening time.'
        : 'The worker opens voting at the opening time.';
    case 'open':
      return 'Members on the roll vote. The worker closes voting at the closing time.';
    case 'sealing':
      return secret
        ? 'The worker seals every ballot into the published blocks.'
        : 'The worker seals the roll-call ballots into the published blocks.';
    case 'tally':
      return 'The worker counts the sealed ballots and publishes signed provisional results.';
    case 'certification':
      return 'An Election Admin requests it; an Auditor certifies exactly those results.';
    case 'certified':
      return secret
        ? 'The results are final; winners start any terms of office, and the worker destroys the ballot encryption key.'
        : 'The results are final; winners start any terms of office.';
    case 'cancelled':
      return 'A draft at once, by an Election Admin; a scheduled or open election with an Auditor’s approval.';
    case 'deleted':
      return rehearsal
        ? 'This rehearsal, once certified or cancelled, with its ballots and results, unless it seated anyone in an ' +
          'office; by an Election Admin, while testing mode is on. The ledger keeps its entries.'
        : 'A cancelled election nobody voted in, by an Election Admin. The ledger keeps its entries.';
  }
}

/** A cancelled election's line in the list, which says where it stopped. */
export function cancelledNote(election: Pick<ElectionRecord, 'scheduledAt' | 'openedAt' | 'cancelledAt'>): string {
  const from = { draft: 'as a draft', scheduled: 'while scheduled', open: 'while voting was open' }[
    cancelledFrom(election) as 'draft' | 'scheduled' | 'open'
  ];
  return `Cancelled ${from}${election.cancelledAt ? `, ${when(election.cancelledAt)}` : ''}.`;
}

const when = (iso: string) => new Date(iso).toLocaleString();

/** One thing the election waits on, as a sentence; `problems` is how many the readiness checks list. */
export function waitingText(w: Waiting, problems: number): string {
  const requested = w.at ? ` (requested ${when(w.at)})` : '';
  const approver = w.by === 'worker' ? 'the worker' : aRole(w.by);
  switch (w.for) {
    case 'fix_definition':
      return `An Election Admin fixes ${problems === 1 ? 'the problem' : `the ${problems} problems`} the readiness checks list.`;
    case 'request_roll':
      return 'An Election Admin requests a voter roll snapshot.';
    case 'approve_roll':
      return `${cap(approver)} approves the voter roll${requested}.`;
    case 'request_scheduling':
      return 'An Election Admin requests scheduling.';
    case 'approve_scheduling':
      return `${cap(approver)} approves scheduling${requested}.`;
    case 'pool_key':
      return 'The worker prepares the ballot encryption key, within a minute. Voting cannot open without it.';
    case 'opening_time':
      return `Voting opens ${when(w.at!)}: the worker opens it on its first tick from then (it runs every minute).`;
    case 'open_tick':
      return `The opening time (${when(w.at!)}) has passed: the worker opens voting on its next tick, within a minute.`;
    case 'closing_time':
      return `Voting closes ${when(w.at!)}: the worker closes it on its first tick from then.`;
    case 'close_tick':
      return `The closing time (${when(w.at!)}) has passed: the worker closes voting on its next tick, within a minute.`;
    case 'seal':
      return 'The worker seals the remaining ballots, usually on the tick that closed voting.';
    case 'tally':
      return 'The worker computes the provisional results now that every ballot is sealed, usually within a minute.';
    case 'request_certification':
      return 'An Election Admin requests certification of the provisional results.';
    case 'approve_certification':
      return `${cap(approver)} certifies the results${requested}.`;
    case 'approve_cancellation':
      return `${cap(approver)} decides the request to cancel it${requested}.`;
    case 'destroy_pool_key':
      return 'The worker destroys the ballot encryption key, within a minute.';
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --- the diagram ----------------------------------------------------------------------------------------------------

/** Colours for one theme; docs/ACCESSIBILITY.md has their contrast figures. */
export interface DiagramColours {
  readonly text: string;
  readonly node: string;
  readonly border: string;
  readonly done: string;
  readonly doneBorder: string;
  readonly current: string;
  readonly currentText: string;
  readonly muted: string;
  readonly line: string;
  readonly cluster: string;
  readonly clusterCurrent: string;
}

/** On a white card. */
export const LIGHT_COLOURS: DiagramColours = {
  text: '#000000',
  node: '#ffffff',
  border: '#757575',
  done: '#e8f5e9',
  doneBorder: '#2e7d32',
  current: '#bd4e00',
  currentText: '#ffffff',
  muted: '#757575',
  line: '#757575',
  cluster: '#f5f5f5',
  clusterCurrent: '#bd4e00',
};

/** On a dark card (#1d1d1d). Primary is too dark there, so the current step uses the accent, as links do. */
export const DARK_COLOURS: DiagramColours = {
  text: '#ffffff',
  node: '#1d1d1d',
  border: '#b0b0b0',
  done: '#203123',
  doneBorder: '#81c784',
  current: '#ff6900',
  currentText: '#000000',
  muted: '#b0b0b0',
  line: '#b0b0b0',
  cluster: '#262626',
  clusterCurrent: '#ff6900',
};


/** Marks a step's status in the diagram, so it does not rest on colour (WCAG 1.4.1). */
export const DIAGRAM_MARKS: Record<StepStatus, string> = {
  done: '✓',
  current: '▶',
  upcoming: '',
  possible: '',
  not_reached: '–',
};

// --- the swim lanes -------------------------------------------------------------------------------------------------

/**
 * Who acts (design §6.1, §10.2): an Election Admin builds the ballot and requests each two-person step, an Auditor
 * approves it, the worker acts on its clock, and the members on the roll vote.
 */
export type Lane = 'election_admin' | 'auditor' | 'worker' | 'members';

/**
 * The lanes left to right: each one's name, a word on who that is, and its share of the width, which follows its
 * longest label (an Election Admin "Requests certification"; the voters only "Vote").
 */
export const LANES: readonly {
  readonly lane: Lane;
  readonly name: readonly string[];
  readonly detail?: string;
  readonly share: number;
}[] = [
  { lane: 'election_admin', name: ['Election', 'Admin'], share: 0.28 },
  { lane: 'auditor', name: ['Auditor'], detail: 'approves', share: 0.26 },
  { lane: 'worker', name: ['Worker'], detail: 'automatic', share: 0.25 },
  { lane: 'members', name: ['Voters'], detail: 'on the roll', share: 0.21 },
];

/** The diagram's bands, top to bottom: the states in order, then the two ways out. */
export type Band = ElectionState | 'deleted';
const MAIN_BANDS = ['draft', 'scheduled', 'open', 'closed', 'certified'] as const;
const BANDS: readonly Band[] = [...MAIN_BANDS, 'cancelled', 'deleted'];
export const BAND_LABELS: Record<Band, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
  certified: 'Certified',
  cancelled: 'Cancelled (a way out)',
  deleted: 'Deleted (a way out)',
};

interface ActionSpec {
  readonly id: string;
  readonly lane: Lane;
  /** The step it belongs to; the action's band is that step's state. */
  readonly step: ElectionStep;
  /** Its name in the diagram, a line each: short words, so a lane fits a phone. */
  readonly label: readonly string[];
  /** What the election waits on while this is the thing to do next. */
  readonly waits: readonly WaitingFor[];
  /** Only in a secret election, which has a ballot encryption key. */
  readonly secret?: boolean;
  /** One of the election emails (design §6.8), whose status comes from its counts, not from the lifecycle. */
  readonly email?: NoticeKind;
  /** It moves the election to its next state, which a cancelled election left by the way out instead. */
  readonly ends?: boolean;
}

const act = (
  id: string,
  lane: Lane,
  step: ElectionStep,
  label: readonly string[],
  waits: readonly WaitingFor[] = [],
  more: Pick<ActionSpec, 'secret' | 'ends' | 'email'> = {},
): ActionSpec => ({ id, lane, step, label, waits, ...more });

/**
 * Each band's rows. Actions in one row follow one another left to right (an Election Admin's request, then the
 * Auditor's decision); each row of a state leads to the next row, and the last row of a state to the next state.
 */
const ROWS: Record<Band, readonly (readonly ActionSpec[])[]> = {
  draft: [
    [act('build', 'election_admin', 'readiness', ['Builds the', 'ballot'], ['fix_definition'])],
    [
      act('request_roll', 'election_admin', 'roll', ['Requests', 'the roll'], ['request_roll']),
      act('approve_roll', 'auditor', 'roll', ['Approves', 'the roll'], ['approve_roll']),
    ],
    [
      act('request_scheduling', 'election_admin', 'scheduling', ['Requests', 'scheduling'], ['request_scheduling']),
      act('approve_scheduling', 'auditor', 'scheduling', ['Approves', 'scheduling'], ['approve_scheduling'], { ends: true }),
    ],
  ],
  scheduled: [
    [act('make_key', 'worker', 'scheduled', ['Makes', 'ballot key'], ['pool_key'], { secret: true })],
    [act('open', 'worker', 'scheduled', ['Opens', 'voting'], ['opening_time', 'open_tick'], { ends: true })],
  ],
  open: [
    // The worker emails the roll that voting is open, and voting is what happens until the closing time, when the
    // worker's tick is what the election waits on. A day before the close it reminds those who have not voted.
    [
      act('email_open', 'worker', 'open', ['Emails', 'the roll'], [], { email: 'voting_open' }),
      act('vote', 'members', 'open', ['Vote'], ['closing_time']),
    ],
    [act('remind', 'worker', 'open', ['Sends a', 'reminder'], [], { email: 'closing_soon' })],
    [act('close', 'worker', 'open', ['Closes', 'voting'], ['close_tick'], { ends: true })],
  ],
  closed: [
    [act('seal', 'worker', 'sealing', ['Seals the', 'ballots'], ['seal'])],
    [act('tally', 'worker', 'tally', ['Counts', 'the votes'], ['tally'])],
    [
      act('request_certification', 'election_admin', 'certification', ['Requests', 'certification'], ['request_certification']),
      act('certify', 'auditor', 'certification', ['Certifies', 'the results'], ['approve_certification']),
    ],
  ],
  certified: [[act('destroy_key', 'worker', 'certified', ['Destroys', 'ballot key'], ['destroy_pool_key'], { secret: true })]],
  cancelled: [
    [act('cancel_draft', 'election_admin', 'cancelled', ['Cancels', 'a draft'])],
    [
      act('request_cancel', 'election_admin', 'cancelled', ['Requests', 'cancelling']),
      act('approve_cancel', 'auditor', 'cancelled', ['Approves', 'cancelling'], ['approve_cancellation']),
    ],
    [act('destroy_cancelled_key', 'worker', 'cancelled', ['Destroys', 'ballot key'], ['destroy_pool_key'], { secret: true })],
  ],
  deleted: [[act('delete', 'election_admin', 'deleted', ['Deletes', 'it'])]],
};

/** Between the ways out's rows, only the key's destruction follows from what is above it. */
const WAY_OUT_LINKS: readonly (readonly [string, string])[] = [['approve_cancel', 'destroy_cancelled_key']];

export interface LaneAction {
  readonly id: string;
  readonly lane: Lane;
  readonly label: readonly string[];
  readonly status: StepStatus;
}

export interface LaneBand {
  readonly band: Band;
  readonly status: StepStatus;
  readonly rows: readonly (readonly LaneAction[])[];
}

export interface SwimLanes {
  readonly bands: readonly LaneBand[];
  /** From an action to the one in a later row that follows it; within a row each action leads to the next. */
  readonly links: readonly (readonly [string, string])[];
}

type LaneElection = Pick<
  ElectionRecord,
  'state' | 'secrecy' | 'opensAt' | 'closesAt' | 'scheduledAt' | 'openedAt' | 'closedAt' | 'poolKeyVersion' | 'poolKeyDestroyedAt'
>;

/**
 * Who does what in the lifecycle, and where the election is: each action has the status of its step, refined by what
 * the election waits on (an Election Admin's request is done while the Auditor's decision on it is awaited). The
 * emails take the status `noticeSteps` gives them from their counts; an election open a day or less has no reminder.
 */
export function swimLanes(progress: ElectionProgress, election: LaneElection, emails: readonly NoticeStep[] = []): SwimLanes {
  const stepStatus = new Map(progress.steps.map((s) => [s.step, s.status]));
  const waited = new Set(progress.waiting.map((w) => w.for));
  const isWaited = (a: ActionSpec) => a.waits.some((w) => waited.has(w));
  const secret = election.secrecy === 'secret';
  const present = (a: ActionSpec) => (secret || !a.secret) && (a.email !== 'closing_soon' || hasReminder(election));
  const emailStatus = (a: ActionSpec) => (a.email ? emails.find((e) => e.kind === a.email)?.status : undefined);
  const cancelled = election.state === 'cancelled';
  const from = cancelledFrom(election);

  const mainStatus = (a: ActionSpec, step: readonly ActionSpec[]): StepStatus => {
    if (isWaited(a)) return 'current';
    const i = step.indexOf(a);
    if (step.slice(i + 1).some(isWaited)) return 'done';
    if (step.slice(0, i).some(isWaited)) return 'upcoming';
    const s = stepStatus.get(a.step)!;
    // A cancelled election counts the state it was cancelled from as done, but it never took the step out of it.
    if (cancelled && s === 'done' && STEP_STATE[a.step] === from) {
      if (a.id === 'make_key') return election.poolKeyVersion ? 'done' : 'not_reached';
      if (a.ends) return 'not_reached';
    }
    // The step is current but waits on nothing of its own: what it needed is behind it (the key destroyed).
    return s === 'current' ? 'done' : s;
  };

  const wayOutStatus = (a: ActionSpec): StepStatus => {
    if (a.id === 'delete') return stepStatus.get('deleted')!;
    const s = stepStatus.get('cancelled')!;
    if (s === 'not_reached') return s;
    if (s === 'current') {
      if (a.id === 'cancel_draft') return from === 'draft' ? 'done' : 'not_reached';
      if (a.id === 'destroy_cancelled_key') {
        return isWaited(a) ? 'current' : election.poolKeyDestroyedAt ? 'done' : 'not_reached';
      }
      return from === 'draft' ? 'not_reached' : 'done';
    }
    // Still possible: a draft is cancelled at once, a scheduled or open election by request and approval.
    if (a.id === 'cancel_draft') return election.state === 'draft' ? 'possible' : 'not_reached';
    if (waited.has('approve_cancellation')) {
      if (a.id === 'request_cancel') return 'done';
      if (a.id === 'approve_cancel') return 'current';
    }
    return 'possible';
  };

  const bandStatus = (band: Band): StepStatus => {
    if (band === 'cancelled' || band === 'deleted') return stepStatus.get(band)!;
    if (election.state === band) return 'current';
    const passed = {
      draft: true,
      scheduled: !!election.scheduledAt,
      open: !!election.openedAt,
      closed: !!election.closedAt,
      certified: false,
    }[band];
    return passed ? 'done' : cancelled ? 'not_reached' : 'upcoming';
  };

  const bands = BANDS.map((band): LaneBand => {
    const rows = ROWS[band].map((row) => row.filter(present)).filter((row) => row.length > 0);
    const main = (MAIN_BANDS as readonly Band[]).includes(band);
    const status = (a: ActionSpec) =>
      emailStatus(a) ?? (main ? mainStatus(a, rows.flat().filter((b) => b.step === a.step)) : wayOutStatus(a));
    return {
      band,
      status: bandStatus(band),
      rows: rows.map((row) => row.map((a) => ({ id: a.id, lane: a.lane, label: a.label, status: status(a) }))),
    };
  });

  const mainRows = bands.filter((b) => (MAIN_BANDS as readonly Band[]).includes(b.band)).flatMap((b) => b.rows);
  const ids = new Set(bands.flatMap((b) => b.rows.flat().map((a) => a.id)));
  const links = [
    ...mainRows.slice(1).map((row, i) => [mainRows[i]!.at(-1)!.id, row[0]!.id] as const),
    ...WAY_OUT_LINKS.filter(([a, b]) => ids.has(a) && ids.has(b)),
  ];
  return { bands, links };
}

/** The diagram's sizes in CSS pixels; each lane takes its share of the width. */
export const LANE_SIZES = {
  /** The lanes' names. */
  heading: 44,
  /** A band's name, and the space under it. */
  band: 24,
  bandGap: 14,
  /** An action, with two lines of text, and the space under it. */
  box: 40,
  rowGap: 16,
  /** Between an action and the edge of its lane. */
  inset: 4,
  /** Above an action, where a line coming from another lane turns down into it. */
  turn: 11,
} as const;

export interface LaneBox {
  readonly action: LaneAction;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface LaneLine {
  readonly points: readonly (readonly [number, number])[];
  /** Into a way out, or a step not taken. */
  readonly dashed: boolean;
}

export interface LaneLayout {
  readonly width: number;
  readonly height: number;
  /** Each lane's left edge and width, in `LANES` order. */
  readonly lanes: readonly { readonly x: number; readonly width: number }[];
  readonly bands: readonly { readonly band: LaneBand; readonly y: number }[];
  readonly boxes: readonly LaneBox[];
  readonly lines: readonly LaneLine[];
}

/** Where everything goes in a diagram `width` pixels wide: a row of actions under each band's name. */
export function laneLayout(lanes: SwimLanes, width: number): LaneLayout {
  const S = LANE_SIZES;
  let left = 0;
  const columns = LANES.map((l) => {
    const lane = { x: left, width: l.share * width };
    left += lane.width;
    return lane;
  });
  const column = new Map(LANES.map((l, i) => [l.lane, columns[i]!]));
  const bands: { band: LaneBand; y: number }[] = [];
  const boxes = new Map<string, LaneBox>();
  let y = S.heading;
  for (const band of lanes.bands) {
    bands.push({ band, y });
    y += S.band + S.bandGap;
    for (const row of band.rows) {
      for (const action of row) {
        const lane = column.get(action.lane)!;
        boxes.set(action.id, { action, x: lane.x + S.inset, y, width: lane.width - 2 * S.inset });
      }
      y += S.box + S.rowGap;
    }
  }

  const dashed = (to: LaneBox, band: Band) =>
    band === 'cancelled' || band === 'deleted' || to.action.status === 'possible' || to.action.status === 'not_reached';
  const bandOf = new Map(lanes.bands.flatMap((b) => b.rows.flat().map((a) => [a.id, b.band] as const)));
  const lines: LaneLine[] = [];
  for (const band of lanes.bands) {
    for (const row of band.rows) {
      row.slice(1).forEach((action, i) => {
        const a = boxes.get(row[i]!.id)!;
        const b = boxes.get(action.id)!;
        const mid = a.y + S.box / 2;
        lines.push({ points: [[a.x + a.width, mid], [b.x, mid]], dashed: dashed(b, band.band) });
      });
    }
  }
  for (const [from, to] of lanes.links) {
    const a = boxes.get(from)!;
    const b = boxes.get(to)!;
    const [x1, y1, x2, y2] = [a.x + a.width / 2, a.y + S.box, b.x + b.width / 2, b.y];
    const points: [number, number][] =
      x1 === x2
        ? [[x1, y1], [x2, y2]]
        : [[x1, y1], [x1, y2 - S.turn], [x2, y2 - S.turn], [x2, y2]];
    lines.push({ points, dashed: dashed(b, bandOf.get(to)!) });
  }
  return { width, height: y - S.rowGap + S.inset, lanes: columns, bands, boxes: [...boxes.values()], lines };
}
