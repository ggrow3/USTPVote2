import { deny, OK, type Check } from './check.js';

export const ELECTION_STATES = ['draft', 'scheduled', 'open', 'closed', 'certified', 'cancelled'] as const;
export type ElectionState = (typeof ELECTION_STATES)[number];

/**
 * Who may perform a lifecycle transition (design §6.1):
 * - `single`: one Election Admin
 * - `two_person`: Election Admin request + Auditor approval
 * - `system`: the worker, on the election's clock
 */
export type TransitionAuthority = 'single' | 'two_person' | 'system';

const TRANSITIONS: Readonly<Record<ElectionState, Partial<Record<ElectionState, TransitionAuthority>>>> = {
  draft: { scheduled: 'two_person', cancelled: 'single' },
  scheduled: { open: 'system', cancelled: 'two_person' },
  open: { closed: 'system', cancelled: 'two_person' },
  closed: { certified: 'two_person' },
  certified: {},
  cancelled: {},
};

/** The authority a transition requires, or `null` if it is not allowed at all. */
export function electionTransitionAuthority(from: ElectionState, to: ElectionState): TransitionAuthority | null {
  return TRANSITIONS[from][to] ?? null;
}

export function isTerminal(state: ElectionState): boolean {
  return Object.keys(TRANSITIONS[state]).length === 0;
}

/** What decides whether a rehearsal may be deleted after voting (design §10.4). */
export interface RehearsalDeletion {
  /** The election's roll was test voters only. */
  readonly rehearsal: boolean;
  /** Testing mode is on in this deployment; it never is in production. */
  readonly testingMode: boolean;
  /** Terms of office its certification created. */
  readonly officeTerms: number;
}

/**
 * Whether an election may be deleted permanently (design §6.1): a cancelled one nobody cast a ballot in, or, where
 * testing mode is on, a rehearsal (§10.4) once it is certified or cancelled, ballots and all, as long as it seated
 * nobody in an office. Either way the worker must first have destroyed its ballot-pool key version, which it finds
 * through the election record (§7.3). The API checks this inside the deleting transaction; the web app uses it to offer
 * the action or say why not.
 */
export function checkElectionDeletable(
  election: { readonly state: ElectionState; readonly poolKeyVersion: string | null; readonly poolKeyDestroyedAt: string | null },
  ballotsCast: number,
  rehearsal: RehearsalDeletion = { rehearsal: false, testingMode: false, officeTerms: 0 },
): Check {
  if (rehearsal.rehearsal && rehearsal.testingMode) {
    if (election.state === 'closed') return deny('a closed rehearsal can be deleted once its results are certified');
    if (election.state !== 'certified' && election.state !== 'cancelled') {
      return deny(`${election.state === 'open' ? 'an' : 'a'} ${election.state} rehearsal cannot be deleted; cancel it, or certify its results, first`);
    }
    if (rehearsal.officeTerms > 0) {
      return deny(`its certification started ${rehearsal.officeTerms === 1 ? 'a term' : `${rehearsal.officeTerms} terms`} of office, so it stays on record`);
    }
  } else {
    if (election.state !== 'cancelled') return deny(`a ${election.state} election cannot be deleted; only cancelled ones can`);
    if (ballotsCast > 0) {
      return deny(`${ballotsCast === 1 ? '1 ballot was' : `${ballotsCast} ballots were`} cast in it, so it stays on record`);
    }
  }
  if (election.poolKeyVersion && !election.poolKeyDestroyedAt) {
    return deny('its ballot encryption key is still being destroyed; try again in a minute');
  }
  return OK;
}
