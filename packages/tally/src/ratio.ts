import type { Ratio, Threshold } from './types.js';

/** True when `part / whole` satisfies the threshold. A zero `whole` never satisfies it. */
export function meetsThreshold(part: number, whole: number, threshold: Threshold): boolean {
  if (whole <= 0) return false;
  const lhs = BigInt(part) * BigInt(threshold.ratio.den);
  const rhs = BigInt(threshold.ratio.num) * BigInt(whole);
  return threshold.comparison === 'gt' ? lhs > rhs : lhs >= rhs;
}

/** ⌈value × ratio⌉ using exact integer arithmetic. */
export function ceilTimes(value: number, ratio: Ratio): number {
  const n = BigInt(value) * BigInt(ratio.num);
  const d = BigInt(ratio.den);
  return Number((n + d - 1n) / d);
}

export function isValidRatio(ratio: Ratio): boolean {
  return (
    Number.isSafeInteger(ratio.num) &&
    Number.isSafeInteger(ratio.den) &&
    ratio.num >= 0 &&
    ratio.den > 0 &&
    ratio.num <= ratio.den
  );
}
