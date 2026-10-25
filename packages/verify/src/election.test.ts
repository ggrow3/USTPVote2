import { rollSigningInput, type LedgerEventType, type PublicElection, type PublicLedgerEntry, type SealedBlockRecord } from 'ustp-domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkElection, kAnonymityFinding, missingElectionFindings, type ElectionEvidence } from './election.js';
import type { Finding } from './report.js';
import { buildWorld, ELECTION_ID, makeSigner, publicEntries, type World } from './testing/fixtures.js';

let closed: World;
let open: World;
let rollCall: World;
let rehearsal: World;
beforeAll(async () => {
  [closed, open, rollCall, rehearsal] = await Promise.all([
    buildWorld(),
    buildWorld({ closed: false }),
    buildWorld({ secrecy: 'open' }),
    buildWorld({ rehearsal: true }),
  ]);
});

function evidence(w: World, change: Partial<ElectionEvidence> = {}): ElectionEvidence {
  return {
    record: w.record,
    entries: publicEntries(w),
    lastBlock: w.blocks.at(-1)!,
    keys: [w.signer.key],
    sealedBlocks: w.closed ? w.sealedBlocks : null,
    ...change,
  };
}
const withRecord = (w: World, change: (r: PublicElection) => PublicElection) => evidence(w, { record: change(structuredClone(w.record)) });
const statusOf = (findings: readonly Finding[], label: string) => findings.find((f) => f.label.startsWith(label))?.status;
const failed = (findings: readonly Finding[]) => findings.filter((f) => f.status === 'fail').map((f) => f.label);

