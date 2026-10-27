import { Body, ConflictException, Controller, Get, Injectable, Put } from '@nestjs/common';
import {
  checkNavigationSettings,
  Collections,
  navigationChanges,
  navigationSettingsSchema,
  resolveNavigation,
  type NavigationChangedPayload,
  type NavigationRecord,
  type NavigationSettingsInput,
  type PublicNavigation,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

const CACHE_MS = 60_000;
const DOC_ID = 'current';

function record(data: Partial<NavigationRecord> | undefined): NavigationRecord {
  return { ...resolveNavigation(data), version: data?.version ?? 0, updatedAt: data?.updatedAt ?? null, updatedBy: data?.updatedBy ?? null };
}

/**
 * What the web app shows each membership state and role (design §10.5). Read on every page load, so cached briefly,
 * as the sign-in switches are; another api instance picks up a change within a minute.
 */
@Injectable()
export class NavigationService {
  private cache: { at: number; record: NavigationRecord } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.navigation).doc(DOC_ID);
  }

  async current(): Promise<NavigationRecord> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.record;
    const snap = await this.doc.get();
    const current = record(snap.data() as NavigationRecord | undefined);
    this.cache = { at: Date.now(), record: current };
    return current;
  }

  /**
   * Saves the whole matrix if nobody saved since `basedOn`, ledgering every cell that changed. Locked cells are refused
   * when switched; a role's Admin link is recomputed from its sections.
   */
  async update(ctx: RequestContext, input: NavigationSettingsInput): Promise<NavigationRecord> {
    const actor = requireAccount(ctx);
    const { basedOn, ...settings } = input;
    assertCheck(checkNavigationSettings(settings));
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as NavigationRecord | undefined);
      if (basedOn !== before.version) {
        throw new ConflictException('someone else changed these settings since you opened them; reload to see their changes');
      }
      const after = resolveNavigation(settings);
      const changes = navigationChanges(before, after);
      if (changes.length === 0) return before;
      const next: NavigationRecord = { ...after, version: before.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
      const payload: NavigationChangedPayload = { version: next.version, changes };
      await this.ledger.record(tx, [{ type: 'navigation.changed', actor, subject: null, payload: { ...payload } }]);
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

/** The settings every visitor's web app follows: no sign-in, and without who changed them. */
@Controller('v1/navigation')
export class PublicNavigationController {
  constructor(private readonly navigation: NavigationService) {}

  @Public()
  @Get()
  async current(): Promise<PublicNavigation> {
    const { updatedAt: _at, updatedBy: _by, ...settings } = await this.navigation.current();
    return settings;
  }
}

/** System Admins edit who sees which link (design §10.5). */
@Controller('v1/admin/navigation')
@Roles('system_admin')
export class NavigationAdminController {
  constructor(private readonly navigation: NavigationService) {}

  @Get()
  current() {
    return this.navigation.current();
  }

  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(navigationSettingsSchema)) body: NavigationSettingsInput) {
    return this.navigation.update(ctx, body);
  }
}
