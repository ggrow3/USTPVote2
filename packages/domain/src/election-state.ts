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
