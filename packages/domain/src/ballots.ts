import { ballotPartCommitment, type BallotPart } from 'ustp-audit';
import { validateSelection } from 'ustp-tally';
import { z } from 'zod';
import type { BylawsAmendment } from './amendments.js';
import type { ElectionState } from './election-state.js';
import { definitionHash, proposalContentHash, type ElectionDefinition, type Secrecy } from './elections.js';

/**
 * Casting (design §7). The browser builds one part per answered contest, salts it and commits to it before sending;
 * the server checks the parts against the frozen definition and stores them encrypted (secret ballots) or with the
 * voter's account (open roll-call ballots).
 */

const hex32 = z.string().regex(/^[0-9a-f]{64}$/, 'expected 64 lowercase hex digits');

/** `POST /v1/elections/{id}/ballots`. Selections are checked per contest by `ustp-tally`, not here. */
export const castBallotSchema = z.strictObject({
  definitionHash: hex32,
  parts: z
    .array(
      z.strictObject({
        v: z.literal(1),
        electionId: z.string().min(1).max(64),
        contestId: z.string().min(1).max(64),
        selection: z.unknown(),
        salt: hex32,
      }),
    )
    .min(1, 'answer at least one contest')
    .max(100),
});
export type CastBallotInput = z.infer<typeof castBallotSchema>;

/** What is wrong with a ballot's parts against the frozen definition; empty when it can be cast. */
export function ballotProblems(definition: ElectionDefinition, parts: readonly BallotPart[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.electionId !== definition.electionId) {
      problems.push('a ballot part belongs to another election');
      continue;
    }
    const contest = definition.contests.find((c) => c.contestId === part.contestId);
    if (!contest) {
      problems.push(`unknown contest ${JSON.stringify(part.contestId)}`);
      continue;
    }
    if (seen.has(part.contestId)) problems.push(`“${contest.title}” is answered twice`);
    seen.add(part.contestId);
    const check = validateSelection(contest.spec, part.selection);
    if (!check.valid) problems.push(`“${contest.title}”: ${check.reason}`);
  }
  return problems;
}

export interface Commitment {
  readonly contestId: string;
  readonly commitment: string;
}

export function commitmentsOf(parts: readonly BallotPart[]): Commitment[] {
  return parts.map((part) => ({ contestId: part.contestId, commitment: ballotPartCommitment(part) }));
}

/** `elections/{id}/participation/{accountId}`: the duplicate-vote guard, created once (design §7.1). */
export interface ParticipationRecord {
  readonly accountId: string;
  readonly castAt: string;
  /** Open (roll-call) ballots only: the ballot itself, published with the voter (design §7.4). */
  readonly parts?: readonly BallotPart[];
}

/**
 * `elections/{id}/ballot_pool/{randomId}`: one secret ballot, `JCS(parts)` encrypted to the election's pool key
 * (design §7.3). No voter, no timestamp. AES-256-GCM under a fresh data key, which is wrapped with RSA-OAEP-SHA256.
 * All binary fields are base64.
 */
export interface PoolEntryRecord {
  readonly v: 1;
  readonly keyVersion: string;
  readonly wrappedKey: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

/** An election as a voter on its roll sees it in `GET /v1/elections`. */
export interface VoterElection {
  readonly electionId: string;
  readonly title: string;
  readonly description: string;
  readonly secrecy: Secrecy;
  readonly state: ElectionState;
  readonly opensAt: string;
  readonly closesAt: string;
  /** When the caller cast their ballot, if they have. */
  readonly castAt: string | null;
}

/** `GET /v1/elections/{id}/ballot`: the frozen definition, its hash, and the texts of the proposals on it. */
export interface BallotView {
  readonly election: VoterElection;
  readonly definition: ElectionDefinition;
  readonly definitionHash: string;
  readonly proposals: readonly {
    readonly snapshotId: string;
    readonly title: string;
    readonly body: string;
    readonly contentHash: string;
    /** The bylaws lines it changes, for an amendment (design §6.6); null otherwise. */
    readonly amendment: BylawsAmendment | null;
  }[];
}

/**
 * What a voter's browser cannot confirm about a ballot (design §7.5): that it is the definition frozen at scheduling,
 * and that every proposal's text, and any bylaws lines it changes, are the ones the definition commits to. Empty when
 * everything checks out.
 */
export function ballotViewProblems(view: Pick<BallotView, 'definition' | 'definitionHash' | 'proposals'>): string[] {
  const problems: string[] = [];
  if (definitionHash(view.definition) !== view.definitionHash) problems.push('the ballot is not the definition frozen at scheduling');
  for (const c of view.definition.contests) {
    if (!c.proposal) continue;
    const text = view.proposals.find((p) => p.snapshotId === c.proposal!.snapshotId);
    const base = text?.amendment?.base;
    const named = c.proposal.amendsBylaws;
    if (!text || proposalContentHash(text.title, text.body, text.amendment) !== c.proposal.contentHash) {
      problems.push(`the text of "${c.title}" is not the one the definition commits to`);
    } else if ((base?.version ?? null) !== (named?.version ?? null) || (base?.contentHash ?? null) !== (named?.contentHash ?? null)) {
      problems.push(`"${c.title}" amends a different bylaws version than the definition names`);
    }
  }
  return problems;
}

/** `POST /v1/elections/{id}/ballots`: the server's commitments, which the browser compares with its own. */
export interface CastResult {
  readonly electionId: string;
  readonly castAt: string;
  readonly commitments: readonly Commitment[];
}

/**
 * What the voter keeps (design §7.5): with the salts, each part can later be found in its sealed block. It also proves
 * how they voted to anyone they show it to, so it is never sent to the server again or stored with their identity.
 */
export interface BallotReceipt {
  readonly v: 1;
  readonly electionId: string;
  readonly title: string;
  readonly definitionHash: string;
  readonly castAt: string;
  readonly parts: readonly BallotPart[];
  readonly commitments: readonly Commitment[];
}
