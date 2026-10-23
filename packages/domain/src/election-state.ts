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

/**
 * Whether a cancelled election may be deleted permanently (design §6.1): nobody cast a ballot in it, and the worker has
 * destroyed its ballot-pool key version, which it finds through the election record (§7.3). The API checks this inside
 * the deleting transaction; the web app uses it to offer the action or say why not.
 */
export function checkElectionDeletable(
  election: { readonly state: ElectionState; readonly poolKeyVersion: string | null; readonly poolKeyDestroyedAt: string | null },
  ballotsCast: number,
): Check {
  if (election.state !== 'cancelled') return deny(`a ${election.state} election cannot be deleted; only cancelled ones can`);
  if (ballotsCast > 0) {
    return deny(`${ballotsCast === 1 ? '1 ballot was' : `${ballotsCast} ballots were`} cast in it, so it stays on record`);
  }
  if (election.poolKeyVersion && !election.poolKeyDestroyedAt) {
    return deny('its ballot encryption key is still being destroyed; try again in a minute');
  }
  return OK;
}
