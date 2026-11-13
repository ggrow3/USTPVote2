/**
 * The matrix's layout (design §10.5): neighbouring cells that hold nothing to set and say the same thing become one
 * cell, so a row reads "Not shown once signed in" once rather than as a run of dashes.
 */

/** One cell of a row: a single column's, or a run of neighbouring columns merged under one reason. */
export type CellRun<A> = { readonly audience: A } | { readonly audiences: readonly A[]; readonly reason: string };

/** A row's cells in column order, each run of neighbours with the same reason merged; `reasonOf` is null for a cell of its own. */
export function cellRuns<A>(audiences: readonly A[], reasonOf: (audience: A) => string | null): CellRun<A>[] {
  const runs: CellRun<A>[] = [];
  for (const audience of audiences) {
    const reason = reasonOf(audience);
    const last = runs.at(-1);
    if (reason === null) runs.push({ audience });
    else if (last && 'reason' in last && last.reason === reason) runs[runs.length - 1] = { audiences: [...last.audiences, audience], reason };
    else runs.push({ audiences: [audience], reason });
  }
  return runs;
}

/** The cells a staff role's menu choice sets in a draft of the settings. */
type RoleLinkDraft<R extends string, L extends string> = {
  menu: Record<R, Record<L, boolean>>;
  hiddenFrom: Record<R, Record<L, boolean>>;
};

/**
 * A staff role's menu cell is a choice of three (design §10.5): shown (adds the link to their membership's), not added
 * (`membership`: their membership decides), or hidden from everyone holding the role.
 */
export function setRoleLink<R extends string, L extends string>(
  draft: RoleLinkDraft<R, L>,
  role: R,
  link: L,
  state: 'shown' | 'membership' | 'hidden',
): void {
  draft.menu[role][link] = state === 'shown';
  draft.hiddenFrom[role][link] = state === 'hidden';
}
