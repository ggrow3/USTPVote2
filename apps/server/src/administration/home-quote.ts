import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Put } from '@nestjs/common';
import {
  checkHomeQuote,
  Collections,
  homeQuoteChanges,
  homeQuoteSchema,
  resolveHomeQuote,
  type HomeQuoteChangedPayload,
  type HomeQuoteInput,
  type HomeQuoteRecord,
  type PublicHomeQuote,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

const CACHE_MS = 60_000;
const DOC_ID = 'current';

function record(data: Partial<HomeQuoteRecord> | undefined): HomeQuoteRecord {
  return { ...resolveHomeQuote(data), version: data?.version ?? 0, updatedAt: data?.updatedAt ?? null, updatedBy: data?.updatedBy ?? null };
}

/**
 * The quote on the home page (design §10.5). Read by every visit to the home page, so cached briefly, as the
 * navigation settings are; another api instance picks up a change within a minute.
 */
@Injectable()
export class HomeQuoteService {
  private cache: { at: number; record: HomeQuoteRecord } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.homeQuote).doc(DOC_ID);
  }

  async current(): Promise<HomeQuoteRecord> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.record;
    const snap = await this.doc.get();
    const current = record(snap.data() as HomeQuoteRecord | undefined);
    this.cache = { at: Date.now(), record: current };
    return current;
  }

  /**
   * Saves the quote, tidied, if nobody saved since `basedOn`, ledgering every part that changed. A quote that is shown
   * needs its words and who said them (400).
   */
  async update(ctx: RequestContext, input: HomeQuoteInput): Promise<HomeQuoteRecord> {
    const actor = requireAccount(ctx);
    const { basedOn, ...quote } = input;
    const after = resolveHomeQuote(quote);
    assertCheck(checkHomeQuote(after), BadRequestException);
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as HomeQuoteRecord | undefined);
      if (basedOn !== before.version) {
        throw new ConflictException('someone else changed the quote since you opened it; reload to see their change');
      }
      const changes = homeQuoteChanges(before, after);
      if (changes.length === 0) return before;
      const next: HomeQuoteRecord = { ...after, version: before.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
      const payload: HomeQuoteChangedPayload = { version: next.version, changes };
      await this.ledger.record(tx, [{ type: 'home_quote.changed', actor, subject: null, payload: { ...payload } }]);
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

/** The quote every visitor's home page shows: no sign-in, and without who changed it. */
@Controller('v1/home-quote')
export class PublicHomeQuoteController {
  constructor(private readonly quote: HomeQuoteService) {}

  @Public()
  @Get()
  async current(): Promise<PublicHomeQuote> {
    const { updatedAt: _at, updatedBy: _by, ...quote } = await this.quote.current();
    return quote;
  }
}

/** System Admins change the home page quote or switch it off (design §10.5). */
@Controller('v1/admin/home-quote')
@Roles('system_admin')
export class HomeQuoteAdminController {
  constructor(private readonly quote: HomeQuoteService) {}

  @Get()
  current() {
    return this.quote.current();
  }

  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(homeQuoteSchema)) body: HomeQuoteInput) {
    return this.quote.update(ctx, body);
  }
}
