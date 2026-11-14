import { ConflictException, Injectable } from '@nestjs/common';
import {
  Collections,
  discordSettingsChanges,
  resolveDiscordSettings,
  type DiscordFeedState,
  type DiscordSettingsChangedPayload,
  type DiscordSettingsInput,
  type DiscordSettingsRecord,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

const CACHE_MS = 60_000;

function record(data: Partial<DiscordSettingsRecord> | undefined): DiscordSettingsRecord {
  return { ...resolveDiscordSettings(data), version: data?.version ?? 0, updatedAt: data?.updatedAt ?? null, updatedBy: data?.updatedBy ?? null };
}

/**
 * What Communications Admins set about the Discord bot (design §10.18): whether it posts at all, and the channel for
 * each kind of post. The worker reads them every tick, so they are cached briefly; a change counts within a minute.
 */
@Injectable()
export class DiscordSettingsService {
  private cache: { at: number; record: DiscordSettingsRecord } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.discordSettings).doc('current');
  }

  async current(): Promise<DiscordSettingsRecord> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.record;
    const current = record((await this.doc.get()).data() as DiscordSettingsRecord | undefined);
    this.cache = { at: Date.now(), record: current };
    return current;
  }

  /**
   * Saves the settings if nobody saved since `basedOn`, ledgering each one that changed. Switching the bot on also
   * marks where it starts reading: at this very ledger entry, so nothing that happened while it was off is posted.
   */
  async update(ctx: RequestContext, input: DiscordSettingsInput): Promise<DiscordSettingsRecord> {
    const actor = requireAccount(ctx);
    const { basedOn, ...settings } = input;
    const db = this.firebase.db;
    const saved = await db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as DiscordSettingsRecord | undefined);
      if (basedOn !== before.version) {
        throw new ConflictException('someone else changed these settings since you opened them; reload to see their changes');
      }
      const after = resolveDiscordSettings({ enabled: settings.enabled, channels: { ...before.channels, ...settings.channels } });
      const changes = discordSettingsChanges(before, after);
      if (changes.length === 0) return before;
      const now = new Date().toISOString();
      const next: DiscordSettingsRecord = { ...after, version: before.version + 1, updatedAt: now, updatedBy: actor };
      const payload: DiscordSettingsChangedPayload = { version: next.version, changes };
      const [seq] = await this.ledger.record(tx, [{ type: 'discord.settings_changed', actor, subject: null, payload: { ...payload } }]);
      tx.set(this.doc, next);
      if (after.enabled && !before.enabled) {
        const start: DiscordFeedState = { seq: seq!, since: now };
        tx.set(db.collection(Collections.discordState).doc('feed'), start);
      }
      return next;
    });
    this.cache = { at: Date.now(), record: saved };
    return saved;
  }

  invalidate(): void {
    this.cache = null;
  }
}
