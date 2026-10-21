import { Body, ConflictException, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  Collections,
  decisionSchema,
  roleChangeSchema,
  ROLES,
  SIGN_IN_PROVIDERS,
  signInMethodsSchema,
  type DecisionInput,
  type RoleChangeInput,
  type SignInMethodRecord,
  type SignInMethodsInput,
} from 'ustp-domain';
import { z } from 'zod';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { SignInMethodsService } from '../auth/sign-in-methods.service.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ApprovalsService } from './approvals.service.js';

/** Role changes and two-person decisions (design §10). */
@Controller('v1/admin')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Post('roles')
  @Roles('system_admin')
  requestRoleChange(@Ctx() ctx: RequestContext, @Body(new ZodPipe(roleChangeSchema)) body: RoleChangeInput) {
    return this.approvals.requestRoleChange(ctx, body);
  }

  /** Any admin may look; whether they may decide is checked per request. */
  @Get('approvals')
  @Roles(...ROLES)
  list(@Query('status') status?: string) {
    return this.approvals.list(parseQuery(z.enum(['pending', 'rejected', 'executed']).default('pending'), status, 'status'));
  }

  @Post('approvals/:id/decision')
  @Roles(...ROLES)
  decide(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput) {
    return this.approvals.decide(ctx, id, body);
  }
}

/** The admin "auth switches" (design §4). */
@Controller('v1/admin/sign-in-methods')
@Roles('system_admin')
export class SignInMethodsController {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly signInMethods: SignInMethodsService,
  ) {}

  @Get()
  current() {
    return this.signInMethods.current();
  }

  @Put()
  async update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(signInMethodsSchema)) body: SignInMethodsInput) {
    const actor = requireAccount(ctx);
    const db = this.firebase.db;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.collection(Collections.signInMethods));
      const enabled = Object.fromEntries(SIGN_IN_PROVIDERS.map((p) => [p, true])) as Record<string, boolean>;
      for (const doc of snap.docs) enabled[doc.id] = (doc.data() as SignInMethodRecord).enabled;
      const changes = Object.fromEntries(Object.entries(body).filter(([p, on]) => on !== undefined && enabled[p] !== on));
      if (Object.keys(changes).length === 0) return;
      if (SIGN_IN_PROVIDERS.every((p) => (changes[p] ?? enabled[p]) === false)) {
        throw new ConflictException('at least one sign-in method must stay enabled');
      }
      if (changes[ctx.principal.provider] === false) {
        throw new ConflictException('you cannot disable the sign-in method you are using; sign in another way first');
      }
      await this.ledger.record(tx, [{ type: 'signin_method.changed', actor, subject: null, payload: { changes } }]);
      const updatedAt = new Date().toISOString();
      for (const [provider, on] of Object.entries(changes)) {
        const record = { provider, enabled: on, updatedAt, updatedBy: actor } as SignInMethodRecord;
        tx.set(db.collection(Collections.signInMethods).doc(provider), record);
      }
    });
    this.signInMethods.invalidate();
    return this.signInMethods.current();
  }
}

/** Ledger access for Auditors (design §8.2). */
@Controller('v1/admin/audit')
@Roles('auditor')
export class AuditController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('events')
  events(@Query('after') after?: string, @Query('limit') limit?: string) {
    return this.ledger.list(
      parseQuery(z.coerce.number().int().min(0).default(0), after, 'after'),
      parseQuery(z.coerce.number().int().min(1).max(500).default(100), limit, 'limit'),
    );
  }

  @Get('verify')
  verify() {
    return this.ledger.verify();
  }
}