describe('a published election', () => {
  it('verifies end to end once closed: definition, history, signed roll, summaries, contents, counts', async () => {
    const findings = await checkElection(evidence(closed));
    expect(failed(findings)).toEqual([]);
    expect(findings.filter((f) => f.status === 'pending')).toEqual([]);
    expect(findings.map((f) => f.status).filter((s) => s === 'pass')).toHaveLength(8);
    expect(statusOf(findings, 'The roll signature verifies')).toBe('pass');
  });

  it('verifies a rehearsal roll by the criteria its approval records, and says it is a rehearsal', async () => {
    const findings = await checkElection(evidence(rehearsal));
    expect(failed(findings)).toEqual([]);
    expect(statusOf(findings, 'The roll signature verifies')).toBe('pass');
    expect(findings.find((f) => f.label === 'Rehearsal roll')).toMatchObject({ status: 'info', detail: expect.stringMatching(/test voters only/) });
    expect((await checkElection(evidence(closed))).some((f) => f.label === 'Rehearsal roll')).toBe(false);
  });

  it('catches a record that misstates who its roll holds', async () => {
    const hidden = await checkElection(withRecord(rehearsal, (r) => ({ ...r, roll: { ...r.roll!, criteria: { status: 'active' } } })));
    expect(failed(hidden)).toEqual(['The published roll criteria match the ledger']);
    const claimed = await checkElection(withRecord(closed, (r) => ({ ...r, roll: { ...r.roll!, criteria: { status: 'active', testVotersOnly: true } } })));
    expect(failed(claimed)).toEqual(['The published roll criteria match the ledger']);
  });

  it('verifies what it can while open and waits for the contents', async () => {
    const findings = await checkElection(evidence(open));
    expect(failed(findings)).toEqual([]);
    expect(statusOf(findings, 'Sealed block contents')).toBe('pending');
    expect(statusOf(findings, 'Every sealed block summary matches')).toBe('pass');
  });

  it('fails when the api withholds the contents after close', async () => {
    expect(statusOf(await checkElection(evidence(closed, { sealedBlocks: null })), 'Sealed block contents')).toBe('fail');
  });

  it('catches a definition that does not hash to the published definitionHash', async () => {
    const findings = await checkElection(withRecord(closed, (r) => ({ ...r, definition: { ...r.definition, closesAt: r.definition.opensAt } })));
    expect(failed(findings)).toEqual(['The definition hashes to the published definitionHash']);
    const relabelled = await checkElection(withRecord(closed, (r) => ({ ...r, election: { ...r.election, definitionHash: 'd'.repeat(64) } })));
    expect(failed(relabelled)).toEqual([
      'The definition hashes to the published definitionHash',
      'The ledger records each step of the election once, matching the record',
    ]);
  });

  it('catches an altered sealed block', async () => {
    const blocks: SealedBlockRecord[] = structuredClone(closed.sealedBlocks) as SealedBlockRecord[];
    const part = blocks[0]!.contests.plank![0]!;
    (part as { selection: unknown }).selection = part.selection === 'yes' ? 'no' : 'yes';
    const findings = await checkElection(evidence(closed, { sealedBlocks: blocks }));
    expect(failed(findings)).toEqual(['Sealed block contents recompute and match their summaries']);
    expect(findings.find((f) => f.status === 'fail')!.detail).toContain('sealed block 1: Merkle root does not match its parts');
  });

  it('catches an invalid answer sealed into a block, even with every hash recomputed', async () => {
    const blocks: SealedBlockRecord[] = structuredClone(closed.sealedBlocks) as SealedBlockRecord[];
    (blocks[1]!.contests.chair![0]! as { selection: unknown }).selection = ['ca', 'cb']; // max 1 selection
    const findings = await checkElection(evidence(closed, { sealedBlocks: blocks }));
    expect(findings.find((f) => f.status === 'fail')!.detail).toContain('“Chair”');
  });

  it('catches a summary that does not match its ballots.sealed entry', async () => {
    const findings = await checkElection(
      withRecord(closed, (r) => ({ ...r, sealedBlocks: r.sealedBlocks.map((s, i) => (i === 0 ? { ...s, merkleRoot: 'e'.repeat(64) } : s)) })),
    );
    expect(failed(findings)).toContain('Every sealed block summary matches its ballots.sealed ledger entry');
    expect(findings.find((f) => f.label.startsWith('Every sealed block summary'))!.detail).toBe(
      'sealed block 1: merkleRoot differs from ledger entry 7',
    );
  });

  it('catches a sealed block the record leaves out', async () => {
    const findings = await checkElection(
      withRecord(closed, (r) => ({ ...r, sealedBlocks: r.sealedBlocks.slice(0, 1), ballotsSealed: r.sealedBlocks[0]!.ballotCount })),
    );
    const summary = findings.find((f) => f.label.startsWith('Every sealed block summary'))!;
    expect(summary.status).toBe('fail');
    expect(summary.detail).toContain('records sealed block 2, which the election record leaves out');
  });

  it('waits for a summary whose ledger entry is not in a block yet', async () => {
    const lastBlock = closed.blocks.find((b) => b.lastSeq < closed.record.sealedBlocks[1]!.ledgerSeq && b.lastSeq >= 6)!;
    const entries = new Map([...publicEntries(closed)].filter(([seq]) => seq <= lastBlock.lastSeq));
    const findings = await checkElection(evidence(closed, { lastBlock, entries }));
    expect(statusOf(findings, 'Every sealed block summary matches')).toBe('pending');
    expect(statusOf(findings, 'The ledger records each step')).toBe('pending');
  });

  it('catches more ballots sealed than voters on the roll', async () => {
    const findings = await checkElection(withRecord(closed, (r) => ({ ...r, roll: { ...r.roll!, count: 3 } })));
    expect(failed(findings)).toContain('Ballots sealed (4) do not exceed the voters on the roll (3)');
  });

  it('catches a roll signature that does not verify, and a roll the ledger never approved', async () => {
    const forger = await makeSigner();
    const { roll } = closed.record;
    const statement = { electionId: ELECTION_ID, snapshotId: 'snapshot-1', criteria: { status: 'active' as const }, asOf: roll!.asOf, count: roll!.count, merkleRoot: roll!.merkleRoot, approvalId: 'other' };
    const signature = await forger.sign(rollSigningInput(statement));
    const forged = await checkElection(withRecord(closed, (r) => ({ ...r, roll: { ...r.roll!, signature } })));
    expect(failed(forged)).toEqual(['The roll signature verifies over its roll statement']);

    const swapped = await checkElection(withRecord(closed, (r) => ({ ...r, roll: { ...r.roll!, merkleRoot: 'c'.repeat(64) } })));
    expect(failed(swapped)).toEqual(
      expect.arrayContaining(['A roll.approved ledger entry records the published roll', 'The roll signature verifies over its roll statement']),
    );
  });

  it('waits for the roll signature until the worker signs it', async () => {
    const findings = await checkElection(withRecord(closed, (r) => ({ ...r, roll: { ...r.roll!, signature: null } })));
    expect(statusOf(findings, 'The roll signature verifies')).toBe('pending');
    expect(failed(findings)).toEqual([]);
  });

  it('checks roll-call blocks: every part names its voter, one ballot each', async () => {
    expect(failed(await checkElection(evidence(rollCall)))).toEqual([]);
    const blocks = structuredClone(rollCall.sealedBlocks) as SealedBlockRecord[];
    const [first, second] = blocks[0]!.contests.plank! as readonly { accountId?: string }[];
    second!.accountId = first!.accountId;
    const findings = await checkElection(evidence(rollCall, { sealedBlocks: blocks }));
    expect(findings.find((f) => f.status === 'fail')!.detail).toContain('answered contest plank twice');
  });

  it('requires secret blocks of at least k ballots, unless turnout was below k', () => {
    const small = { ...closed.record, sealedBlocks: closed.record.sealedBlocks.map((s, i) => (i === 0 ? { ...s, ballotCount: 1 } : s)) };
    expect(kAnonymityFinding(small)[0]!.status).toBe('fail');
    const lowTurnout = { ...small, sealedBlocks: small.sealedBlocks.slice(0, 1) };
    expect(kAnonymityFinding(lowTurnout)[0]!.status).toBe('info');
    expect(kAnonymityFinding(rollCall.record)).toEqual([]);
  });
});

