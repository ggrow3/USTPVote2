import { recordHash } from 'ustp-audit';
import type { LedgerEntry, PublicLedgerEntry } from 'ustp-domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkEntryScan, entryLinkProblems, publicEntryProblems } from './entries.js';
import { buildWorld, publicEntry, scanOf, type World } from './testing/fixtures.js';

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

/** The roll.approved entry: public, and the head entry of block 1 (entries 1-3). */
const ROLL_SEQ = 3;
const served = (seq: number): PublicLedgerEntry => publicEntry(w, seq)!;

describe('public ledger entries', () => {
  it('verify against the blocks: hash, inclusion proof, head entry', () => {
    for (const [seq, found] of scanOf(w)) {
      if (found) expect(publicEntryProblems(seq, found, w.blocks)).toEqual([]);
    }
    const scan = checkEntryScan(scanOf(w), w.blocks.at(-1)!.lastSeq, w.blocks);
    expect(scan.findings.map((f) => f.status)).toEqual(['info', 'pass']);
    expect(scan.entries.size).toBe(w.entries.filter((e) => !e.type.startsWith('member.') && e.type !== 'approval.decided').length);
  });

  it('catch a changed entry, whether or not its hash was recomputed', () => {
    const found = served(ROLL_SEQ);
    const payload = { ...found.entry.payload, count: 7 };
    const changed = { ...found, entry: { ...found.entry, payload } };
    expect(publicEntryProblems(ROLL_SEQ, changed, w.blocks)).toEqual([`entry ${ROLL_SEQ}: hash does not match the entry contents`]);

    const unhashed = { ...found.entry, payload } as Omit<LedgerEntry, 'hash'> & { hash?: string };
    const rehashed = { ...found, entry: { ...found.entry, payload, hash: recordHash(unhashed) } };
    expect(publicEntryProblems(ROLL_SEQ, rehashed, w.blocks)).toEqual([
      `entry ${ROLL_SEQ}: inclusion proof does not lead to block 1's Merkle root`,
      `entry ${ROLL_SEQ}: is not block 1's head entry`,
    ]);
  });

  it('catch an entry served with another block, or with a block outside the verified chain', () => {
    const found = served(ROLL_SEQ);
    expect(publicEntryProblems(ROLL_SEQ, { ...found, block: { ...found.block, createdAt: 'later' } }, w.blocks)).toEqual([
      `entry ${ROLL_SEQ}: the block served with it differs from ledger block 1`,
    ]);
    expect(publicEntryProblems(ROLL_SEQ, found, [])).toEqual([`entry ${ROLL_SEQ}: its block 1 is not a verified ledger block`]);
    expect(publicEntryProblems(ROLL_SEQ + 1, found, w.blocks)[0]).toContain('the api returned entry 3');
  });

  it('catch a proof for another position in the block', () => {
    const found = served(ROLL_SEQ);
    const proof = { ...found.proof, leafIndex: 0 };
    expect(publicEntryProblems(ROLL_SEQ, { ...found, proof }, w.blocks)).toEqual([
      `entry ${ROLL_SEQ}: inclusion proof does not lead to block 1's Merkle root`,
    ]);
  });

  it('catch neighbouring public entries that do not link', () => {
    const scan = scanOf(w);
    const entries = new Map([...scan].flatMap(([seq, e]) => (e ? [[seq, e.entry] as const] : [])));
    expect(entryLinkProblems(entries)).toEqual([]);
    const next = entries.get(6)!;
    entries.set(6, { ...next, prevHash: '0'.repeat(64) });
    expect(entryLinkProblems(entries)).toEqual(['entry 6: prevHash does not link to entry 5']);
  });

  it('flag a private entry type the api should not have served', () => {
    const found = served(ROLL_SEQ);
    const leaked = { ...found, entry: { ...found.entry, type: 'member.status_changed' as const } };
    expect(publicEntryProblems(ROLL_SEQ, leaked, w.blocks)).toContain(`entry ${ROLL_SEQ}: member.status_changed entries are not meant to be public`);
  });
});
