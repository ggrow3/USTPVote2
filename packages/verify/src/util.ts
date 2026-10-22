/** `fn()`, or null if it throws: served data can hold values JCS cannot encode or hashes cannot take. */
export function attempt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** "1 block", "3 blocks". */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** "1-4, 7, 9-10" for sorted integers. */
export function ranges(numbers: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const start = numbers[i]!;
    while (i + 1 < numbers.length && numbers[i + 1] === numbers[i]! + 1) i++;
    out.push(start === numbers[i] ? String(start) : `${start}-${numbers[i]}`);
  }
  return out.join(', ');
}
