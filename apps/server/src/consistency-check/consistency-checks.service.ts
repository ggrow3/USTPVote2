import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { sha256Hex } from 'ustp-audit';
import {
  checkConsistencyMaterial,
  checkConsistencyRequest,
  Collections,
  CONSISTENCY_DOCUMENTS,
  consistencyCheckId,
  consistencyDocuments,
  consistencyMaterial,
  ORIGINAL_CONSISTENCY_DOCUMENTS,
  definitionHash,
  materialCharacters,
  MAX_CONSISTENCY_MATERIAL_CHARACTERS,
  type ConsistencyCheckRecord,
  type ConsistencyCheckResult,
  type ConsistencyCheckState,
  type ConsistencyCheckView,
  type ConsistencyContest,
  type ConsistencyDocument,
  type ConsistencyDocumentsInput,
  type ConsistencyDocumentsRecord,
  type ElectionRecord,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { AnthropicKey, NO_KEY_REASON } from '../claude-checks/anthropic-key.js';
import { assertCheck } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { VotingService } from '../elections/voting.service.js';
import { Firebase } from '../infra/firebase.js';
import { MembershipService } from '../membership/membership.service.js';

/** The texts a check is built from, as the person asking can read them. */
interface Reading {
  readonly view: ConsistencyCheckView;
  readonly electionId: string;
  readonly title: string;
  readonly description: string;
  readonly definitionHash: string;
  readonly material: ConsistencyContest[];
}

/**
 * Requests for the platform consistency check (design §5.5). The api builds the questions from what the person may
 * already read (the ballot for a voter on the roll, the election editor's view for an Election Admin or Auditor), keeps
 * them on the person's one record for the election and queues it; the worker runs it and the browser polls. The record
 * holds no vote and nothing about whether the person voted.
 */
@Injectable()
export class ConsistencyChecksService {
  constructor(
    private readonly firebase: Firebase,
    private readonly voting: VotingService,
    private readonly reader: ElectionReader,
    private readonly membership: MembershipService,
    private readonly key: AnthropicKey,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** A voter on the roll, from the ballot: refused as the ballot is (404 for drafts and cancelled, 403 off the roll). */
  async requestFromBallot(ctx: RequestContext, electionId: string): Promise<ConsistencyCheckResult> {
    await this.assertEnabled();
    const ballot = await this.voting.ballot(ctx, electionId);
    return this.request(ctx, {
      view: 'ballot',
      electionId,
      title: ballot.definition.title,
      description: ballot.definition.description,
      definitionHash: ballot.definitionHash,
      material: consistencyMaterial(ballot.definition, ballot.proposals),
    });
  }

  /** An Election Admin or Auditor, from the election as the editor shows it: a draft as it stands, in any state. */
  async requestFromEditor(ctx: RequestContext, electionId: string): Promise<ConsistencyCheckResult> {
    await this.assertEnabled();
    const { definition, proposals } = await this.reader.load(electionId);
    return this.request(ctx, {
      view: 'admin',
      electionId,
      title: definition.title,
      description: definition.description,
      definitionHash: definitionHash(definition),
      material: consistencyMaterial(definition, proposals),
    });
  }

  /**
   * Whether the check can run (switched on and, for Claude, a key added), and the caller's own check of the election, if
   * any. Nobody reads anyone else's.
   */
  async state(ctx: RequestContext, electionId: string): Promise<ConsistencyCheckState> {
    const accountId = requireAccount(ctx);
    const snap = await this.firebase.db.collection(Collections.consistencyChecks).doc(consistencyCheckId(electionId, accountId)).get();
    const record = snap.data() as ConsistencyCheckRecord | undefined;
    const [enabled, documents] = await Promise.all([this.key.ready(this.config.consistencyChecker), this.documents(electionId)]);
    return { enabled, documents, check: record ? result(record) : null };
  }

  /** What the election's checks compare the questions with: what an Election Admin chose, or every document. */
  async documents(electionId: string): Promise<ConsistencyDocument[]> {
    const snap = await this.documentsRef(electionId).get();
    const record = snap.data() as ConsistencyDocumentsRecord | undefined;
    return record ? consistencyDocuments(record.documents) : [...CONSISTENCY_DOCUMENTS];
  }

  /**
   * An Election Admin chooses the documents while the election is a draft, like the rest of its setup, so every check
   * of a scheduled election, a voter's or an officer's, compares with the same texts. Not ledgered: it decides nothing.
   */
  async chooseDocuments(ctx: RequestContext, electionId: string, input: ConsistencyDocumentsInput): Promise<ConsistencyDocument[]> {
    const actor = requireAccount(ctx);
    const db = this.firebase.db;
    const documents = consistencyDocuments(input.documents);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.collection(Collections.elections).doc(electionId));
      if (!snap.exists) throw new NotFoundException('no such election');
      const { state } = snap.data() as ElectionRecord;
      if (state !== 'draft') throw new ConflictException(`the election is ${state}; its documents are chosen while it is a draft`);
      if (await this.reader.isCandidate(tx, electionId, actor)) {
        throw new ForbiddenException('you are a candidate in this election, so you cannot administer it');
      }
      const record: ConsistencyDocumentsRecord = { electionId, documents, updatedAt: new Date().toISOString(), updatedBy: actor };
      tx.set(this.documentsRef(electionId), record);
    });
    return documents;
  }

  private documentsRef(electionId: string) {
    return this.firebase.db.collection(Collections.consistencyDocuments).doc(electionId);
  }

  private async assertEnabled(): Promise<void> {
    if (this.config.consistencyChecker === 'off') throw new ServiceUnavailableException('the consistency check is not set up on this server');
    if (!(await this.key.ready(this.config.consistencyChecker))) {
      throw new ServiceUnavailableException(`the consistency check cannot run yet: ${NO_KEY_REASON}`);
    }
  }

  /**
   * Once per person per election: the record's ID is the election and the account, and the transaction that writes it
   * reads it first, so two requests at once cannot both pass. The daily limit is counted outside it, as a cost bound.
   */
  private async request(ctx: RequestContext, reading: Reading): Promise<ConsistencyCheckResult> {
    const accountId = requireAccount(ctx);
    const { material } = reading;
    const documents = await this.documents(reading.electionId);
    assertCheck(checkConsistencyMaterial(material, documents));
    const characters = materialCharacters(material);
    if (characters > MAX_CONSISTENCY_MATERIAL_CHARACTERS) {
      throw new ConflictException(
        `this ballot is too long for the consistency check (${characters} characters; at most ${MAX_CONSISTENCY_MATERIAL_CHARACTERS})`,
      );
    }
    const db = this.firebase.db;
    const checks = db.collection(Collections.consistencyChecks);
    const now = new Date();
    const [bylaws, today] = await Promise.all([
      documents.includes('bylaws') ? this.membership.currentBylaws() : null,
      checks.where('requestedAt', '>=', new Date(now.getTime() - 86_400_000).toISOString()).count().get(),
    ]);
    const record: ConsistencyCheckRecord = {
      checkId: consistencyCheckId(reading.electionId, accountId),
      electionId: reading.electionId,
      electionTitle: reading.title,
      electionDescription: reading.description,
      view: reading.view,
      definitionHash: reading.definitionHash,
      material,
      materialHash: sha256Hex(JSON.stringify(material)),
      documents,
      bylaws: bylaws ? { version: bylaws.version, contentHash: bylaws.contentHash } : null,
      requestedBy: accountId,
      requestedAt: now.toISOString(),
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      checker: null,
      model: null,
      references: [],
      findings: [],
      summary: null,
      error: null,
      usage: null,
    };
    const ref = checks.doc(record.checkId);
    await db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data() as ConsistencyCheckRecord | undefined;
      assertCheck(checkConsistencyRequest(existing ?? null, today.data().count, now));
      tx.set(ref, record);
    });
    return result(record);
  }
}

export function result({ material, documents, ...rest }: ConsistencyCheckRecord): ConsistencyCheckResult {
  return {
    ...rest,
    documents: documents ?? ORIGINAL_CONSISTENCY_DOCUMENTS,
    contests: material.map(({ position, contestId, title }) => ({ position, contestId, title })),
  };
}
