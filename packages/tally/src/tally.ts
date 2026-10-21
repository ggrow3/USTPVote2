import { tallyChooseN } from './choose-n.js';
import { tallyIrv } from './irv.js';
import { tallyProposal } from './proposal.js';
import type { ContestResult, ContestSpec, TallyContext } from './types.js';
import { validateContestSpec } from './validate.js';

/**
 * Tallies one contest. `selections` are the contest's ballot parts from the sealed blocks, in any order;
 * the result depends only on the multiset of selections, the spec and the context.
 */
export function tallyContest(spec: ContestSpec, selections: readonly unknown[], ctx: TallyContext): ContestResult {
  const problems = validateContestSpec(spec);
  if (problems.length > 0) throw new Error(`invalid contest ${spec.id}: ${problems.join('; ')}`);
  if (!Number.isSafeInteger(ctx.rollSize) || ctx.rollSize < 0) {
    throw new Error('rollSize must be a non-negative integer');
  }

  switch (spec.kind) {
    case 'proposal':
      return tallyProposal(spec, selections, ctx);
    case 'choose_n':
      return tallyChooseN(spec, selections, ctx);
    case 'irv':
      return tallyIrv(spec, selections, ctx);
  }
}
