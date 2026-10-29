import { Body, ConflictException, Controller, Get, Injectable, Put } from '@nestjs/common';
import {
  Collections,
  DEFAULT_SITE_ANALYTICS,
  siteAnalyticsSchema,
  type PublicSiteAnalytics,
  type SiteAnalyticsChangedPayload,
  type SiteAnalyticsInput,
  type SiteAnalyticsRecord,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

const CACHE_MS = 60_000;
const DOC_ID = 'current';

function record(data: Partial<SiteAnalyticsRecord> | undefined): SiteAnalyticsRecord {
  return {
    measurementId: data?.measurementId ?? DEFAULT_SITE_ANALYTICS.measurementId,
    version: data?.version ?? 0,
    updatedAt: data?.updatedAt ?? null,
    updatedBy: data?.updatedBy ?? null,
  };
}

/**
 * The site's Google Analytics measurement ID (design §10.7), off until a System Admin sets one. Every page load reads
 * it, so it is cached briefly, as the home page quote is.
 */
@Injectable()
export class SiteAnalyticsService {
  private cache: { at: number; record: SiteAnalyticsRecord } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.siteAnalytics).doc(DOC_ID);
  }

  async current(): Promise<SiteAnalyticsRecord> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.record;
    const current = record((await this.doc.get()).data() as SiteAnalyticsRecord | undefined);
    this.cache = { at: Date.now(), record: current };
    return current;
  }

  /** Saves the measurement ID (null switches analytics off) if nobody saved since `basedOn`, and ledgers the change. */
  async update(ctx: RequestContext, input: SiteAnalyticsInput): Promise<SiteAnalyticsRecord> {
    const actor = requireAccount(ctx);
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as SiteAnalyticsRecord | undefined);
      if (input.basedOn !== before.version) {
        throw new ConflictException('someone else changed the analytics setting since you opened it; reload to see their change');
      }
      if (input.measurementId === before.measurementId) return before;
      const next: SiteAnalyticsRecord = {
        measurementId: input.measurementId,
        version: before.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      };
      const payload: SiteAnalyticsChangedPayload = { version: next.version, measurementId: next.measurementId };
      await this.ledger.record(tx, [{ type: 'analytics.changed', actor, subject: null, payload: { ...payload } }]);
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

/** What every page needs to load Google Analytics: no sign-in, and without who changed it. */
@Controller('v1/site-analytics')
export class PublicSiteAnalyticsController {
  constructor(private readonly analytics: SiteAnalyticsService) {}

  @Public()
  @Get()
  async current(): Promise<PublicSiteAnalytics> {
    const { measurementId, version } = await this.analytics.current();
    return { measurementId, version };
  }
}

/** System Admins set or clear the site's Google Analytics measurement ID (design §10.7). */
@Controller('v1/admin/site-analytics')
@Roles('system_admin')
export class SiteAnalyticsAdminController {
  constructor(private readonly analytics: SiteAnalyticsService) {}

  @Get()
  current() {
    return this.analytics.current();
  }

  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(siteAnalyticsSchema)) body: SiteAnalyticsInput) {
    return this.analytics.update(ctx, body);
  }
}
