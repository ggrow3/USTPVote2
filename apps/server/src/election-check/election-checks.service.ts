import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  Collections,
  ELECTION_CHECK_STATES,
  ELECTION_CHECK_TIMEOUT_MINUTES,
  electionCheckChanges,
  isUuidV7,
  MAX_ELECTION_CHECKS_PER_DAY,
  publicElectionCheck,
  uuidv7,
  type ElectionCheckRecord,
  type ElectionCheckState,
  type ElectionCheckView,
  type ElectionState,
  type PublicElectionCheck,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { AnthropicKey, NO_KEY_REASON } from '../claude-checks/anthropic-key.js';
import { assertRequesterLimits, unfinished } from '../claude-checks/requester-limits.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';
import { ElectionCheckMaterials } from './election-check-material.js';

const checkable = (state: ElectionState) => (ELECTION_CHECK_STATES as readonly ElectionState[]).includes(state);

/**
 * The advisory election setup check (design §6.9). An Election Admin or Auditor asks for it; the api only queues it,
 * since a review can outlast Firebase Hosting's 60-second limit, and the worker runs it. It runs once per version of the
 * election: a request is refused while one is running, or when the last finished check already covers the election,
 * bylaws and offices as they stand. Once the election is past draft, every user sees the check of its frozen
 * definition beside the contests.
 */
@Injectable()
export class ElectionChecksService {
  constructor(
    private readonly firebase: Firebase,
    private readonly reader: ElectionReader,
    private readonly materials: ElectionCheckMaterials,
    private readonly key: AnthropicKey,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async request(ctx: RequestContext, electionId: string): Promise<ElectionCheckView> {
    const actor = requireAccount(ctx);
    await this.assertEnabled();
    const { election, basis } = await this.materials.load(electionId);
    if (!checkable(election.state)) throw new ConflictException(`the election is ${election.state}; its setup can be checked until voting closes`);
    if (!basis) throw new ConflictException('no bylaws are in force, so there is nothing to check against');

    const now = new Date();
    const recent = await this.recent(electionId);
    const stale = new Date(now.getTime() - ELECTION_CHECK_TIMEOUT_MINUTES * 60_000).toISOString();
    if (recent.some((c) => unfinished(c, stale))) throw new ConflictException('this election is already being checked; wait for the result');
    const last = recent.find((c) => c.status === 'done');
    if (last && electionCheckChanges(last.basis, basis).length === 0) {
      throw new ConflictException('already checked: nothing in the election, the bylaws or its offices has changed since the last check');
    }
    await assertRequesterLimits(
      this.checks(),
      actor,
      { what: 'election setup checks', perDay: MAX_ELECTION_CHECKS_PER_DAY, timeoutMinutes: ELECTION_CHECK_TIMEOUT_MINUTES },
      now,
    );

    const record: ElectionCheckRecord = {
      checkId: uuidv7(),
      electionId,
      status: 'queued',
      requestedBy: actor,
      requestedAt: now.toISOString(),
      startedAt: null,
      finishedAt: null,
      checker: null,
      model: null,
      basis: null,
      findings: [],
      quotedLines: [],
      summary: null,
      error: null,
      usage: null,
    };
    await this.checks().doc(record.checkId).create(record);
    return { ...record, changedSince: [] };
  }

  /** Whether the check can be asked for (switched on and, for Claude, a key added), and the latest, finished or not. */
  async state(electionId: string): Promise<ElectionCheckState> {
    if (!(await this.reader.find(electionId))) throw new NotFoundException('no such election');
    const [enabled, [latest]] = await Promise.all([this.key.ready(this.config.electionChecker), this.recent(electionId, 1)]);
    return { enabled, check: latest ? await this.view(latest) : null };
  }

  async get(electionId: string, checkId: string): Promise<ElectionCheckView> {
    const record = isUuidV7(checkId) ? ((await this.checks().doc(checkId).get()).data() as ElectionCheckRecord | undefined) : undefined;
    if (!record || record.electionId !== electionId) throw new NotFoundException(`no election setup check ${checkId}`);
    return this.view(record);
  }

  /**
   * Public, once the election is past draft: the latest finished check of the definition as scheduling froze it. A check
   * of an earlier draft is never shown to voters.
   */
  async published(electionId: string): Promise<PublicElectionCheck> {
    const election = await this.reader.find(electionId);
    if (!election || election.state === 'draft') throw new NotFoundException('no such election');
    const check = (await this.recent(electionId)).find((c) => c.status === 'done' && c.basis?.definitionHash === election.definitionHash);
    if (!check) throw new NotFoundException('this election’s setup has not been checked against the bylaws');
    return publicElectionCheck(check);
  }

  private async assertEnabled(): Promise<void> {
    if (this.config.electionChecker === 'off') throw new ServiceUnavailableException('the election setup check is not set up on this server');
    if (!(await this.key.ready(this.config.electionChecker))) {
      throw new ServiceUnavailableException(`the election setup check cannot run yet: ${NO_KEY_REASON}`);
    }
  }

  /** A finished check, with what has changed since it ran. */
  private async view(record: ElectionCheckRecord): Promise<ElectionCheckView> {
    if (record.status !== 'done' || !record.basis) return { ...record, changedSince: [] };
    const { basis } = await this.materials.load(record.electionId);
    return { ...record, changedSince: basis ? electionCheckChanges(record.basis, basis) : ['bylaws'] };
  }

  /** The election's checks, newest first. */
  private async recent(electionId: string, limit = 20): Promise<ElectionCheckRecord[]> {
    const snap = await this.checks().where('electionId', '==', electionId).orderBy('requestedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as ElectionCheckRecord);
  }

  private checks() {
    return this.firebase.db.collection(Collections.electionChecks);
  }
}
