import { hashCanonical } from 'ustp-audit';
import { validateContestSpec, type ContestSpec } from 'ustp-tally';
import type { BylawsAmendment } from './amendments.js';
import { deny, OK, type Check } from './check.js';
import type { MemberStatus } from './membership/member-status.js';
import type { RollCriteria } from './roll.js';
import type { ElectionState } from './election-state.js';
import type { SignatureRecord } from './ledger.js';
import type { ApprovalRequestRecord } from './records.js';
import type { ResultsSummary } from './results.js';

/** Election definitions (design §6). Editable while `draft`; frozen by its hash when scheduled (M2b). */

export const SECRECY_MODES = ['secret', 'open'] as const;
export type Secrecy = (typeof SECRECY_MODES)[number];

/** Smallest sealed block allowed for secret ballots (design §7.2). */
export const MIN_K_ANONYMITY = 2;
export const DEFAULT_K_ANONYMITY = 10;

/** `elections/{electionId}` */
export interface ElectionRecord {
  readonly electionId: string;
  readonly title: string;
  readonly description: string;
  readonly secrecy: Secrecy;
  readonly opensAt: string;
  readonly closesAt: string;
  /** Minimum ballots per sealed block (secret ballots). */
  readonly kAnonymity: number;
  readonly state: ElectionState;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set when scheduled: H(JCS(definition)). */
  readonly definitionHash: string | null;
  /** The approved voter roll (an `eligibility_snapshots` document). */
  readonly rollSnapshotId: string | null;
  /** Set when scheduled: SHA-256 of the secret tie-break seed, which is revealed at tally (design §9). */
  readonly tieBreakSeedCommitment: string | null;
  /** Where the seed is kept (a secret's ID, not the seed itself). */
  readonly tieBreakSeedRef: string | null;
  readonly scheduledAt: string | null;
  readonly cancelledAt: string | null;
  /**
   * Secret ballots: the ballot-pool key version ballots are encrypted to (design §7.3), created by the worker once the
   * election is scheduled. The election does not open without it.
   */
  readonly poolKeyVersion: string | null;
  /** Set by the worker on its clock (design §6.1). */
  readonly openedAt: string | null;
  readonly closedAt: string | null;
  /** Set once the election is closed and every ballot is in a sealed block (design §7.2). */
  readonly sealedAt: string | null;
  /** Set when an Auditor certifies its results (two-person, design §6.1). */
  readonly certifiedAt: string | null;
  /** Set once the worker has destroyed the ballot-pool key version (certified or cancelled, design §7.3). */
  readonly poolKeyDestroyedAt: string | null;
  /**
   * Set when scheduled: the bylaws version its proposals amend (design §6.6), or null when none does. While the election
   * is scheduled, open or closed, that version stays current. Absent on elections scheduled before amendments.
   */
  readonly amendsBylaws?: BylawsBase | null;
}

/** A published bylaws version, by name and the hash of its text. */
export interface BylawsBase {
  readonly version: string;
  readonly contentHash: string;
}

/**
 * `eligibility_snapshots/{snapshotId}` — a voter roll (design §6.3): every Active member at `asOf`, sorted. Holds
 * the full list, which fits about 25,000 members in Firestore's 1 MiB document limit (spec: 1,000–5,000).
 */
export interface RollSnapshotRecord {
  readonly snapshotId: string;
  readonly electionId: string;
  readonly criteria: RollCriteria;
  readonly asOf: string;
  readonly accountIds: readonly string[];
  readonly count: number;
  /** `rollMerkleRoot(electionId, accountIds)`. */
  readonly merkleRoot: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'superseded';
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly approvalId: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Signature over `rollStatement(snapshot)`, added by the worker shortly after approval. */
  readonly signature: SignatureRecord | null;
}

/** Two-person request payloads for election actions (design §10.2); the approver approves exactly these. */
export interface RollApprovalPayload {
  readonly electionId: string;
  readonly snapshotId: string;
  readonly merkleRoot: string;
  readonly count: number;
  /**
   * Only on a rehearsal roll (test voters only, design §10.4): the request's payload hash, and the `roll.approved`
   * ledger entry that copies the payload, then cover it. Normal rolls leave it out, as before.
   */
  readonly criteria?: RollCriteria;
}

