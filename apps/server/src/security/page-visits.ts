import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  clientAddress,
  Collections,
  PAGE_VISIT_LOG_MAX,
  PAGE_VISIT_PERIODS,
  PAGE_VISIT_RATE,
  PAGE_VISIT_RETENTION_DAYS,
  pageVisitReport,
  pageVisitSchema,
  periodDays,
  trackedPage,
  uuidv7,
  visitDay,
  type AccountRecord,
  type PageHitsRecord,
  type PageVisitInput,
  type PageVisitRecord,
  type PageVisitReport,
} from 'ustp-domain';
import { Ctx, MfaExempt, Public, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';

const DAY_MS = 86_400_000;
/** Accounts read in one `getAll` when naming the report's visitors. */
const NAMES_BATCH = 300;

type Stored = PageVisitRecord & { readonly expireAt: Timestamp };

/**
 * How many visits each account or address has made in the current minute, on this api instance (design §10.7). Kept
 * in memory only, never stored, and forgotten as each minute starts.
 */
export class VisitRateLimiter {
  private window = -1;
  private readonly counts = new Map<string, number>();

  constructor(private readonly rate: { readonly visits: number; readonly windowMs: number } = PAGE_VISIT_RATE) {}

  /** Takes one visit for `key`: false once it has had its share of this minute. */
  take(key: string, now: number = Date.now()): boolean {
    const window = Math.floor(now / this.rate.windowMs);
    if (window !== this.window) {
      this.window = window;
      this.counts.clear();
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.rate.visits;
  }

  forget(): void {
    this.counts.clear();
  }
}

/**
 * Page visits (design §10.7): each page opened is counted per page and UTC day, for good and without who; a visit by
 * someone signed in to an account is also recorded with the account and expires after PAGE_VISIT_RETENTION_DAYS (a
 * Firestore TTL policy on `expireAt`). The ballot and the receipt check are never tracked. Personal data, so visits
 * stay out of the ledger.
 */
@Injectable()
export class PageVisitsService {
  private readonly limiter = new VisitRateLimiter();

  constructor(
    private readonly firebase: Firebase,
    private readonly members: MemberDirectory,
  ) {}

  /** One more visit from `key` (an account or an address) this minute, or 429. */
  limit(key: string): void {
    if (!this.limiter.take(key)) throw new HttpException('too many page visits; slow down', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Counts a visit to the page at `path`, and records it with `accountId` when there is one. 404 for an untracked path. */
  async record(path: string, accountId: string | null, now: Date = new Date()): Promise<void> {
    const tracked = trackedPage(path);
    if (!tracked) throw new NotFoundException('no tracked page at that path');
    const db = this.firebase.db;
    const day = visitDay(now);
    const batch = db.batch();
    batch.set(
      db.collection(Collections.pageHits).doc(tracked.page.id),
      {
        total: FieldValue.increment(1),
        days: { [day]: FieldValue.increment(1) },
        ...(accountId ? { signedIn: { [day]: FieldValue.increment(1) } } : {}),
      },
      { merge: true },
    );
    if (accountId) {
      const visit: Stored = {
        accountId,
        page: tracked.page.id,
        path: tracked.path,
        at: now.toISOString(),
        expireAt: Timestamp.fromMillis(now.getTime() + PAGE_VISIT_RETENTION_DAYS * DAY_MS),
      };
      batch.create(db.collection(Collections.pageVisits).doc(uuidv7(now.getTime())), visit);
    }
    await batch.commit();
  }

  /** Hits per page over the last `days` UTC days, and who opened each page, by name. */
  async report(days: number, now: Date = new Date()): Promise<PageVisitReport> {
    const db = this.firebase.db;
    const today = visitDay(now);
    const from = `${periodDays(today, days)[0]!}T00:00:00.000Z`;
    const [hitsSnap, visitsSnap] = await Promise.all([
      db.collection(Collections.pageHits).get(),
      db.collection(Collections.pageVisits).where('at', '>=', from).orderBy('at', 'desc').limit(PAGE_VISIT_LOG_MAX + 1).get(),
    ]);
    const visits = visitsSnap.docs.slice(0, PAGE_VISIT_LOG_MAX).map((doc) => {
      const { expireAt: _expires, ...visit } = doc.data() as Stored;
      return visit;
    });
    return pageVisitReport({
      days,
      today,
      hits: new Map(hitsSnap.docs.map((d) => [d.id, d.data() as Partial<PageHitsRecord>])),
      visits,
      people: await this.people([...new Set(visits.map((v) => v.accountId))]),
      truncated: visitsSnap.size > PAGE_VISIT_LOG_MAX,
    });
  }

  /**
   * Each account's name and email, for the report: a member by the name they go by, else their legal name; anyone
   * else (staff without a membership) by their account's display name.
   */
  private async people(accountIds: readonly string[]): Promise<Map<string, { name: string | null; email: string | null }>> {
    const db = this.firebase.db;
    const found = new Map<string, { name: string | null; email: string | null }>();
    for (let i = 0; i < accountIds.length; i += NAMES_BATCH) {
      const ids = accountIds.slice(i, i + NAMES_BATCH);
      const [accounts, members] = await Promise.all([
        db.getAll(...ids.map((id) => db.collection(Collections.accounts).doc(id))),
        this.members.findMany(ids),
      ]);
      ids.forEach((id, j) => {
        const account = accounts[j]!.data() as AccountRecord | undefined;
        const member = members[j];
        const name = member?.preferredName || member?.legalName || account?.displayName || null;
        if (account || member) found.set(id, { name, email: account?.primaryEmail || null });
      });
    }
    return found;
  }

  /** Forgets this instance's rate counts (tests). */
  forget(): void {
    this.limiter.forget();
  }
}

/**
 * A signed-in person opened a page: counted, and recorded with their account (design §10.7). A System Admin acting as
 * a test persona is recorded as themself. A login with no account yet (the first step of Register) is only counted.
 * It records only the caller's own visit and answers nothing, so it needs no second factor where one is required
 * (design §4): visits while someone sets one up still count.
 */
@Controller('v1/page-visits')
export class PageVisitsController {
  constructor(private readonly visits: PageVisitsService) {}

  @Post()
  @HttpCode(204)
  @MfaExempt()
  async visit(@Ctx() ctx: RequestContext, @Body(new ZodPipe(pageVisitSchema)) body: PageVisitInput): Promise<void> {
    const accountId = ctx.operator ?? ctx.accountId;
    this.visits.limit(accountId ? `account:${accountId}` : `login:${ctx.principal.uid}`);
    await this.visits.record(body.path, accountId);
  }
}

/**
 * Someone signed out opened a page: counted only. Like the hub's click counts it needs no App Check token, so public
 * pages never wait for reCAPTCHA (design §15); their address limits how often, and is never stored.
 */
@Controller('v1/public/page-visits')
export class PublicPageVisitsController {
  constructor(
    private readonly visits: PageVisitsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  @Public()
  @Post()
  @HttpCode(204)
  async visit(@Body(new ZodPipe(pageVisitSchema)) body: PageVisitInput, @Req() request: FastifyRequest): Promise<void> {
    const { ip } = clientAddress(request.headers['x-forwarded-for'], request.socket?.remoteAddress, this.config.trustedProxyHops);
    this.visits.limit(`address:${ip ?? 'unknown'}`);
    await this.visits.record(body.path, null);
  }
}

/** System Admins and Auditors read the page-visits report, as they read the sign-in log (design §10.7). */
@Controller('v1/admin/page-visits')
export class PageVisitsAdminController {
  constructor(private readonly visits: PageVisitsService) {}

  @Get()
  @Roles('system_admin', 'site_admin', 'auditor')
  report(@Query('days') days?: string): Promise<PageVisitReport> {
    const n = Number(days);
    return this.visits.report((PAGE_VISIT_PERIODS as readonly number[]).includes(n) ? n : 30);
  }
}
