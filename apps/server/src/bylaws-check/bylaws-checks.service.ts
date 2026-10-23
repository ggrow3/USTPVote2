import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sha256Hex } from 'ustp-audit';
import {
  BYLAWS_CHECK_TIMEOUT_MINUTES,
  Collections,
  diffLines,
  isUuidV7,
  MAX_BYLAWS_CHECKS_PER_DAY,
  splitLines,
  uuidv7,
  type BylawsCheckRecord,
  type BylawsCheckView,
  type BylawsRecord,
  type RequestBylawsCheckInput,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';

/**
 * Requests for the advisory bylaws check (design §5.2). The api only queues them: a review can take longer than Firebase
 * Hosting's 60-second limit on an api request, so the worker runs it and the browser polls for the result.
 */
@Injectable()
export class BylawsChecksService {
  constructor(
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async request(ctx: RequestContext, input: RequestBylawsCheckInput): Promise<BylawsCheckView> {
    const actor = requireAccount(ctx);
    if (this.config.bylawsChecker === 'off') throw new ServiceUnavailableException('the bylaws check is not set up on this server');
    const db = this.firebase.db;
    const amends = input.amends ?? null;
    let focusLines: number[] | null = null;
    if (input.scope === 'changes') {
      if (!amends) throw new BadRequestException('a first version has no changes to check; check the whole draft');
      const base = (await db.collection(Collections.bylawsVersions).doc(amends).get()).data() as BylawsRecord | undefined;
      if (!base) throw new NotFoundException(`no bylaws version ${amends}`);
      focusLines = diffLines(base.text, input.text).flatMap((l) => (l.kind === 'added' ? [l.after!] : []));
      if (!focusLines.length) throw new BadRequestException(`nothing has changed since version ${amends}; check the whole draft`);
    }

    const now = new Date();
    const recent = await db
      .collection(Collections.bylawsChecks)
      .where('requestedBy', '==', actor)
      .where('requestedAt', '>=', new Date(now.getTime() - 86_400_000).toISOString())
      .get();
    const stale = new Date(now.getTime() - BYLAWS_CHECK_TIMEOUT_MINUTES * 60_000).toISOString();
    const pending = recent.docs
      .map((d) => d.data() as BylawsCheckRecord)
      .some((c) => (c.status === 'queued' || c.status === 'running') && c.requestedAt >= stale);
    if (pending) throw new ConflictException('your previous check has not finished yet; wait for it, then try again');
    if (recent.size >= MAX_BYLAWS_CHECKS_PER_DAY) {
      throw new HttpException(`at most ${MAX_BYLAWS_CHECKS_PER_DAY} bylaws checks in 24 hours; try again later`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const record: BylawsCheckRecord = {
      checkId: uuidv7(),
      status: 'queued',
      scope: input.scope,
      title: input.title,
      amends,
      text: input.text,
      textHash: sha256Hex(input.text),
      lineCount: splitLines(input.text).length,
      focusLines,
      requestedBy: actor,
      requestedAt: now.toISOString(),
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
    await db.collection(Collections.bylawsChecks).doc(record.checkId).create(record);
    return view(record);
  }

  async get(checkId: string): Promise<BylawsCheckView> {
    const snap = isUuidV7(checkId) ? await this.firebase.db.collection(Collections.bylawsChecks).doc(checkId).get() : null;
    const record = snap?.data() as BylawsCheckRecord | undefined;
    if (!record) throw new NotFoundException(`no bylaws check ${checkId}`);
    return view(record);
  }
}

export function view({ text: _, ...rest }: BylawsCheckRecord): BylawsCheckView {
  return rest;
}
