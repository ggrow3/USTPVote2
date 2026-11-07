import { Body, ConflictException, Controller, Get, Injectable, Put } from '@nestjs/common';
import {
  Collections,
  noticeSettingsChanges,
  noticeSettingsSchema,
  resolveNoticeSettings,
  type NoticeSettingsChangedPayload,
  type NoticeSettingsInput,
  type NoticeSettingsRecord,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

const CACHE_MS = 60_000;
const DOC_ID = 'current';

function record(data: Partial<NoticeSettingsRecord> | undefined): NoticeSettingsRecord {
  return { ...resolveNoticeSettings(data), version: data?.version ?? 0, updatedAt: data?.updatedAt ?? null, updatedBy: data?.updatedBy ?? null };
}

/**
 * What System Admins set about the election emails (design §6.8): each email on or off, the reminder's lead time, the
 * contact line and the wording. The worker reads them every tick and the editor with each election's counts, so they
 * are cached briefly; another instance picks up a change within a minute.
 */
@Injectable()
export class NoticeSettingsService {
  private cache: { at: number; record: NoticeSettingsRecord } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.noticeSettings).doc(DOC_ID);
  }

  async current(): Promise<NoticeSettingsRecord> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.record;
    const current = record((await this.doc.get()).data() as NoticeSettingsRecord | undefined);
    this.cache = { at: Date.now(), record: current };
    return current;
  }

  /** Saves the settings if nobody saved since `basedOn`, ledgering every one that changed with its old and new value. */
  async update(ctx: RequestContext, input: NoticeSettingsInput): Promise<NoticeSettingsRecord> {
    const actor = requireAccount(ctx);
    const { basedOn, ...settings } = input;
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as NoticeSettingsRecord | undefined);
      if (basedOn !== before.version) {
        throw new ConflictException('someone else changed these settings since you opened them; reload to see their changes');
      }
      const after = resolveNoticeSettings({
        ...settings,
        allEmails: settings.allEmails ?? before.allEmails,
        kinds: { ...before.kinds, ...settings.kinds },
        emails: settings.emails ?? before.emails,
      });
      const changes = noticeSettingsChanges(before, after);
      if (changes.length === 0) return before;
      const next: NoticeSettingsRecord = { ...after, version: before.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
      const payload: NoticeSettingsChangedPayload = { version: next.version, changes };
      await this.ledger.record(tx, [{ type: 'notice.settings_changed', actor, subject: null, payload: { ...payload } }]);
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

/** System Admins set the election emails (design §6.8). */
@Controller('v1/admin/notice-settings')
@Roles('system_admin')
export class NoticeSettingsController {
  constructor(private readonly settings: NoticeSettingsService) {}

  @Get()
  current() {
    return this.settings.current();
  }

  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(noticeSettingsSchema)) body: NoticeSettingsInput) {
    return this.settings.update(ctx, body);
  }
}
