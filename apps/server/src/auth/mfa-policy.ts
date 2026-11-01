import { Body, ConflictException, Controller, Get, Injectable, Put } from '@nestjs/common';
import {
  Collections,
  DEFAULT_MFA_POLICY,
  mfaPolicySchema,
  type MfaPolicyChangedPayload,
  type MfaPolicyInput,
  type MfaPolicyRecord,
} from 'ustp-domain';
import { ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { Ctx, requireAccount, Roles } from './decorators.js';
import type { RequestContext } from './principal.js';

const CACHE_MS = 60_000;
const DOC_ID = 'current';

function record(data: Partial<MfaPolicyRecord> | undefined): MfaPolicyRecord {
  return {
    membersRequired: data?.membersRequired ?? DEFAULT_MFA_POLICY.membersRequired,
    version: data?.version ?? 0,
    updatedAt: data?.updatedAt ?? null,
    updatedBy: data?.updatedBy ?? null,
  };
}

/**
 * Whether members without an admin role must sign in with a second factor (design §4). The AuthGuard reads it on every
 * request without one, so it is cached for a minute, as the sign-in switches are; another api instance picks up a
 * change within that minute.
 */
@Injectable()
export class MfaPolicyService {
  private cache: { at: number; record: MfaPolicyRecord } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.mfaPolicy).doc(DOC_ID);
  }

  async current(): Promise<MfaPolicyRecord> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.record;
    const current = record((await this.doc.get()).data() as MfaPolicyRecord | undefined);
    this.cache = { at: Date.now(), record: current };
    return current;
  }

  /** Switches the member requirement if nobody saved since `basedOn`, and ledgers who did it. Saving no change writes nothing. */
  async update(ctx: RequestContext, input: MfaPolicyInput): Promise<MfaPolicyRecord> {
    const actor = requireAccount(ctx);
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as MfaPolicyRecord | undefined);
      if (input.basedOn !== before.version) {
        throw new ConflictException('someone else changed the two-step setting since you opened it; reload to see their change');
      }
      if (input.membersRequired === before.membersRequired) return before;
      const next: MfaPolicyRecord = {
        membersRequired: input.membersRequired,
        version: before.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      };
      const payload: MfaPolicyChangedPayload = { version: next.version, membersRequired: next.membersRequired };
      await this.ledger.record(tx, [{ type: 'mfa_policy.changed', actor, subject: null, payload: { ...payload } }]);
      tx.set(this.doc, next);
      return next;
    });
    this.cache = { at: Date.now(), record: saved };
    return saved;
  }

  invalidate(): void {
    this.cache = null;
  }
}

/** System Admins switch the member requirement on and off (design §4); System Admins themselves always need it. */
@Controller('v1/admin/mfa-policy')
@Roles('system_admin')
export class MfaPolicyController {
  constructor(private readonly policy: MfaPolicyService) {}

  @Get()
  current() {
    return this.policy.current();
  }

  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(mfaPolicySchema)) body: MfaPolicyInput) {
    return this.policy.update(ctx, body);
  }
}
