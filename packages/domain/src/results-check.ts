import { recordHash, verifyEcdsaP256 } from 'ustp-audit';
import { TALLY_VERSION } from 'ustp-tally';
import { definitionHash } from './elections.js';
import type { AnchorRecord, PublicLedgerEntry, SigningKeyRecord } from './ledger.js';
import { ledgerBlockSteps, stepsStatus, type CheckStep } from './receipt-check.js';
import { buildResultsBundle, matchesCommitment, resultsHash, resultsSigningInput, type ResultsRecord } from './results.js';
import { sealedBlockProblems, type PublicElection, type SealedBlockRecord } from './sealing.js';

/** What a verifier fetched to check an election's results; all of it is public once voting has closed. */
export interface ResultsEvidence {
  /** `GET /v1/public/elections/{id}` */
  readonly election: PublicElection;
  /** `GET /v1/public/elections/{id}/results` */
  readonly results: ResultsRecord;
  /** `GET /v1/public/elections/{id}/sealed-blocks` */
  readonly blocks: readonly SealedBlockRecord[];
  readonly keys: readonly SigningKeyRecord[];
  /** The `results.computed` entry; null until it is in a ledger block (404). */
  readonly ledger: PublicLedgerEntry | null;
  readonly anchor: AnchorRecord | null;
  /** Certified results: the `results.certified` entry (`certifiedLedgerSeq`); null until it is in a ledger block. */
  readonly certification?: PublicLedgerEntry | null;
}

export interface ResultsCheck {
  readonly status: 'verified' | 'pending' | 'failed';
  readonly steps: readonly CheckStep[];
}

/**
 * The results check (design §9), wherever it runs (the results page, a test, a script), from public data only: the
 * bundle's hash and signature, that it is for the frozen definition and roll, that the revealed seed matches its
 * commitment, that the sealed blocks verify, then a full re-tally from those blocks that must reproduce the bundle byte
 * for byte, and finally the `results.computed` entry through the signed, anchored ledger.
 */
export async function checkResults(e: ResultsEvidence): Promise<ResultsCheck> {
  const { bundle } = e.results;
  const { election, definition, roll } = e.election;
  const steps: CheckStep[] = [];

  steps.push({ label: 'The results bundle hashes to the published results hash', ok: resultsHash(bundle) === e.results.resultsHash });
  const key = e.keys.find((k) => k.keyVersion === e.results.signature.keyVersion);
  steps.push({
    label: 'Results signed by the audit key',
    ok: !!key && (await verifyEcdsaP256(key.publicKeyPem, resultsSigningInput(bundle), e.results.signature.signature)),
    detail: key ? `key ${key.keyId}` : 'unknown signing key',
  });
  steps.push({
    label: 'For this election’s frozen definition and approved roll',
    ok:
      bundle.electionId === election.electionId &&
      bundle.definitionHash === election.definitionHash &&
      definitionHash(definition) === election.definitionHash &&
      !!roll &&
      bundle.roll.snapshotId === roll.snapshotId &&
      bundle.roll.merkleRoot === roll.merkleRoot &&
      bundle.roll.count === roll.count,
  });
  steps.push({
    label: 'The revealed tie-break seed matches the commitment published at scheduling',
    ok:
      bundle.tieBreakSeedCommitment === election.tieBreakSeedCommitment &&
      matchesCommitment(bundle.tieBreakSeed, election.tieBreakSeedCommitment),
  });

  const problems = sealedBlockProblems(e.blocks);
  const ballots = e.blocks.reduce((n, b) => n + b.ballotCount, 0);
  const listed = bundle.sealedBlocks.map((b) => `${b.index}:${b.sealedHash}:${b.ballotCount}`).join();
  steps.push({
    label: 'Counts every published sealed block, and each recomputes from its parts',
    ok: problems.length === 0 && listed === e.blocks.map((b) => `${b.index}:${b.sealedHash}:${b.ballotCount}`).join(),
    detail: problems.length ? problems.join('; ') : `${e.blocks.length} ${e.blocks.length === 1 ? 'block' : 'blocks'}, ${ballots} ballots`,
  });

  let retally: CheckStep;
  try {
    if (!roll) throw new Error('the election has no published roll');
    const rebuilt = buildResultsBundle({
      definition,
      definitionHash: election.definitionHash ?? '',
      roll: { snapshotId: roll.snapshotId, merkleRoot: roll.merkleRoot, count: roll.count },
      tieBreakSeed: bundle.tieBreakSeed,
      tieBreakSeedCommitment: election.tieBreakSeedCommitment ?? '',
      blocks: e.blocks,
    });
    const same = resultsHash(rebuilt) === e.results.resultsHash;
    retally = {
      label: `Re-tallied here with ustp-tally ${TALLY_VERSION}: the same results`,
      ok: same,
      ...(!same && {
        detail:
          bundle.tally.version === TALLY_VERSION
            ? 'Counting the published ballots gives different results from the published ones.'
            : `The results were tallied with ustp-tally ${bundle.tally.version}.`,
      }),
    };
  } catch (err) {
    retally = { label: 'Re-tallied from the published ballots', ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  steps.push(retally);

  const { ledger } = e;
  if (!ledger) {
    steps.push({ label: 'Recorded in the signed audit ledger', ok: null, detail: 'Not yet: the next ledger block is sealed within a minute.' });
    return { status: stepsStatus(steps), steps };
  }
  const { entry } = ledger;
  const payload = entry.payload as Record<string, unknown>;
  steps.push({
    label: `Recorded in audit ledger entry ${entry.seq}`,
    ok:
      entry.seq === e.results.ledgerSeq &&
      entry.type === 'results.computed' &&
      payload.electionId === bundle.electionId &&
      payload.resultsHash === e.results.resultsHash &&
      recordHash(entry) === entry.hash,
  });
  steps.push(...(await ledgerBlockSteps(ledger, e.keys, e.anchor)));
  if (e.results.status === 'certified') steps.push(...(await certificationSteps(e)));
  return { status: stepsStatus(steps), steps };
}

/** Certified results (M4b): a `results.certified` entry naming this hash, in a signed, anchored ledger block. */
async function certificationSteps(e: ResultsEvidence): Promise<CheckStep[]> {
  const cert = e.certification;
  if (!cert) {
    return [{ label: 'Certification recorded in the signed audit ledger', ok: null, detail: 'Not yet: the next ledger block is sealed within a minute.' }];
  }
  const payload = cert.entry.payload as Record<string, unknown>;
  const steps: CheckStep[] = [
    {
      label: `Certified by two people: audit ledger entry ${cert.entry.seq}`,
      ok:
        cert.entry.seq === e.results.certifiedLedgerSeq &&
        cert.entry.type === 'results.certified' &&
        payload.electionId === e.results.electionId &&
        payload.resultsHash === e.results.resultsHash &&
        recordHash(cert.entry) === cert.entry.hash,
    },
  ];
  for (const step of await ledgerBlockSteps(cert, e.keys, e.anchor)) steps.push({ ...step, label: `Certification: ${step.label}` });
  return steps;
}
