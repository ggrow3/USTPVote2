import { meetsThreshold } from './ratio.js';
import type { CandidateCount, ChooseNContest, ChooseNResult, TallyContext, TieBreakRecord } from './types.js';
import { assertTieBreakOrder, validateSelection } from './validate.js';

export function tallyChooseN(spec: ChooseNContest, selections: readonly unknown[], ctx: TallyContext): ChooseNResult {
  assertTieBreakOrder(spec.candidates, ctx.tieBreakOrder);
  const priority = new Map(ctx.tieBreakOrder!.map((c, i) => [c, i]));

  const votes = new Map(spec.candidates.map((c) => [c, 0]));
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
    for (const c of selection as string[]) votes.set(c, votes.get(c)! + 1);
  }

  const ranking: CandidateCount[] = [...spec.candidates]
    .sort((a, b) => votes.get(b)! - votes.get(a)! || priority.get(a)! - priority.get(b)!)
    .map((candidateId) => {
      const v = votes.get(candidateId)!;
      return {
        candidateId,
        votes: v,
        meetsFloor: spec.supportFloor ? meetsThreshold(v, ballots, spec.supportFloor) : true,
      };
    });

  // A candidate needs at least one vote and, if configured, the support floor.
  const eligible = ranking.filter((r) => r.meetsFloor && r.votes > 0);
  const elected = eligible.slice(0, spec.seats);
  const winners = elected.map((r) => r.candidateId);

  const tieBreaks: TieBreakRecord[] = [];
  const lastIn = elected[spec.seats - 1];
  const firstOut = eligible[spec.seats];
  if (lastIn && firstOut && lastIn.votes === firstOut.votes) {
    const tied = eligible.filter((r) => r.votes === lastIn.votes).map((r) => r.candidateId);
    tieBreaks.push({
      reason: 'seat_cutoff',
      tied,
      resolvedBy: 'tie_break_order',
      excluded: tied.filter((c) => !winners.includes(c)),
    });
  }

  return {
    kind: 'choose_n',
    contestId: spec.id,
    ballots,
    blank,
    invalid,
    ranking,
    winners,
    vacantSeats: spec.seats - winners.length,
    tieBreaks,
  };
}
