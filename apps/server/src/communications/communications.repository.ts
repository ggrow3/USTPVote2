import { Injectable } from '@nestjs/common';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  type BotRecord,
  type CalendarItemRecord,
  type NewsPostRecord,
  type PressAssetRecord,
  type PressKitRecord,
  type ShareCountsRecord,
  type ShareItem,
  type SharePostRecord,
  type ShareTarget,
  type SuggestionLimitsRecord,
  type SuggestionRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

const KIT_DOC = 'current';

/**
 * Storage of the communications context (design §10.7, §11). Only it reads and writes these collections. Queries are on
 * one field each, so they need no composite index; results are sorted by the caller.
 */
@Injectable()
export class CommunicationsRepository {
  constructor(private readonly firebase: Firebase) {}

  private col(name: string) {
    return this.firebase.db.collection(name);
  }

  // --- News --------------------------------------------------------------------------------------------------------

  async allNews(): Promise<NewsPostRecord[]> {
    return (await this.col(Collections.newsPosts).get()).docs.map((d) => d.data() as NewsPostRecord);
  }

  /** Published and withdrawn posts: everything the public may reach. */
  async publicNews(): Promise<NewsPostRecord[]> {
    const snap = await this.col(Collections.newsPosts).where('status', 'in', ['published', 'withdrawn']).get();
    return snap.docs.map((d) => d.data() as NewsPostRecord);
  }

  async newsBySlug(slug: string, tx?: Transaction): Promise<NewsPostRecord | null> {
    const query = this.col(Collections.newsPosts).where('slug', '==', slug).limit(1);
    const snap = tx ? await tx.get(query) : await query.get();
    return (snap.docs[0]?.data() as NewsPostRecord | undefined) ?? null;
  }

  async getNews(tx: Transaction, postId: string): Promise<NewsPostRecord | null> {
    return ((await tx.get(this.col(Collections.newsPosts).doc(postId))).data() as NewsPostRecord | undefined) ?? null;
  }

  async findNews(postId: string): Promise<NewsPostRecord | null> {
    return ((await this.col(Collections.newsPosts).doc(postId).get()).data() as NewsPostRecord | undefined) ?? null;
  }

  setNews(tx: Transaction, post: NewsPostRecord): void {
    tx.set(this.col(Collections.newsPosts).doc(post.postId), post);
  }

  deleteNews(tx: Transaction, postId: string): void {
    tx.delete(this.col(Collections.newsPosts).doc(postId));
  }

  // --- Share kit ---------------------------------------------------------------------------------------------------

  async allSharePosts(): Promise<SharePostRecord[]> {
    return (await this.col(Collections.sharePosts).get()).docs.map((d) => d.data() as SharePostRecord);
  }

  async publishedSharePosts(): Promise<SharePostRecord[]> {
    return (await this.col(Collections.sharePosts).where('status', '==', 'published').get()).docs.map((d) => d.data() as SharePostRecord);
  }

  async getSharePost(tx: Transaction, shareId: string): Promise<SharePostRecord | null> {
    return ((await tx.get(this.col(Collections.sharePosts).doc(shareId))).data() as SharePostRecord | undefined) ?? null;
  }

  async findSharePost(shareId: string): Promise<SharePostRecord | null> {
    return ((await this.col(Collections.sharePosts).doc(shareId).get()).data() as SharePostRecord | undefined) ?? null;
  }

  setSharePost(tx: Transaction, post: SharePostRecord): void {
    tx.set(this.col(Collections.sharePosts).doc(post.shareId), post);
  }

  deleteSharePost(tx: Transaction, shareId: string): void {
    tx.delete(this.col(Collections.sharePosts).doc(shareId));
  }

  // --- Share counts ------------------------------------------------------------------------------------------------

  /** One more press of a share button: the item's total and that target's count, nothing about who. */
  async countShare(item: ShareItem, target: ShareTarget, at: string): Promise<void> {
    const ref = this.col(Collections.shareCounts).doc(item);
    await this.firebase.db.runTransaction(async (tx) => {
      const exists = (await tx.get(ref)).exists;
      tx.set(
        ref,
        { item, total: FieldValue.increment(1), targets: { [target]: FieldValue.increment(1) }, lastAt: at, ...(exists ? {} : { firstAt: at }) },
        { merge: true },
      );
    });
  }

  async allShareCounts(): Promise<ShareCountsRecord[]> {
    return (await this.col(Collections.shareCounts).get()).docs.map((d) => d.data() as ShareCountsRecord);
  }

  // --- Calendar ----------------------------------------------------------------------------------------------------

  /** Items planned for `since` or later, and every one still planned, whenever it was for. */
  async calendar(since: string): Promise<CalendarItemRecord[]> {
    const [recent, planned] = await Promise.all([
      this.col(Collections.calendarItems).where('scheduledFor', '>=', since).get(),
      this.col(Collections.calendarItems).where('status', '==', 'planned').get(),
    ]);
    const items = new Map<string, CalendarItemRecord>();
    for (const d of [...recent.docs, ...planned.docs]) items.set(d.id, d.data() as CalendarItemRecord);
    return [...items.values()];
  }

  async getCalendarItem(tx: Transaction, itemId: string): Promise<CalendarItemRecord | null> {
    return ((await tx.get(this.col(Collections.calendarItems).doc(itemId))).data() as CalendarItemRecord | undefined) ?? null;
  }

