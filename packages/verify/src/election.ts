import { GENESIS_HASH, verifyEcdsaP256, type BallotPart } from 'ustp-audit';
import {
  ballotProblems,
  definitionHash,
  rollSigningInput,
  sealedBlockProblems,
  type ElectionDefinition,
  type ElectionState,
  type LedgerBlockRecord,
  type LedgerEntry,
  type LedgerEventType,
  type PublicElection,
  type PublicLedgerEntry,
  type SealedBlockRecord,
  type SigningKeyRecord,
} from 'ustp-domain';
import { fail, info, pass, pending, problemsFinding, type Finding } from './report.js';
import { attempt, count } from './util.js';

/**
 * Checks of one election's published record (design §7.5, §12) against itself and against the verified ledger: the
 * frozen definition, the signed roll, every sealed block summary against its `ballots.sealed` entry, and, once voting
 * has closed, the sealed blocks' contents. Invariant 1 of design §2 is checked as far as public data allows.
 */

export interface ElectionEvidence {
  readonly record: PublicElection;
  /** Every public entry that verified (`checkEntryScan`), by seq; this election's are picked out by its ID. */
  readonly entries: ReadonlyMap<number, PublicLedgerEntry>;
  /** The last verified ledger block; entries after it cannot be checked yet. */
  readonly lastBlock: LedgerBlockRecord | null;
  readonly keys: readonly SigningKeyRecord[];
  /** The sealed blocks with their parts; null while the api withholds them (409 until voting closes). */
  readonly sealedBlocks: readonly SealedBlockRecord[] | null;
}

/** States in which the api must publish sealed block contents (voting is over, so they show no running tally). */
const CONTENTS_PUBLIC: readonly ElectionState[] = ['closed', 'certified'];

type Payload = Readonly<Record<string, unknown>>;

export async function checkElection(e: ElectionEvidence): Promise<Finding[]> {
  const { election } = e.record;
  const id = election.electionId;
  const mine = [...e.entries.values()]
    .map((p) => p.entry)
    .filter((entry) => entry.subject === id || entry.payload.electionId === id)
    .sort((a, b) => a.seq - b.seq);
  // An entry recorded after the last verified block was created cannot be in it: it is pending, not missing.
  const notBlockedYet = (at: string | null) => !e.lastBlock || (at !== null && Date.parse(e.lastBlock.createdAt) < Date.parse(at));
  return [
    info(`${election.title} (${election.secrecy === 'secret' ? 'secret ballot' : 'roll-call'}, ${election.state})`, `${id}, voting ${election.opensAt} to ${election.closesAt}`),
    definitionFinding(e.record),
    historyFinding(e.record, mine, notBlockedYet),
    ...(await rollFindings(e, mine, notBlockedYet)),
    summaryFinding(e, mine),
    ...kAnonymityFinding(e.record),
    countFinding(e.record),
    contentFinding(e),
  ];
}

export function definitionFinding(record: PublicElection): Finding {
  const { election, definition } = record;
  const label = 'The definition hashes to the published definitionHash';
  if (election.definitionHash === null) return info(label, 'never scheduled, so no definition was frozen');
  const problems: string[] = [];
  const hash = attempt(() => definitionHash(definition));
  if (hash !== election.definitionHash) {
    problems.push(`H(JCS(definition)) is ${hash ?? '(cannot be hashed)'}; the election record says ${election.definitionHash}`);
  }
  for (const field of ['electionId', 'title', 'description', 'secrecy', 'opensAt', 'closesAt', 'kAnonymity'] as const) {
    if (definition[field] !== election[field]) problems.push(`the definition's ${field} differs from the election record's`);
  }
  return problemsFinding(label, problems, `${election.definitionHash} (${count(definition.contests.length, 'contest')})`);
}

