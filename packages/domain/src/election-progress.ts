import { electionTransitionAuthority, type ElectionState } from './election-state.js';
import type { ElectionDetail, ElectionRecord } from './elections.js';
import type { Role } from './roles.js';

/**
 * Where an election is in its lifecycle (design §6.1) and what its next step waits on, for the election editor's
 * workflow diagram. It reads only what the admin view of the election holds (`ElectionDetail`); the API and the worker
 * still decide every transition.
 */

const TO_CERTIFICATION = [
  'readiness',
  'roll',
  'scheduling',
  'scheduled',
  'open',
  'sealing',
  'tally',
  'certification',
  'certified',
] as const;
/**
 * The steps to certification in order, then the two ways out. A draft goes through `readiness`, `roll` and
 * `scheduling`; a closed election through `sealing`, `tally` and `certification`. `deleted` is never current: a
 * deleted election is gone.
 */
export const ELECTION_STEPS =[...TO_CERTIFICATION, 'cancelled', 'deleted'] as const;
export type ElectionStep = (typeof ELECTION_STEPS)[number];

/** The election state each step is taken in; `deleted` comes after every state. */
export const STEP_STATE: Readonly<Record<ElectionStep, ElectionState | null>> = {
  readiness: 'draft',
  roll: 'draft',
  scheduling: 'draft',
  scheduled: 'scheduled',
  open: 'open',
  sealing: 'closed',
  tally: 'closed',
  certification: 'closed',
  certified: 'certified',
  cancelled: 'cancelled',
  deleted: null,
};

/**
 * - `done`: behind the election (for a state: it was in that state and left it, or was cancelled from it)
 * - `current`: where the election is now; exactly one step
 * - `upcoming`: still ahead on the way to certification
 * - `possible`: a way out (cancelling, deleting) that the election can still take
 * - `not_reached`: not taken and no longer possible (the steps after a cancellation; cancelling once closed)
 */
export type StepStatus = 'done' | 'current' | 'upcoming' | 'possible' | 'not_reached';

/**
 * What the election waits on before it can move on:
 * - Election Admin: `fix_definition` (the readiness checks list problems), `request_roll`, `request_scheduling`,
 *   `request_certification`
 * - Auditor, deciding a pending two-person request: `approve_roll`, `approve_scheduling`, `approve_certification`,
 *   `approve_cancellation`
 * - the worker's tick (every minute): `pool_key` (a secret election's ballot-pool key, before it may open),
 *   `opening_time` / `closing_time` (the time is still ahead), `open_tick` / `close_tick` (the time has passed; the
 *   next tick moves it), `seal`, `tally`, `destroy_pool_key`
 */
export type WaitingFor =
  | 'fix_definition'
  | 'request_roll'
  | 'approve_roll'
  | 'request_scheduling'
  | 'approve_scheduling'
  | 'pool_key'
  | 'opening_time'
  | 'open_tick'
  | 'closing_time'
  | 'close_tick'
  | 'seal'
  | 'tally'
  | 'request_certification'
  | 'approve_certification'
  | 'approve_cancellation'
  | 'destroy_pool_key';

export interface Waiting {
  readonly for: WaitingFor;
  /** The step it belongs to. */
  readonly step: ElectionStep;
  /** Who acts: an admin role, or the worker on its clock. */
  readonly by: Role | 'worker';
  /** The opening or closing time; for an approval, when it was requested. */
  readonly at: string | null;
}

export interface ElectionProgress {
  /** Every step, in `ELECTION_STEPS` order. */
  readonly steps: readonly { readonly step: ElectionStep; readonly status: StepStatus }[];
  readonly current: ElectionStep;
  /** Empty when nothing is outstanding (certified with its key destroyed, or cancelled). */
  readonly waiting: readonly Waiting[];
}

export type ProgressInput = Pick<ElectionDetail, 'election' | 'problems' | 'roll' | 'pending' | 'results' | 'ballotsCast'>;