export interface SchedulePayload {
  readonly electionId: string;
  /** The definition as it stood at request time; approval fails if it has changed since. */
  readonly definitionHash: string;
  readonly rollSnapshotId: string;
  readonly rollMerkleRoot: string;
}

export interface CancelPayload {
  readonly electionId: string;
  readonly fromState: ElectionState;
}

/** `elections/{id}/contests/{contestId}`. `spec.id` equals `contestId`; candidate contests list candidate IDs. */
export interface ContestRecord {
  readonly contestId: string;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly spec: ContestSpec;
  /** Proposal contests: the frozen text being voted on. */
  readonly proposalSnapshotId: string | null;
  /** Candidate contests that fill an office: its `positions` ID. Certification creates a term per winner. */
  readonly positionId?: string | null;
}

/** `elections/{id}/candidates/{candidateId}`. Their order is the contest spec's `candidates` list. */
export interface CandidateRecord {
  readonly candidateId: string;
  readonly contestId: string;
  readonly name: string;
  readonly statement: string | null;
  /** The member standing, when the candidate is a person with an account (used for recusal checks). */
  readonly accountId: string | null;
}

/**
 * Whether a candidate may be linked to `accountId` (design §6.5): only to an Active member's account, read when the
 * candidate is added. Linking your own is refused before this, since you could no longer act on the election.
 */
export function checkCandidateAccount(accountId: string, member: { readonly status: MemberStatus } | null): Check {
  return member?.status === 'active' ? OK : deny(`account ${accountId} is not an Active member`);
}

/** `proposal_snapshots/{snapshotId}` — immutable: the exact text put to a vote. */
export interface ProposalSnapshotRecord {
  readonly snapshotId: string;
  readonly title: string;
  /** Markdown. */
  readonly body: string;
  /** Where it came from (URL, forum post, minutes), if anywhere. */
  readonly source: string | null;
  /** The bylaws lines it changes (design §6.6). Absent or null for any other proposal. */
  readonly amendment?: BylawsAmendment | null;
  /** `proposalContentHash(title, body, amendment)`. */
  readonly contentHash: string;
  readonly capturedAt: string;
  readonly capturedBy: string;
}

/**
 * H(JCS({v: 1, title, body})), or for a bylaws amendment H(JCS({v: 2, title, body, amendment})), so the hash a voter
 * checks covers the exact lines changed. Proposals without an amendment keep their v1 hash.
 */
export function proposalContentHash(title: string, body: string, amendment?: BylawsAmendment | null): string {
  return amendment ? hashCanonical({ v: 2, title, body, amendment }) : hashCanonical({ v: 1, title, body });
}

/** Everything a voter's ballot and the tally depend on, in canonical order. Its hash is what scheduling freezes. */
export interface ElectionDefinition {
  readonly v: 1;
  readonly electionId: string;
  readonly title: string;
  readonly description: string;
  readonly secrecy: Secrecy;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly kAnonymity: number;
  readonly contests: readonly {
    readonly contestId: string;
    readonly title: string;
    readonly description: string;
    readonly spec: ContestSpec;
    readonly proposal: {
      readonly snapshotId: string;
      readonly title: string;
      readonly contentHash: string;
      /** The bylaws version the proposal amends (design §6.6). Present only on amendments, so other hashes are unchanged. */
      readonly amendsBylaws?: BylawsBase;
    } | null;
    readonly candidates: readonly { readonly candidateId: string; readonly name: string; readonly statement: string | null }[];
    /** The office the contest fills, frozen with the rest (design §6.4); null when none. */
    readonly positionId: string | null;
  }[];
}

export function buildDefinition(
  election: ElectionRecord,
  contests: readonly ContestRecord[],
  candidates: readonly CandidateRecord[],
  proposals: readonly ProposalSnapshotRecord[],
): ElectionDefinition {
  const byOrder = (a: ContestRecord, b: ContestRecord) => a.order - b.order;
  return {
    v: 1,
    electionId: election.electionId,
    title: election.title,
    description: election.description,
    secrecy: election.secrecy,
    opensAt: election.opensAt,
    closesAt: election.closesAt,
    kAnonymity: election.kAnonymity,
    contests: [...contests].sort(byOrder).map((c) => {
      const proposal = proposals.find((p) => p.snapshotId === c.proposalSnapshotId);
      const listed = c.spec.kind === 'proposal' ? [] : c.spec.candidates;
      const position = (k: CandidateRecord) => (listed.includes(k.candidateId) ? listed.indexOf(k.candidateId) : listed.length);
      return {
        contestId: c.contestId,
        title: c.title,
        description: c.description,
        spec: c.spec,
        proposal: proposal
          ? {
              snapshotId: proposal.snapshotId,
              title: proposal.title,
              contentHash: proposal.contentHash,
              ...(proposal.amendment && { amendsBylaws: { ...proposal.amendment.base } }),
            }
          : null,
        candidates: candidates
          .filter((k) => k.contestId === c.contestId)
          .sort((a, b) => position(a) - position(b) || a.candidateId.localeCompare(b.candidateId))
          .map((k) => ({ candidateId: k.candidateId, name: k.name, statement: k.statement })),
        positionId: c.positionId ?? null,
      };
    }),
  };
}