/** Each lifecycle step the record shows must be ledgered exactly once, with the same values; and nothing else. */
export function historyFinding(record: PublicElection, mine: readonly LedgerEntry[], notBlockedYet: (at: string | null) => boolean): Finding {
  const { election, roll, sealedBlocks } = record;
  const problems: string[] = [];
  const waiting: string[] = [];
  const seen: string[] = [];
  const step = (type: LedgerEventType, happened: boolean, at: string | null): Payload | null => {
    const found = mine.filter((x) => x.type === type);
    if (found.length > 1) problems.push(`${type} is recorded ${found.length} times (entries ${found.map((x) => x.seq).join(', ')})`);
    const first = found[0];
    if (!first) {
      if (happened) (notBlockedYet(at) ? waiting : problems).push(`no ${type} entry`);
      return null;
    }
    if (!happened) problems.push(`${type} is recorded (entry ${first.seq}) but the election record does not show it`);
    seen.push(`${type} ${first.seq}`);
    return first.payload;
  };
  const check = (ok: boolean, problem: string) => ok || problems.push(problem);

  const scheduled = step('election.scheduled', election.definitionHash !== null, roll?.asOf ?? null);
  if (scheduled) {
    check(scheduled.definitionHash === election.definitionHash, 'election.scheduled records another definitionHash');
    check(scheduled.tieBreakSeedCommitment === election.tieBreakSeedCommitment, 'election.scheduled records another tie-break seed commitment');
    check(scheduled.opensAt === election.opensAt && scheduled.closesAt === election.closesAt, 'election.scheduled records another voting window');
    if (roll) check(scheduled.rollMerkleRoot === roll.merkleRoot && scheduled.rollCount === roll.count, 'election.scheduled records another roll');
  }
  const opened = step('election.opened', election.openedAt !== null, election.openedAt);
  if (opened) check(opened.definitionHash === election.definitionHash, 'election.opened records another definitionHash');
  const closed = step('election.closed', election.closedAt !== null, election.closedAt);
  if (closed) check(closed.closesAt === election.closesAt, 'election.closed records another closing time');
  const sealed = step('election.sealed', election.sealedAt !== null, election.sealedAt);
  if (sealed) {
    const last = sealedBlocks.at(-1)?.sealedHash ?? GENESIS_HASH;
    check(
      sealed.blocks === sealedBlocks.length && sealed.ballots === record.ballotsSealed && sealed.lastSealedHash === last,
      `election.sealed records ${String(sealed.blocks)} blocks and ${String(sealed.ballots)} ballots ending at ${String(sealed.lastSealedHash)}`,
    );
  }
  step('election.cancelled', election.cancelledAt !== null, election.cancelledAt);

  const label = 'The ledger records each step of the election once, matching the record';
  if (problems.length) return problemsFinding(label, problems);
  if (waiting.length) return pending(label, `${waiting.join(', ')} yet: not in a verified ledger block yet`);
  return pass(label, seen.join(', '));
}

export async function rollFindings(
  e: ElectionEvidence,
  mine: readonly LedgerEntry[],
  notBlockedYet: (at: string | null) => boolean,
): Promise<Finding[]> {
  const { election, roll } = e.record;
  if (!roll) {
    return [
      election.definitionHash === null
        ? info('Voter roll', 'never scheduled, so there is no approved roll')
        : fail('The approved voter roll is published', 'the election was scheduled, but its record has no roll'),
    ];
  }
  const entryLabel = 'A roll.approved ledger entry records the published roll';
  const signatureLabel = 'The roll signature verifies over its roll statement';
  const approvals = mine.filter((x) => x.type === 'roll.approved');
  const match = approvals
    .filter((x) => x.payload.merkleRoot === roll.merkleRoot && x.payload.count === roll.count && x.payload.asOf === roll.asOf)
    .at(-1);
  if (!match) {
    const why = `the statement's snapshot and approval IDs come from that entry`;
    return notBlockedYet(roll.asOf)
      ? [pending(entryLabel, 'not in a verified ledger block yet'), pending(signatureLabel, why)]
      : [
          fail(entryLabel, `none of the ${approvals.length} roll.approved entries records ${roll.count} voters, root ${roll.merkleRoot}, as of ${roll.asOf}`),
          fail(signatureLabel, why),
        ];
  }
  const { snapshotId, approvalId } = match.payload;
  const scheduledSnapshot = mine.find((x) => x.type === 'election.scheduled')?.payload.rollSnapshotId;
  const findings: Finding[] = [
    scheduledSnapshot !== undefined && scheduledSnapshot !== snapshotId
      ? fail(entryLabel, `election.scheduled names roll snapshot ${String(scheduledSnapshot)}; entry ${match.seq} approved ${String(snapshotId)}`)
      : pass(entryLabel, `entry ${match.seq}: ${roll.count} voters as of ${roll.asOf}, root ${roll.merkleRoot}`),
  ];

  if (!roll.signature) {
    findings.push(pending(signatureLabel, 'not signed yet: the worker signs approved rolls within a minute'));
    return findings;
  }
  const key = e.keys.find((k) => k.keyVersion === roll.signature!.keyVersion);
  if (!key) {
    findings.push(fail(signatureLabel, `signed by ${roll.signature.keyVersion}, which the api does not list`));
  } else if (typeof snapshotId !== 'string' || typeof approvalId !== 'string') {
    findings.push(fail(signatureLabel, `entry ${match.seq} lacks the snapshot or approval ID`));
  } else {
    // The roll statement's criteria are fixed: Active members (the only roll there is, design §6.3).
    const statement = { electionId: election.electionId, snapshotId, criteria: { status: 'active' as const }, asOf: roll.asOf, count: roll.count, merkleRoot: roll.merkleRoot, approvalId };
    const ok = await verifyEcdsaP256(key.publicKeyPem, rollSigningInput(statement), roll.signature.signature);
    findings.push(
      ok
        ? pass(signatureLabel, `key ${key.keyId}; snapshot ${snapshotId}, approval ${approvalId}`)
        : fail(signatureLabel, `the signature by key ${key.keyId} does not verify`),
    );
  }
  return findings;
}

