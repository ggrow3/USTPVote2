import { isValidRatio } from './ratio.js';
import type { ContestSpec, Threshold } from './types.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type SelectionCheck =
  | { readonly valid: true; readonly blank: boolean }
  | { readonly valid: false; readonly reason: string };

/** Returns every problem with a contest definition; an empty array means the spec is valid. */
export function validateContestSpec(spec: ContestSpec): string[] {
  const problems: string[] = [];
  if (!ID_PATTERN.test(spec.id)) problems.push(`invalid contest id ${JSON.stringify(spec.id)}`);

  switch (spec.kind) {
    case 'proposal': {
      checkThreshold(spec.passRule.threshold, 'passRule.threshold', problems);
      const { quorum } = spec;
      if (quorum?.minBallots !== undefined && !isCount(quorum.minBallots)) {
        problems.push('quorum.minBallots must be a non-negative integer');
      }
      if (quorum?.rollRatio !== undefined && !isValidRatio(quorum.rollRatio)) {
        problems.push('quorum.rollRatio must satisfy 0 <= num <= den, den > 0');
      }
      break;
    }
    case 'choose_n': {
      checkCandidates(spec.candidates, problems);
      const n = spec.candidates.length;
      if (!Number.isSafeInteger(spec.seats) || spec.seats < 1 || spec.seats > n) {
        problems.push(`seats must be an integer in 1..${n}`);
      }
      if (!Number.isSafeInteger(spec.maxSelections) || spec.maxSelections < 1 || spec.maxSelections > n) {
        problems.push(`maxSelections must be an integer in 1..${n}`);
      }
      if (spec.supportFloor) checkThreshold(spec.supportFloor, 'supportFloor', problems);
      break;
    }
    case 'irv': {
      checkCandidates(spec.candidates, problems);
      const n = spec.candidates.length;
      if (spec.maxRanks !== undefined && (!Number.isSafeInteger(spec.maxRanks) || spec.maxRanks < 1 || spec.maxRanks > n)) {
        problems.push(`maxRanks must be an integer in 1..${n}`);
      }
      break;
    }
  }
  return problems;
}

/** Checks one ballot's selection for one contest. Used at cast time and, defensively, at tally time. */
export function validateSelection(spec: ContestSpec, selection: unknown): SelectionCheck {
  switch (spec.kind) {
    case 'proposal':
      return selection === 'yes' || selection === 'no' || selection === 'abstain'
        ? { valid: true, blank: false }
        : { valid: false, reason: 'selection must be "yes", "no" or "abstain"' };
    case 'choose_n':
      return checkCandidateList(selection, spec.candidates, spec.maxSelections);
    case 'irv':
      return checkCandidateList(selection, spec.candidates, spec.maxRanks ?? spec.candidates.length);
  }
}

/** Throws unless `order` contains each candidate exactly once. */
export function assertTieBreakOrder(candidates: readonly string[], order: readonly string[] | undefined): void {
  if (!order) throw new Error('tieBreakOrder is required for candidate contests');
  const expected = new Set(candidates);
  if (order.length !== expected.size || new Set(order).size !== order.length || !order.every((c) => expected.has(c))) {
    throw new Error('tieBreakOrder must be a permutation of the contest candidates');
  }
}

function checkCandidateList(selection: unknown, candidates: readonly string[], max: number): SelectionCheck {
  if (!Array.isArray(selection)) return { valid: false, reason: 'selection must be an array of candidate ids' };
  if (selection.length > max) return { valid: false, reason: `at most ${max} selections allowed` };
  const allowed = new Set(candidates);
  const seen = new Set<string>();
  for (const item of selection) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      return { valid: false, reason: `unknown candidate ${JSON.stringify(item)}` };
    }
    if (seen.has(item)) return { valid: false, reason: `duplicate candidate ${JSON.stringify(item)}` };
    seen.add(item);
  }
  return { valid: true, blank: selection.length === 0 };
}

function checkCandidates(candidates: readonly string[], problems: string[]): void {
  if (candidates.length === 0) problems.push('at least one candidate is required');
  for (const c of candidates) {
    if (!ID_PATTERN.test(c)) problems.push(`invalid candidate id ${JSON.stringify(c)}`);
  }
  if (new Set(candidates).size !== candidates.length) problems.push('candidate ids must be unique');
}

function checkThreshold(threshold: Threshold, name: string, problems: string[]): void {
  if (!isValidRatio(threshold.ratio)) problems.push(`${name}.ratio must satisfy 0 <= num <= den, den > 0`);
  if (threshold.comparison !== 'gt' && threshold.comparison !== 'gte') {
    problems.push(`${name}.comparison must be "gt" or "gte"`);
  }
}

function isCount(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}
