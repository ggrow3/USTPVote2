import { randomBytes } from 'node:crypto';
import { Controller, ForbiddenException, Get, Inject, Injectable, Query } from '@nestjs/common';
import {
  administersSite,
  isReferralCode,
  isReferralPeriod,
  myReferralCounts,
  referralCodeFrom,
  referralCredits,
  referralLeaderboard,
  referralLink,
  REFERRAL_CODE_LENGTH,
  type MyReferrals,
  type ReferralLeaderboard,
  type ReferralLinkRecord,
} from 'ustp-domain';
import { Ctx, requireAccount } from '../auth/decorators.js';
import { DirectoryService } from '../auth/directory.service.js';
import type { RequestContext } from '../auth/principal.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { TeamRoster } from '../teams/team-roster.js';
import { ReferralRepository } from './referral.repository.js';

/** Tries at a fresh code before giving up (31^8 codes: a clash is rare). */
const CODE_TRIES = 5;

/**
 * Whose referral link a code is (design §5.18): the referrals context's port for membership, which records it on an
 * application as `referredBy`. A code that is no one's names nobody.
 */
@Injectable()
export class ReferralCodes {
  constructor(private readonly codes: ReferralRepository) {}

  async owner(code: string | undefined | null): Promise<string | null> {
    if (!isReferralCode(code)) return null;
    return (await this.codes.code(code))?.accountId ?? null;
  }

  /** Deletes a deleted account's code (design §4): its link stops naming anyone. */
  async forgetAccount(accountId: string): Promise<void> {
    await this.codes.deleteOf(accountId);
  }
}

/**
 * Members' referral links and the team leaderboard (design §5.18, the party's decisions of 2026-11-12): an Active member's
 * link and how many joined by it and wait, and teams ranked by the people their members brought in, for Active members
 * only. Credits come from the applications themselves (`referredBy`, approved), so nothing is stored but the codes.
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly codes: ReferralRepository,
    private readonly members: MemberDirectory,
    private readonly roster: TeamRoster,
    private readonly directory: DirectoryService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** The caller's own link (made the first time they ask, while they are an Active member) and counts. */
  async mine(accountId: string): Promise<MyReferrals> {
    const member = await this.members.find(accountId);
    const [existing, applications] = await Promise.all([this.codes.link(accountId), this.members.referredApplications(accountId)]);
    const counts = myReferralCounts(accountId, applications);
    if (member?.status !== 'active') return { eligible: false, code: existing?.code ?? null, link: null, ...counts };
    const link = existing ?? (await this.create(accountId));
    return { eligible: true, code: link.code, link: referralLink(this.config.webOrigin ?? '', link.code), ...counts };
  }

  private async create(accountId: string): Promise<ReferralLinkRecord> {
    for (let i = 0; i < CODE_TRIES; i++) {
      const code = referralCodeFrom(randomBytes(REFERRAL_CODE_LENGTH));
      const made = await this.firebase.db.runTransaction(async (tx) => {
        const [taken, existing] = await Promise.all([this.codes.code(code, tx), this.codes.link(accountId, tx)]);
        if (existing) return existing;
        if (taken) return null;
        const link: ReferralLinkRecord = { accountId, code, createdAt: new Date().toISOString() };
        this.codes.create(tx, link);
        return link;
      });
      if (made) return made;
    }
    throw new Error('could not make a referral code');
  }

  /** Teams ranked by the people their members brought in, for Active members and Membership and System Admins. */
  async leaderboard(ctx: RequestContext, days: number): Promise<ReferralLeaderboard> {
    const viewer = requireAccount(ctx);
    if ((await this.members.find(viewer))?.status !== 'active') {
      // The route needs no role, so the caller's roles are read here, only for someone who is not an Active member.
      const roles = await this.directory.activeRoles(viewer);
      if (!roles.includes('membership_admin') && !administersSite(roles)) throw new ForbiddenException('the leaderboard is for Active members');
    }
    const [teams, places, applications] = await Promise.all([this.roster.all(), this.roster.places(), this.members.referredApplications()]);
    const people = [...new Set(places.map((p) => p.accountId))];
    const records = await this.members.findMany(people);
    const active = new Set(people.filter((_, i) => records[i]?.status === 'active'));
    return referralLeaderboard({
      days: isReferralPeriod(days) ? days : 0,
      now: new Date(),
      teams,
      places,
      active,
      credits: referralCredits(applications),
      viewer,
    });
  }
}

/** A member's own referral link and counts (design §5.18). */
@Controller('v1/me/referrals')
export class MyReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  mine(@Ctx() ctx: RequestContext): Promise<MyReferrals> {
    return this.referrals.mine(requireAccount(ctx));
  }
}

/** The team leaderboard (design §5.18): Active members, and the Membership and System Admins who run teams. */
@Controller('v1/referrals/leaderboard')
export class ReferralLeaderboardController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  leaderboard(@Ctx() ctx: RequestContext, @Query('days') days?: string): Promise<ReferralLeaderboard> {
    return this.referrals.leaderboard(ctx, Number(days ?? 0));
  }
}