/**
 * Every summary must match its `ballots.sealed` entry, the entries must chain through `prevSealedHash`, and every
 * `ballots.sealed` entry for the election must have a summary, so the record cannot leave a block out.
 */
export function summaryFinding(e: ElectionEvidence, mine: readonly LedgerEntry[]): Finding {
  const { election, sealedBlocks: summaries } = e.record;
  const label = 'Every sealed block summary matches its ballots.sealed ledger entry';
  if (summaries.length === 0 && !mine.some((x) => x.type === 'ballots.sealed')) return info(label, 'no sealed blocks yet');
  const through = e.lastBlock?.lastSeq ?? 0;
  const problems: string[] = [];
  const waiting: number[] = [];
  let prev = GENESIS_HASH;
  for (const [i, s] of summaries.entries()) {
    const at = `sealed block ${s.index}`;
    if (s.index !== i + 1) problems.push(`${at}: summaries are not numbered consecutively`);
    const found = e.entries.get(s.ledgerSeq)?.entry;
    if (!found) {
      if (s.ledgerSeq > through) waiting.push(s.index);
      else problems.push(`${at}: ledger entry ${s.ledgerSeq} is not a verified public entry`);
    } else {
      const p = found.payload;
      if (found.type !== 'ballots.sealed' || found.subject !== election.electionId || p.electionId !== election.electionId) {
        problems.push(`${at}: ledger entry ${s.ledgerSeq} is not this election's ballots.sealed entry`);
      } else {
        for (const field of ['index', 'ballotCount', 'merkleRoot', 'sealedHash'] as const) {
          if (p[field] !== s[field]) problems.push(`${at}: ${field} differs from ledger entry ${s.ledgerSeq}`);
        }
        if (p.prevSealedHash !== prev) problems.push(`${at}: ledger entry ${s.ledgerSeq} does not link to the previous block`);
      }
    }
    prev = s.sealedHash;
  }
  for (const x of mine.filter((x) => x.type === 'ballots.sealed')) {
    if (!summaries.some((s) => s.ledgerSeq === x.seq)) {
      problems.push(`ledger entry ${x.seq} records sealed block ${String(x.payload.index)}, which the election record leaves out`);
    }
  }
  if (problems.length) return problemsFinding(label, problems);
  const checked = summaries.length - waiting.length;
  if (waiting.length) return pending(label, `${checked} match; blocks ${waiting.join(', ')} are not in a verified ledger block yet`);
  return pass(label, `${count(summaries.length, 'block')}, ledger ${summaries.length === 1 ? 'entry' : 'entries'} ${summaries.map((s) => s.ledgerSeq).join(', ')}`);
}

/** Secret ballots: every block holds at least k ballots, unless turnout itself was below k (design §7.2). */
export function kAnonymityFinding(record: PublicElection): Finding[] {
  const { election, sealedBlocks } = record;
  if (election.secrecy !== 'secret' || sealedBlocks.length === 0) return [];
  const k = election.kAnonymity;
  const label = `Every sealed block holds at least k = ${k} ballots`;
  const small = sealedBlocks.filter((b) => b.ballotCount < k);
  if (small.length === 0) return [pass(label)];
  if (sealedBlocks.length === 1 && election.closedAt !== null) {
    return [info(label, `turnout was below k: the one block, sealed at close, holds ${small[0]!.ballotCount}`)];
  }
  return [fail(label, small.map((b) => `sealed block ${b.index} holds ${b.ballotCount}`).join('\n'))];
}

