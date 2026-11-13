import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { matchMembers, type MemberMatch, type MemberRecord, type MemberStatus, type ReferredApplication } from 'ustp-domain';
import { ApplicationRepository } from './application.repository.js';
import { MemberRepository } from './member.repository.js';

/**
 * What other contexts may read about members (design §5): read-only, so the membership context stays the only writer
 * of `members`. Elections take a roll from it (§6.3) and find and check the members standing as candidates (§6.5),
 * accounts and testing show each account's status, photos need a member record.
 */
@Injectable()
export class MemberDirectory {
  constructor(
    private readonly members: MemberRepository,
    private readonly applications: ApplicationRepository,
  ) {}

  find(accountId: string): Promise<MemberRecord | null> {
    return this.members.find(accountId);
  }

  /** The member record of each account, in order; null where an account has none. */
  findMany(accountIds: readonly string[]): Promise<(MemberRecord | null)[]> {
    return this.members.findMany(accountIds);
  }

  /** The member record of each account, read in `tx`, in order; null where an account has none. */
  getAll(tx: Transaction, accountIds: readonly string[]): Promise<(MemberRecord | null)[]> {
    return this.members.getAll(tx, accountIds);
  }

  /** Every Active member's accountId now, read in `tx`, in no particular order. */
  activeIds(tx: Transaction): Promise<string[]> {
    return this.members.activeIds(tx);
  }

  /** Applications that came by a member's referral link, or by `referrer`'s (design §5.17): who, by whose link, what became of it. */
  referredApplications(referrer?: string): Promise<ReferredApplication[]> {
    return this.applications.referred(referrer);
  }

  /** Every Active member's record now, for an admin's email to members (design §10.12), in no particular order. */
  active(): Promise<MemberRecord[]> {
    return this.members.active();
  }

  /** Active members whose legal or preferred name holds `text`, best matches first (`matchMembers`), at most `limit`. */
  async searchActive(text: string, limit: number): Promise<MemberMatch[]> {
    return matchMembers(await this.members.activeNames(), text, limit);
  }

  /** Members in one of `statuses` whose legal or preferred name holds `text`, best matches first, at most `limit`. */
  async searchIn(statuses: readonly MemberStatus[], text: string, limit: number): Promise<(MemberMatch & { status: MemberStatus })[]> {
    return matchMembers(await this.members.namesIn(statuses), text, limit);
  }
}