/** The state a cancelled election was cancelled from, read from the times it recorded. */
export function cancelledFrom(election: Pick<ElectionRecord, 'scheduledAt' | 'openedAt'>): ElectionState {
  return election.openedAt ? 'open' : election.scheduledAt ? 'scheduled' : 'draft';
}

export function electionProgress(detail: ProgressInput, now: Date = new Date()): ElectionProgress {
  const { election, pending } = detail;
  const state = election.state;
  // The draft steps are behind an election that was ever scheduled; a draft's are done when their condition holds.
  const rollApproved = detail.roll?.status === 'approved' && !!election.rollSnapshotId;
  const scheduled = !!election.scheduledAt;
  const done: Record<(typeof TO_CERTIFICATION)[number], boolean> = {
    readiness: scheduled || (state === 'draft' && detail.problems.length === 0),
    roll: scheduled || rollApproved,
    scheduling: scheduled,
    scheduled: scheduled && state !== 'scheduled',
    open: !!election.openedAt && state !== 'open',
    sealing: !!election.sealedAt,
    tally: !!detail.results,
    certification: !!election.certifiedAt,
    certified: false,
  };
  const current: ElectionStep =
    state === 'cancelled' || state === 'certified' ? state : TO_CERTIFICATION.find((s) => !done[s])!;

  const cancellable = electionTransitionAuthority(state, 'cancelled') !== null;
  const steps = ELECTION_STEPS.map((step) => {
    let status: StepStatus;
    if (step === current) status = 'current';
    else if (step === 'cancelled') status = cancellable ? 'possible' : 'not_reached';
    // Only an election nobody voted in can be deleted (`checkElectionDeletable`); the count is known once cancelled.
    else if (step === 'deleted') status = cancellable || (state === 'cancelled' && detail.ballotsCast === 0) ? 'possible' : 'not_reached';
    else if (done[step]) status = 'done';
    else status = state === 'cancelled' ? 'not_reached' : 'upcoming';
    return { step, status };
  });

  const request = (action: string) => pending.find((r) => r.action === action);
  const waiting: Waiting[] = [];
  const add = (what: WaitingFor, step: ElectionStep, by: Role | 'worker', at: string | null = null) =>
    waiting.push({ for: what, step, by, at });
  const approval = (action: string, what: WaitingFor, step: ElectionStep, otherwise?: WaitingFor) => {
    const r = request(action);
    if (r) add(what, step, r.approverRole, r.requestedAt);
    else if (otherwise) add(otherwise, step, 'election_admin');
  };

  switch (state) {
    case 'draft':
      if (detail.problems.length) add('fix_definition', 'readiness', 'election_admin');
      if (!rollApproved) approval('roll.approve', 'approve_roll', 'roll', 'request_roll');
      approval('election.schedule', 'approve_scheduling', 'scheduling', done.readiness && rollApproved ? 'request_scheduling' : undefined);
      break;
    case 'scheduled':
      if (election.secrecy === 'secret' && !election.poolKeyVersion) add('pool_key', 'scheduled', 'worker');
      add(now.getTime() < Date.parse(election.opensAt) ? 'opening_time' : 'open_tick', 'scheduled', 'worker', election.opensAt);
      approval('election.cancel', 'approve_cancellation', 'cancelled');
      break;
    case 'open':
      add(now.getTime() < Date.parse(election.closesAt) ? 'closing_time' : 'close_tick', 'open', 'worker', election.closesAt);
      approval('election.cancel', 'approve_cancellation', 'cancelled');
      break;
    case 'closed':
      if (!election.sealedAt) add('seal', 'sealing', 'worker');
      else if (!detail.results) add('tally', 'tally', 'worker');
      else approval('election.certify', 'approve_certification', 'certification', 'request_certification');
      break;
    case 'certified':
    case 'cancelled':
      if (election.poolKeyVersion && !election.poolKeyDestroyedAt) add('destroy_pool_key', state, 'worker');
      break;
  }
  return { steps, current, waiting };
}
