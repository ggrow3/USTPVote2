/**
 * Line-by-line comparison of two texts, for reviewing a bylaws amendment before it is published (design §5.2).
 * Common leading and trailing lines are matched directly; the changed middle is aligned by longest common
 * subsequence. A very large middle (a rewrite rather than an amendment) is reported as removed then added.
 */

export interface DiffLine {
  readonly kind: 'same' | 'removed' | 'added';
  readonly text: string;
  /** 1-based line number in the old text (same, removed). */
  readonly before: number | null;
  /** 1-based line number in the new text (same, added). */
  readonly after: number | null;
}

/** Cells of the alignment table above which the middle is not aligned line by line. */
const MAX_ALIGNMENT_CELLS = 4_000_000;

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: 'same', text: a[i]!, before: i + 1, after: i + 1 });
  out.push(...alignMiddle(a, b, start, endA, endB));
  for (let i = endA, j = endB; i < a.length; i++, j++) out.push({ kind: 'same', text: a[i]!, before: i + 1, after: j + 1 });
  return out;
}

function alignMiddle(a: string[], b: string[], start: number, endA: number, endB: number): DiffLine[] {
  const n = endA - start;
  const m = endB - start;
  const removed = (i: number): DiffLine => ({ kind: 'removed', text: a[i]!, before: i + 1, after: null });
  const added = (j: number): DiffLine => ({ kind: 'added', text: b[j]!, before: null, after: j + 1 });
  if (n === 0 || m === 0 || n * m > MAX_ALIGNMENT_CELLS) {
    return [...range(start, endA).map(removed), ...range(start, endB).map(added)];
  }
  // lcs[i][j]: length of the longest common subsequence of a[start+i..endA) and b[start+j..endB).
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[start + i] === b[start + j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      out.push({ kind: 'same', text: a[start + i]!, before: start + i + 1, after: start + j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(removed(start + i++));
    } else {
      out.push(added(start + j++));
    }
  }
  while (i < n) out.push(removed(start + i++));
  while (j < m) out.push(added(start + j++));
  return out;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);
}