/** `GET /v1/admin/elections/{id}`: the editable parts plus what scheduling would freeze. */
export interface ElectionDetail {
  readonly election: ElectionRecord;
  readonly contests: readonly ContestRecord[];
  readonly candidates: readonly CandidateRecord[];
  readonly proposals: readonly ProposalSnapshotRecord[];
  /** Hash of the definition as it stands; scheduling freezes exactly this. */
  readonly definitionHash: string;
  /** What must be fixed before scheduling; empty when ready. */
  readonly problems: readonly string[];
  /** The latest voter roll (pending or approved), without the member list. */
  readonly roll: Omit<RollSnapshotRecord, 'accountIds'> | null;
  /** Two-person requests about this election awaiting a decision. */
  readonly pending: readonly ApprovalRequestRecord[];
  /** Once tallied: the results' status and hash, which certification approves. */
  readonly results: ResultsSummary | null;
  /**
   * Cancelled and certified elections: how many ballots were cast, which decides whether it can be deleted (§6.1;
   * a rehearsal's ballots do not, §10.4).
   */
  readonly ballotsCast: number | null;
  /**
   * Certified elections: the terms of office their certification started. A rehearsal that seated anyone stays on
   * record (§10.4).
   */
  readonly officeTerms: number | null;
}

/** `GET /v1/admin/elections/{id}/roll`: the latest roll with names, for review before approval. */
export interface RollView {
  readonly snapshot: Omit<RollSnapshotRecord, 'accountIds'>;
  readonly entries: readonly { readonly accountId: string; readonly legalName: string; readonly state: string }[];
}

export function definitionHash(definition: ElectionDefinition): string {
  return hashCanonical(definition);
}

/**
 * Problems that must be fixed before the election can be scheduled; empty when ready. `now` enforces that voting
 * opens in the future.
 */
export function validateDefinition(def: ElectionDefinition, now: Date = new Date()): string[] {
  const problems: string[] = [];
  if (!def.title.trim()) problems.push('the election needs a title');
  const opens = Date.parse(def.opensAt);
  const closes = Date.parse(def.closesAt);
  if (Number.isNaN(opens) || Number.isNaN(closes)) problems.push('opening and closing times must be valid dates');
  else {
    if (closes <= opens) problems.push('voting must close after it opens');
    if (opens <= now.getTime()) problems.push('voting must open in the future');
  }
  if (def.secrecy === 'secret' && def.kAnonymity < MIN_K_ANONYMITY) {
    problems.push(`secret ballots need an anonymity threshold of at least ${MIN_K_ANONYMITY}`);
  }
  if (def.contests.length === 0) problems.push('add at least one contest');

  for (const c of def.contests) {
    const label = `“${c.title || c.contestId}”`;
    if (c.spec.id !== c.contestId) problems.push(`${label}: contest id mismatch`);
    if (c.spec.kind === 'proposal') {
      if (!c.proposal) problems.push(`${label}: attach the proposal text being voted on`);
      if (c.positionId) problems.push(`${label}: a proposal cannot fill an office`);
    } else {
      const ids = c.candidates.map((k) => k.candidateId);
      if (ids.length === 0) problems.push(`${label}: add candidates`);
      if (ids.join() !== c.spec.candidates.join()) problems.push(`${label}: candidate list is out of sync`);
    }
    if (c.spec.kind !== 'proposal' && c.spec.candidates.length === 0) continue;
    for (const p of validateContestSpec(c.spec)) problems.push(`${label}: ${p}`);
  }
  return problems;
}
