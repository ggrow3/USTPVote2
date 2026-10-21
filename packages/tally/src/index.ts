/** Recorded in every results bundle; must match package.json. */
export const TALLY_VERSION = '0.1.0';

export { tallyContest } from './tally.js';
export { tallyProposal } from './proposal.js';
export { tallyChooseN } from './choose-n.js';
export { tallyIrv } from './irv.js';
export { validateContestSpec, validateSelection, assertTieBreakOrder } from './validate.js';
export type { SelectionCheck } from './validate.js';
export { meetsThreshold, ceilTimes } from './ratio.js';
export type * from './types.js';
