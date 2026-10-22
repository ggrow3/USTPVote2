import {
  ballotPartCommitment,
  blockHash,
  blockSigningInput,
  recordHash,
  verifyEcdsaP256,
  verifyInclusionHex,
  type BallotPart,
  type InclusionProof,
} from 'ustp-audit';
import type { AnchorRecord, PublicLedgerEntry, SigningKeyRecord } from './ledger.js';

/** `GET /v1/public/elections/{id}/proofs/{commitment}`: where a sealed part is, and the proof that it is there. */
export interface BallotProof {
  readonly electionId: string;
  readonly commitment: string;
  readonly blockIndex: number;
  readonly merkleRoot: string;
  readonly sealedHash: string;
  /** The `ballots.sealed` ledger entry recording the block. */
  readonly ledgerSeq: number;
  readonly proof: InclusionProof;
}

/** What a verifier fetched for one part of a receipt; null where the server had nothing yet (404). */
export interface PartEvidence {
  readonly part: BallotPart;
  /** The commitment the receipt lists for this part. */
  readonly commitment: string;
  readonly proof: BallotProof | null;
  readonly ledger: PublicLedgerEntry | null;
  readonly keys: readonly SigningKeyRecord[];
  readonly anchor: AnchorRecord | null;
}

export interface CheckStep {
  readonly label: string;
  /** null: cannot be checked yet. */
  readonly ok: boolean | null;
  readonly detail?: string;
}

export interface PartCheck {
  readonly contestId: string;
  readonly commitment: string;
  readonly status: 'verified' | 'pending' | 'failed';
  readonly steps: readonly CheckStep[];
}

/**
 * The receipt check of design §7.5, done wherever it runs (the browser's /verify page, a test, a script) from public
 * data only: the part's commitment → its inclusion in the sealed block's Merkle root → the block recorded in a ledger
 * entry → that entry's inclusion in a ledger block → the ledger block's signature → an anchor covering it.
 */
export async function checkReceiptPart(e: PartEvidence): Promise<PartCheck> {
  const steps: CheckStep[] = [];
  const done = (): PartCheck => ({
    contestId: e.part.contestId,
    commitment: e.commitment,
    status: steps.some((s) => s.ok === false) ? 'failed' : steps.some((s) => s.ok === null) ? 'pending' : 'verified',
    steps,
  });

  let recomputed: string | null = null;
  try {
    recomputed = ballotPartCommitment(e.part);
  } catch {
    // malformed part
  }
  steps.push({ label: 'The receipt’s selection and salt produce its commitment', ok: recomputed === e.commitment });
  if (recomputed !== e.commitment) return done();

  const { proof } = e;
  if (!proof) {
    steps.push({
      label: 'Sealed into a published block',
      ok: null,
      detail: 'Not yet: ballots wait in the encrypted pool until enough others have voted, or until voting closes.',
    });
    return done();
  }
  steps.push({ label: `Sealed into block ${proof.blockIndex} of the election`, ok: proof.electionId === e.part.electionId });
  steps.push({
    label: 'Included in that block’s Merkle root',
    ok: proof.commitment === e.commitment && proof.proof.root === proof.merkleRoot && verifyInclusionHex(e.commitment, proof.proof),
  });

  const { ledger } = e;
  if (!ledger) {
    steps.push({ label: 'Recorded in the signed audit ledger', ok: null, detail: 'Not yet: the next ledger block is sealed within a minute.' });
    return done();
  }
  const { entry } = ledger;
  const payload = entry.payload as Record<string, unknown>;
  steps.push({
    label: `Recorded in audit ledger entry ${entry.seq}`,
    ok:
      entry.seq === proof.ledgerSeq &&
      entry.type === 'ballots.sealed' &&
      payload.electionId === proof.electionId &&
      payload.index === proof.blockIndex &&
      payload.merkleRoot === proof.merkleRoot &&
      payload.sealedHash === proof.sealedHash &&
      recordHash(entry) === entry.hash,
  });
  steps.push({
    label: `Included in ledger block ${ledger.block.index}`,
    ok: ledger.proof.root === ledger.block.merkleRoot && verifyInclusionHex(entry.hash, ledger.proof),
  });
  const key = e.keys.find((k) => k.keyVersion === ledger.block.signature.keyVersion);
  steps.push({
    label: 'Ledger block signed by the audit key',
    ok:
      !!key &&
      blockHash(ledger.block) === ledger.block.blockHash &&
      (await verifyEcdsaP256(key.publicKeyPem, blockSigningInput(ledger.block), ledger.block.signature.signature)),
    detail: key ? `key ${key.keyId}` : 'unknown signing key',
  });
  const anchored = !!e.anchor && e.anchor.index >= ledger.block.index;
  steps.push({
    label: 'Anchored outside the database',
    ok: anchored ? true : null,
    detail: anchored ? `through ledger block ${e.anchor!.index}, ${e.anchor!.uri}` : 'Not yet: anchoring follows within a minute.',
  });
  return done();
}
