import { Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  archiveSharePost,
  checkActiveMember,
  checkDeleteSharePost,
  createSharePost,
  memberSharePost,
  parseShareItem,
  publishSharePost,
  sharePostOffered,
  updateSharePost,
  uuidv7,
  type CreateSharePostInput,
  type LedgerEvent,
  type MemberSharePost,
  type Outcome,
  type ShareClickInput,
  type ShareCountsRecord,
  type SharePostRecord,
  type UpdateSharePostInput,
} from 'ustp-domain';
import { accepted, assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { CommunicationsRepository } from './communications.repository.js';
import { EventsRepository } from './events.repository.js';

/**
 * The share kit (design §10.9): ready-made posts for Active members to share from their own accounts, and how often
 * each share button is pressed, on these and on news posts. Publishing, editing a published post and archiving are
 * ledgered.
 */
@Injectable()
export class ShareKitService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: CommunicationsRepository,
    private readonly ledger: LedgerService,
    private readonly members: MemberDirectory,
    private readonly events: EventsRepository,
  ) {}

  /** What an Active member is offered today, newest first. */
  async forMember(accountId: string): Promise<MemberSharePost[]> {
    assertCheck(checkActiveMember((await this.members.find(accountId))?.status));
    const today = new Date().toISOString().slice(0, 10);
    return (await this.repo.publishedSharePosts())
      .filter((p) => sharePostOffered(p, today))
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .map(memberSharePost);
  }

  /**
   * Counts one press of a share button on something the public or members can share now: a published news post, or a
   * post in the kit. Nothing about who pressed it is kept.
   */
  async click(input: ShareClickInput): Promise<void> {
    const item = parseShareItem(input.item);
    const shareable =
      item?.kind === 'news'
        ? (await this.repo.newsBySlug(item.slug))?.status === 'published'
        : item?.kind === 'kit'
          ? (await this.repo.findSharePost(item.shareId))?.status === 'published'
          : item?.kind === 'event'
            ? (await this.events.eventBySlug(item.slug))?.status === 'published'
            : false;
    if (!shareable) throw new NotFoundException('nothing to share by that name');
    await this.repo.countShare(input.item as ShareCountsRecord['item'], input.target, new Date().toISOString());
  }

  async counts(): Promise<ShareCountsRecord[]> {
    return (await this.repo.allShareCounts()).sort((a, b) => b.total - a.total);
  }

  // --- Communications Admins ---------------------------------------------------------------------------------------

  /** Every post: drafts, then those in the kit, then archived ones, each most recently changed first. */
  async all(): Promise<SharePostRecord[]> {
    const order = { draft: 0, published: 1, archived: 2 } as const;
    return (await this.repo.allSharePosts()).sort((a, b) => order[a.status] - order[b.status] || b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(actor: string, input: CreateSharePostInput): Promise<SharePostRecord> {
    const post = createSharePost(input, uuidv7(), actor, new Date().toISOString());
    await this.firebase.db.runTransaction(async (tx) => this.repo.setSharePost(tx, post));
    return post;
  }

  async update(actor: string, shareId: string, input: UpdateSharePostInput): Promise<SharePostRecord> {
    const { basedOn, ...content } = input;
    return this.change(shareId, (post) => updateSharePost(post, content, basedOn, actor, new Date().toISOString()));
  }

  async publish(actor: string, shareId: string, basedOn: number): Promise<SharePostRecord> {
    return this.change(shareId, (post) => publishSharePost(post, basedOn, actor, new Date().toISOString()));
  }

  async archive(actor: string, shareId: string, basedOn: number): Promise<SharePostRecord> {
    return this.change(shareId, (post) => archiveSharePost(post, basedOn, actor, new Date().toISOString()));
  }

  async delete(shareId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const post = accepted(checkDeleteSharePost(await this.repo.getSharePost(tx, shareId)));
      this.repo.deleteSharePost(tx, post.shareId);
    });
  }

  private async change(
    shareId: string,
    act: (post: SharePostRecord | null) => Outcome<{ post: SharePostRecord; event: LedgerEvent | null }>,
  ): Promise<SharePostRecord> {
    return this.firebase.db.runTransaction(async (tx: Transaction) => {
      const { post, event } = accepted(act(await this.repo.getSharePost(tx, shareId)));
      if (event) await this.ledger.record(tx, [event]);
      this.repo.setSharePost(tx, post);
      return post;
    });
  }
}
