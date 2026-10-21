import type { IrvContest, IrvResult, IrvRound, TallyContext, TieBreakRecord } from './types.js';
import { assertTieBreakOrder, validateSelection } from './validate.js';

export function tallyIrv(spec: IrvContest, selections: readonly unknown[], ctx: TallyContext): IrvResult {
  assertTieBreakOrder(spec.candidates, ctx.tieBreakOrder);
  const priority = new Map(ctx.tieBreakOrder!.map((c, i) => [c, i]));

  const rankings: (readonly string[])[] = [];
  let ballots = 0;
  let blank = 0;
  let invalid = 0;
  for (const selection of selections) {
    const check = validateSelection(spec, selection);
    if (!check.valid) {
      invalid++;
      continue;
    }
    ballots++;
    if (check.blank) blank++;
    else rankings.push(selection as string[]);
  }

  const rounds: IrvRound[] = [];
  const tieBreaks: TieBreakRecord[] = [];
  const history: Map<string, number>[] = [];
  const continuing = new Set(spec.candidates);
  let winner: string | null = null;

  for (let round = 1; rankings.length > 0; round++) {
    const counts = new Map([...continuing].map((c) => [c, 0]));
    let exhausted = 0;
    for (const ranking of rankings) {
      const top = ranking.find((c) => continuing.has(c));
      if (top === undefined) exhausted++;
      else counts.set(top, counts.get(top)! + 1);
    }
    history.push(counts);
    const continuingBallots = rankings.length - exhausted;
    const base = { round, counts: Object.fromEntries(counts), continuingBallots, exhausted };

    if (continuingBallots === 0) {
      rounds.push(base);
      break;
    }

    const leader = [...counts.entries()].reduce((best, entry) =>
      entry[1] > best[1] || (entry[1] === best[1] && priority.get(entry[0])! < priority.get(best[0])!) ? entry : best,
    );
    if (leader[1] * 2 > continuingBallots || continuing.size === 1) {
      winner = leader[0];
      rounds.push({ ...base, elected: winner });
      break;
    }

    const eliminated = chooseElimination(counts, history, priority, round, tieBreaks);
    continuing.delete(eliminated);
    rounds.push({ ...base, eliminated });
  }

  return { kind: 'irv', contestId: spec.id, ballots, blank, invalid, rounds, winner, tieBreaks };
}

/**
 * The candidate with the fewest votes. Ties are broken by earlier rounds' counts, most recent first
 * (fewer votes is eliminated), then by tie-break order (least favoured is eliminated).
 */
function chooseElimination(
  counts: ReadonlyMap<string, number>,
  history: readonly ReadonlyMap<string, number>[],
  priority: ReadonlyMap<string, number>,
  round: number,
  tieBreaks: TieBreakRecord[],
): string {
  const fewest = Math.min(...counts.values());
  const tied = [...counts.keys()]
    .filter((c) => counts.get(c) === fewest)
    .sort((a, b) => priority.get(a)! - priority.get(b)!);
  if (tied.length === 1) return tied[0]!;

  let remaining = tied;
  for (let i = history.length - 2; i >= 0 && remaining.length > 1; i--) {
    const past = history[i]!;
    const low = Math.min(...remaining.map((c) => past.get(c)!));
    remaining = remaining.filter((c) => past.get(c) === low);
  }

  const resolvedBy = remaining.length === 1 ? 'previous_rounds' : 'tie_break_order';
  const eliminated = remaining[remaining.length - 1]!;
  tieBreaks.push({ reason: 'irv_elimination', tied, resolvedBy, excluded: [eliminated], round });
  return eliminated;
}