/** Invariant 1, as far as public data goes: sealed ballots never exceed the roll. */
export function countFinding(record: PublicElection): Finding {
  const total = record.sealedBlocks.reduce((sum, b) => sum + b.ballotCount, 0);
  const problems: string[] = [];
  if (record.ballotsSealed !== total) problems.push(`the record says ${record.ballotsSealed} ballots were sealed; its blocks hold ${total}`);
  if (record.roll && total > record.roll.count) problems.push(`${total} ballots sealed for ${record.roll.count} voters on the roll`);
  return problemsFinding(
    `Ballots sealed (${total}) do not exceed the voters on the roll (${record.roll?.count ?? 'none'})`,
    problems,
    'participation records and roll entries are not public, so "sealed = participation" and "every participant is on the roll" are not checked here',
  );
}

/** Once voting has closed: the published contents recompute, match the summaries, and every part is a valid answer. */
export function contentFinding(e: ElectionEvidence): Finding {
  const { record, sealedBlocks } = e;
  const { election, definition, sealedBlocks: summaries } = record;
  const label = 'Sealed block contents recompute and match their summaries';
  if (!sealedBlocks) {
    return CONTENTS_PUBLIC.includes(election.state)
      ? fail(label, 'the api withholds them although voting has closed')
      : pending(label, 'published when voting closes; until then only the summaries are public');
  }
  const problems = attempt(() => sealedBlockProblems(sealedBlocks)) ?? ['the sealed blocks cannot be recomputed: malformed parts'];
  if (sealedBlocks.length !== summaries.length) problems.push(`${sealedBlocks.length} blocks are published but ${summaries.length} summarised`);
  const voterBlock = new Map<string, number>();
  let parts = 0;
  for (const block of sealedBlocks) {
    const at = `sealed block ${block.index}`;
    const summary = summaries.find((s) => s.index === block.index);
    if (!summary) problems.push(`${at}: has no summary`);
    else {
      for (const field of ['ballotCount', 'merkleRoot', 'sealedHash', 'sealedAt', 'ledgerSeq'] as const) {
        if (block[field] !== summary[field]) problems.push(`${at}: ${field} differs from its summary`);
      }
    }
    if (block.electionId !== election.electionId) problems.push(`${at}: belongs to election ${block.electionId}`);
    for (const problem of partProblems(block, definition)) problems.push(`${at}: ${problem}`);
    for (const part of Object.values(block.contests).flat()) {
      parts++;
      if (part.accountId === undefined) continue;
      const other = voterBlock.get(part.accountId);
      if (other !== undefined && other !== block.index) problems.push(`${at}: voter ${part.accountId} also voted in sealed block ${other}`);
      voterBlock.set(part.accountId, block.index);
    }
  }
  const ballots = sealedBlocks.reduce((sum, b) => sum + b.ballotCount, 0);
  return problemsFinding(label, problems, `${count(sealedBlocks.length, 'block')}, ${count(ballots, 'ballot')}, ${count(parts, 'part')}; every part is a valid answer`);
}

/**
 * One block's parts: filed under their own contest, valid answers to the frozen definition (as the cast endpoint
 * requires), no more parts per contest than ballots, and voters named exactly when the ballot is roll-call.
 */
export function partProblems(block: SealedBlockRecord, definition: ElectionDefinition): string[] {
  const problems: string[] = [];
  const voters = new Set<string>();
  for (const [contestId, parts] of Object.entries(block.contests)) {
    if (!definition.contests.some((c) => c.contestId === contestId)) problems.push(`parts for unknown contest ${contestId}`);
    if (parts.length > block.ballotCount) problems.push(`${parts.length} parts for contest ${contestId} from ${block.ballotCount} ballots`);
    const answered = new Set<string>();
    for (const { accountId, ...part } of parts) {
      if (part.contestId !== contestId) problems.push(`a part for ${part.contestId} is filed under ${contestId}`);
      problems.push(...(attempt(() => ballotProblems(definition, [part as BallotPart])) ?? ['a part cannot be read']));
      if (definition.secrecy === 'secret') {
        if (accountId !== undefined) problems.push('a secret ballot part names a voter');
      } else if (typeof accountId !== 'string') {
        problems.push('a roll-call part does not name its voter');
      } else {
        if (answered.has(accountId)) problems.push(`voter ${accountId} answered contest ${contestId} twice`);
        answered.add(accountId);
        voters.add(accountId);
      }
    }
  }
  if (definition.secrecy === 'open' && voters.size !== block.ballotCount) {
    problems.push(`${voters.size} voters for ${block.ballotCount} ballots`);
  }
  return problems;
}
