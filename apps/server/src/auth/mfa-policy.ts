import { Body, ConflictException, Controller, Get, Injectable, Put } from '@nestjs/common';
import {
  ADMIN_SIGN_IN_PROVIDER,
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
import { SignInMethodsService } from './sign-in-methods.service.js';

const CACHE_MS = 60_000;
const DOC_ID = 'current';

function record(data: Partial<MfaPolicyRecord> | undefined): MfaPolicyRecord {
  return {
    membersRequired: data?.membersRequired ?? DEFAULT_MFA_POLICY.membersRequired,
    siteAdminsRequired: data?.siteAdminsRequired ?? DEFAULT_MFA_POLICY.siteAdminsRequired,
    adminsGoogleRequired: data?.adminsGoogleRequired ?? false,
    version: data?.version ?? 0,
    updatedAt: data?.updatedAt ?? null,
    updatedBy: data?.updatedBy ?? null,
  };
}

/**
 * Whether members without an admin role, and whether Site Admins, must sign in with a second factor, and whether
 * System and Site Admins must sign in with Google (design §4). The
 * AuthGuard reads it on every request without one, so it is cached for a minute, as the sign-in switches are; another api instance picks up a
 * change within that minute.
 */
@Injectable()
export class MfaPolicyService {
  private cache: { at: number; record: MfaPolicyRecord } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly signInMethods: SignInMethodsService,
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

  /**
   * Switches the requirements if nobody saved since `basedOn`, and ledgers who did it. Saving no change writes nothing.
   * Google sign-in is required of admins only by a System Admin signed in with Google themselves, while Google sign-in
   * is switched on: otherwise turning it on could shut every System Admin out, this setting included.
   */
  async update(ctx: RequestContext, input: MfaPolicyInput): Promise<MfaPolicyRecord> {
    const actor = requireAccount(ctx);
    const googleOn = await this.signInMethods.isEnabled(ADMIN_SIGN_IN_PROVIDER);
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as MfaPolicyRecord | undefined);
      if (input.basedOn !== before.version) {
        throw new ConflictException('someone else changed the two-step setting since you opened it; reload to see their change');
      }
      const siteAdminsRequired = input.siteAdminsRequired ?? before.siteAdminsRequired;
      const adminsGoogleRequired = input.adminsGoogleRequired ?? before.adminsGoogleRequired ?? false;
      if (
        input.membersRequired === before.membersRequired &&
        siteAdminsRequired === before.siteAdminsRequired &&
        adminsGoogleRequired === (before.adminsGoogleRequired ?? false)
      ) {
        return before;
      }
      if (adminsGoogleRequired && !before.adminsGoogleRequired) {
        if (!googleOn) throw new ConflictException('Sign in with Google is switched off; switch it on before requiring it of admins');
        if (ctx.principal.provider !== ADMIN_SIGN_IN_PROVIDER) {
          throw new ConflictException('sign in with Google yourself before requiring it of System and Site Admins');
        }
      }
      const next: MfaPolicyRecord = {
        membersRequired: input.membersRequired,
        siteAdminsRequired,
        adminsGoogleRequired,
        version: before.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      };
      const payload: MfaPolicyChangedPayload = { version: next.version, membersRequired: next.membersRequired, siteAdminsRequired, adminsGoogleRequired };
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

/** System Admins switch the member and Site Admin requirements on and off (design §4); System Admins themselves always need it. */
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