  async findCalendarItem(itemId: string): Promise<CalendarItemRecord | null> {
    return ((await this.col(Collections.calendarItems).doc(itemId).get()).data() as CalendarItemRecord | undefined) ?? null;
  }

  setCalendarItem(tx: Transaction, item: CalendarItemRecord): void {
    tx.set(this.col(Collections.calendarItems).doc(item.itemId), item);
  }

  deleteCalendarItem(tx: Transaction, itemId: string): void {
    tx.delete(this.col(Collections.calendarItems).doc(itemId));
  }

  // --- Suggestions -------------------------------------------------------------------------------------------------

  async allSuggestions(): Promise<SuggestionRecord[]> {
    return (await this.col(Collections.suggestions).get()).docs.map((d) => d.data() as SuggestionRecord);
  }

  async getSuggestion(tx: Transaction, suggestionId: string): Promise<SuggestionRecord | null> {
    return ((await tx.get(this.col(Collections.suggestions).doc(suggestionId))).data() as SuggestionRecord | undefined) ?? null;
  }

  createSuggestion(tx: Transaction, suggestion: SuggestionRecord): void {
    tx.create(this.col(Collections.suggestions).doc(suggestion.suggestionId), suggestion);
  }

  setSuggestion(tx: Transaction, suggestion: SuggestionRecord): void {
    tx.set(this.col(Collections.suggestions).doc(suggestion.suggestionId), suggestion);
  }

  async deleteSuggestion(suggestionId: string): Promise<boolean> {
    const ref = this.col(Collections.suggestions).doc(suggestionId);
    if (!(await ref.get()).exists) return false;
    await ref.delete();
    return true;
  }

  async getSuggestionLimits(tx: Transaction, day: string): Promise<SuggestionLimitsRecord | null> {
    return ((await tx.get(this.col(Collections.suggestionLimits).doc(day))).data() as SuggestionLimitsRecord | undefined) ?? null;
  }

  setSuggestionLimits(tx: Transaction, limits: SuggestionLimitsRecord): void {
    tx.set(this.col(Collections.suggestionLimits).doc(limits.day), limits);
  }

  /**
   * Deletes suggestions that arrived before `before`, and each day's limits (and so its salt) before `beforeDay`, in
   * batches; how many suggestions went.
   */
  async deleteExpired(before: string, beforeDay: string): Promise<number> {
    let deleted = 0;
    for (;;) {
      const snap = await this.col(Collections.suggestions).where('receivedAt', '<', before).limit(400).get();
      if (snap.empty) break;
      const batch = this.firebase.db.batch();
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
      deleted += snap.size;
    }
    const days = await this.col(Collections.suggestionLimits).where('day', '<', beforeDay).get();
    if (!days.empty) {
      const batch = this.firebase.db.batch();
      for (const d of days.docs) batch.delete(d.ref);
      await batch.commit();
    }
    return deleted;
  }

  // --- Press kit ---------------------------------------------------------------------------------------------------

  async pressKit(tx?: Transaction): Promise<Partial<PressKitRecord> | null> {
    const ref = this.col(Collections.pressKit).doc(KIT_DOC);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return (snap.data() as Partial<PressKitRecord> | undefined) ?? null;
  }

  setPressKit(tx: Transaction, kit: PressKitRecord): void {
    tx.set(this.col(Collections.pressKit).doc(KIT_DOC), kit);
  }

  /** The files' records (without their bytes), for those of `ids` uploaded here. */
  async pressAssets(ids: readonly string[], tx?: Transaction): Promise<Map<string, PressAssetRecord>> {
    if (!ids.length) return new Map();
    const refs = ids.map((id) => this.col(Collections.pressAssets).doc(id));
    const snaps = tx ? await tx.getAll(...refs) : await this.firebase.db.getAll(...refs);
    const found = new Map<string, PressAssetRecord>();
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const { data: _, ...record } = snap.data() as PressAssetRecord & { data: Buffer };
      found.set(snap.id, record);
    }
    return found;
  }

  async pressAssetData(id: string): Promise<{ record: PressAssetRecord; data: Buffer } | null> {
    const snap = await this.col(Collections.pressAssets).doc(id).get();
    if (!snap.exists) return null;
    const { data, ...record } = snap.data() as PressAssetRecord & { data: Buffer };
    return { record, data: Buffer.from(data) };
  }

  async savePressAsset(record: PressAssetRecord, data: Buffer): Promise<void> {
    await this.col(Collections.pressAssets).doc(record.id).set({ ...record, data });
  }

  // --- Bots --------------------------------------------------------------------------------------------------------

  async allBots(): Promise<BotRecord[]> {
    return (await this.col(Collections.bots).get()).docs.map((d) => d.data() as BotRecord);
  }

  async getBot(tx: Transaction, botId: string): Promise<BotRecord | null> {
    return ((await tx.get(this.col(Collections.bots).doc(botId))).data() as BotRecord | undefined) ?? null;
  }

  async findBot(botId: string): Promise<BotRecord | null> {
    return ((await this.col(Collections.bots).doc(botId).get()).data() as BotRecord | undefined) ?? null;
  }

  setBot(tx: Transaction, bot: BotRecord): void {
    tx.set(this.col(Collections.bots).doc(bot.botId), bot);
  }

  deleteBot(tx: Transaction, botId: string): void {
    tx.delete(this.col(Collections.bots).doc(botId));
  }
}
