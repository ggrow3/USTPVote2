import { describe, expect, it } from 'vitest';
import { PublicApi } from './api.js';
import { parseReceipt } from './receipt.js';
import { hasFailures, type Section } from './report.js';
import { verify } from './run.js';
import { buildWorld, fakeFetch, type World } from './testing/fixtures.js';

const receiptSections = (sections: readonly Section[]) => sections.filter((s) => s.title.startsWith('Receipt'));
const run = (w: World, receipt = w.receipt) => verify(new PublicApi('http://api.test', fakeFetch(w)), { receipt });

describe('receipts', () => {
  it('verify every part through its sealed block to the signed, anchored ledger', async () => {
    const w = await buildWorld();
    const sections = await run(w);
    expect(hasFailures(sections)).toBe(false);
    const parts = receiptSections(sections).slice(1);
    expect(parts.map((s) => s.title)).toEqual(['Receipt part: Plank 12 (verified)', 'Receipt part: Chair (verified)']);
    expect(parts[0]!.findings.every((f) => f.status === 'pass')).toBe(true);
  });

  it('fail when a selection on the receipt was changed', async () => {
    const w = await buildWorld();
    const [plank, chair] = w.receipt.parts;
    const changed = { ...w.receipt, parts: [{ ...plank!, selection: plank!.selection === 'yes' ? 'no' : 'yes' }, chair!] };
    const sections = await run(w, changed);
    expect(hasFailures(sections)).toBe(true);
    const failedPart = receiptSections(sections).find((s) => s.title.endsWith('(failed)'))!;
    expect(failedPart.title).toContain('Plank 12');
    expect(failedPart.findings.map((f) => f.status)).toEqual(['fail']); // nothing past a commitment that does not recompute
  });

  it('fail for a receipt cast on another definition', async () => {
    const w = await buildWorld();
    const sections = await run(w, { ...w.receipt, definitionHash: 'f'.repeat(64) });
    expect(receiptSections(sections)[0]!.findings[0]!.status).toBe('fail');
  });

  it('wait for a ballot still in the pool while voting is open', async () => {
    const w = await buildWorld({ closed: false });
    const sections = await run(w, w.lateReceipt);
    expect(hasFailures(sections)).toBe(false);
    expect(receiptSections(sections).slice(1).map((s) => s.title)).toEqual([
      'Receipt part: Plank 12 (pending)',
      'Receipt part: Chair (pending)',
    ]);
  });

  it('parse only USTP receipts, tolerating a byte-order mark', async () => {
    const w = await buildWorld();
    expect(parseReceipt(String.fromCharCode(0xfeff) + JSON.stringify(w.receipt))).toEqual(w.receipt);
    expect(() => parseReceipt('not json')).toThrow('not valid JSON');
    expect(() => parseReceipt('{"v":2}')).toThrow('not a USTP ballot receipt');
    expect(() => parseReceipt('null')).toThrow('not a USTP ballot receipt');
  });
});
