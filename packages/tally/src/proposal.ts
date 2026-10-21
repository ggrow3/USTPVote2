import { ceilTimes, meetsThreshold } from './ratio.js';
import type { ProposalChoice, ProposalContest, ProposalResult, TallyContext } from './types.js';
import { validateSelection } from './validate.js';

export function tallyProposal(
  spec: ProposalContest,
  selections: readonly unknown[],
  ctx: TallyContext,
): ProposalResult {
  const counts: Record<ProposalChoice, number> = { yes: 0, no: 0, abstain: 0 };
  let invalid = 0;
  for (const selection of selections) {
    if (!validateSelection(spec, selection).valid) {
      invalid++;
      continue;
    }
    counts[selection as ProposalChoice]++;
  }

  const ballots = counts.yes + counts.no + counts.abstain;
  const { quorum } = spec;
  const required = Math.max(
    quorum?.minBallots ?? 0,
    quorum?.rollRatio ? ceilTimes(ctx.rollSize, quorum.rollRatio) : 0,
  );
  const met = ballots >= required;

  let outcome: ProposalResult['outcome'] = 'no_quorum';
  if (met) {
    const base =
      spec.passRule.base === 'yes_no'
        ? counts.yes + counts.no
        : spec.passRule.base === 'yes_no_abstain'
          ? ballots
          : ctx.rollSize;
    outcome = meetsThreshold(counts.yes, base, spec.passRule.threshold) ? 'passed' : 'failed';
  }

  return { kind: 'proposal', contestId: spec.id, counts, ballots, invalid, quorum: { required, met }, outcome };
}
