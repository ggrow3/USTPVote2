import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Put } from '@nestjs/common';
import {
  checkFirstSteps,
  checkFirstStepTick,
  firstStepsDiffer,
  firstStepsSettingsSchema,
  nextFirstStepTicks,
  tidyFirstStep,
  type FirstStepsChangedPayload,
  type FirstStepsRecord,
  type FirstStepsSettings,
  type FirstStepsSettingsInput,
  type FirstStepsView,
  type MemberRecord,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { FirstStepsReader } from './first-steps.js';
import { FirstStepsRepository } from './first-steps.repository.js';

/**
 * The getting started list (design §5.16): Membership Admins set its steps, and a member ticks the steps the site
 * cannot check. Not cached: one small document, read when a member opens the voting home.
 */
@Injectable()
export class FirstStepsSettingsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly list: FirstStepsRepository,
    private readonly reader: FirstStepsReader,
  ) {}

  current(): Promise<FirstStepsRecord> {
    return this.list.settings();
  }

  /**
   * Saves the steps, tidied, if nobody saved since `basedOn` (409 otherwise), ledgering the whole new list as
   * `first_steps.changed`. Steps that break a rule (`checkFirstSteps`) are refused (400); saving the same list changes
   * nothing.
   */
  async update(ctx: RequestContext, input: FirstStepsSettingsInput): Promise<FirstStepsRecord> {
    const actor = requireAccount(ctx);
    const after: FirstStepsSettings = { steps: input.steps.map(tidyFirstStep) };
    assertCheck(checkFirstSteps(after), BadRequestException);
    return this.firebase.db.runTransaction(async (tx) => {
      const before = await this.list.settings(tx);
      if (input.basedOn !== before.version) {
        throw new ConflictException('someone else changed the getting started list since you opened it; reload to see their change');
      }
      if (!firstStepsDiffer(before, after)) return before;
      const next: FirstStepsRecord = { steps: after.steps, version: before.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
      const payload: FirstStepsChangedPayload = { version: next.version, steps: next.steps };
      await this.ledger.record(tx, [{ type: 'first_steps.changed', actor, subject: null, payload: { ...payload } }]);
      this.list.setSettings(tx, next);
      return next;
    });
  }

  /**
   * An Active member ticks (`done`) or unticks a step they tick themselves (403 for anyone else; 404 for a step not on
   * the list; 409 for a step the site ticks), and gets their list back. Not ledgered: it is the member's own note.
   */
  async tick(accountId: string, member: MemberRecord | null, id: string, done: boolean): Promise<FirstStepsView> {
    if (member?.status !== 'active') throw new ForbiddenException('only Active members have a getting started list');
    await this.firebase.db.runTransaction(async (tx) => {
      const settings = await this.list.settings(tx);
      assertCheck(checkFirstStepTick(settings, id));
      const ticked = await this.list.ticks(accountId, tx);
      this.list.setTicks(tx, accountId, nextFirstStepTicks(settings, ticked, id, done));
    });
    return this.reader.mine(accountId, member);
  }
}

/** Membership Admins set the getting started list new members see (design §5.16). */
@Controller('v1/admin/first-steps')
@Roles('membership_admin')
export class FirstStepsAdminController {
  constructor(private readonly steps: FirstStepsSettingsService) {}

  @Get()
  current(): Promise<FirstStepsRecord> {
    return this.steps.current();
  }

  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(firstStepsSettingsSchema)) body: FirstStepsSettingsInput): Promise<FirstStepsRecord> {
    return this.steps.update(ctx, body);
  }
}
