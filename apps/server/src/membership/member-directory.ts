import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import type { MemberRecord } from 'ustp-domain';
import { MemberRepository } from './member.repository.js';

/**
 * What other contexts may read about members (design §5): read-only, so the membership context stays the only writer
 * of `members`. Elections take a roll from it (§6.3), accounts and testing show each account's status, photos need a
 * member record.
 */
@Injectable()
export class MemberDirectory {
  constructor(private readonly members: MemberRepository) {}

  find(accountId: string): Promise<MemberRecord | null> {
    return this.members.find(accountId);
  }

  /** The member record of each account, in order; null where an account has none. */
  findMany(accountIds: readonly string[]): Promise<(MemberRecord | null)[]> {
    return this.members.findMany(accountIds);
  }

  /** Every Active member's accountId now, read in `tx`, in no particular order. */
  activeIds(tx: Transaction): Promise<string[]> {
    return this.members.activeIds(tx);
  }
}