describe('an election the api does not publish', () => {
  /** Public entries about ELECTION_ID, numbered from 1; only `entry` matters to these checks. */
  const ledgerOf = (...steps: [LedgerEventType, Record<string, unknown>?][]) =>
    new Map(
      steps.map(([type, payload = {}], i) => {
        const entry = { v: 1, seq: i + 1, type, at: '2026-10-23T12:00:00.000Z', actor: 'a', subject: ELECTION_ID, payload, prevHash: '', hash: '' };
        return [i + 1, { entry } as unknown as PublicLedgerEntry];
      }),
    );
  const deletion: [LedgerEventType, Record<string, unknown>] = ['election.deleted', { electionId: ELECTION_ID, title: 'Officers', reason: 'test' }];

  it('fails when the ledger does not record a deletion', () => {
    expect(failed(missingElectionFindings(ELECTION_ID, ledgerOf(['election.cancelled'])))).toEqual(['The election record is published']);
  });

  it('passes a deletion that follows the cancellation, with no ballots sealed', () => {
    const findings = missingElectionFindings(ELECTION_ID, ledgerOf(['roll.approved'], ['election.scheduled'], ['election.cancelled'], deletion));
    expect(failed(findings)).toEqual([]);
    expect(findings[0]).toEqual({ status: 'info', label: 'Deleted permanently (entry 4, 2026-10-23T12:00:00.000Z)', detail: 'Officers: "test"' });
  });

  it('fails a deletion without a cancellation, with ballots sealed, or followed by more entries', () => {
    expect(failed(missingElectionFindings(ELECTION_ID, ledgerOf(deletion, ['election.cancelled'])))).toEqual([
      'The ledger records its cancellation, then its deletion as its last entry',
    ]);
    const sealed = ledgerOf(['election.opened'], ['ballots.sealed', { ballotCount: 2 }], ['election.cancelled'], deletion);
    expect(failed(missingElectionFindings(ELECTION_ID, sealed))).toEqual(['No ballots were sealed for it']);
  });
});
