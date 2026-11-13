import { Injectable, Logger } from '@nestjs/common';
import {
  applicationDecidedNotice,
  applicationReceivedNotice,
  applicationWaitingNotice,
  applicationWindowStart,
  checkApplicantEmail,
  decideApplication,
  submitApplication,
  type ApplicationQueueSummary,
  type ApplicationRecord,
  type ApplicationStatus,
  type CreateApplicationInput,
  type DecisionInput,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import { DirectoryService } from '../auth/directory.service.js';
import type { RequestContext } from '../auth/principal.js';
import { accepted, assertCheck } from '../common/validation.js';
import { InboxNotices } from '../inbox/inbox.service.js';
import { ReferralCodes } from '../referrals/referrals.js';
import { Firebase } from '../infra/firebase.js';
import { ApplicationRepository } from './application.repository.js';
import { MemberRepository } from './member.repository.js';
import { Members } from './members.service.js';
import { MembershipService } from './membership.service.js';
import { RegistrationFormService } from './registration-form.js';

/**
 * Applications to join (design §5.2): submitted against the current bylaws and the registration form's current
 * wording, decided by a Membership Admin. The rules
 * are the MembershipApplication aggregate's in `ustp-domain`; each application also changes its author's status. The
 * applicant is told that it arrived and what was decided, in the bell and by email, and the Membership Admins that one
 * waits (`application-notices.ts`).
 */
@Injectable()
export class MembershipApplications {
  private readonly logger = new Logger(MembershipApplications.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly applications: ApplicationRepository,
    private readonly members: MemberRepository,
    private readonly statusChanges: Members,
    private readonly bylaws: MembershipService,
    private readonly form: RegistrationFormService,
    private readonly notices: InboxNotices,
    private readonly directory: DirectoryService,
    private readonly referrals: ReferralCodes,
  ) {}

  async submit(ctx: RequestContext, input: CreateApplicationInput): Promise<ApplicationRecord> {
    const accountId = requireAccount(ctx);
    assertCheck(checkApplicantEmail(ctx.principal.emailVerified));
    // Whose referral link the applicant came by (design §5.18); a code that is no one's names nobody.
    const referredBy = await this.referrals.owner(input.referralCode);
    const submitted = await this.firebase.db.runTransaction(async (tx) => {
      const now = new Date();
      const bylaws = await this.bylaws.currentBylaws(tx);
      const formVersion = await this.form.version(tx);
      const recent = await this.applications.countSince(tx, accountId, applicationWindowStart(now));
      const current = await this.members.get(tx, accountId);
      const applicationId = this.applications.newId();
      const tell = await this.notices.prepare(tx, accountId, applicationReceivedNotice(applicationId), now.toISOString());
      const { application, transition } = accepted(
        submitApplication({
          applicationId,
          accountId,
          input,
          bylaws,
          formVersion,
          recent,
          current,
          at: now.toISOString(),
          referredBy,
        }),
      );
      await this.statusChanges.record(tx, transition);
      this.applications.create(tx, application);
      tell();
      return application;
    });
    await this.tellTeam(accountId);
    return submitted;
  }

  /** Tells every Membership Admin but the applicant that an application waits. Never fails the application. */
  private async tellTeam(applicant: string): Promise<void> {
    try {
      const team = (await this.directory.roleHolders('membership_admin')).map((admin) => admin.accountId);
      await this.notices.notify(
        team.filter((id) => id !== applicant),
        applicationWaitingNotice(),
      );
    } catch (e) {
      this.logger.warn(`could not tell the Membership Admins of an application: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  mine(ctx: RequestContext): Promise<ApplicationRecord[]> {
    return this.applications.ofAccount(requireAccount(ctx));
  }

  list(status: ApplicationStatus, limit: number): Promise<ApplicationRecord[]> {
    return this.applications.list(status, limit);
  }

  /** The queue's size and age, for the count Membership Admins see (design §5.2). */
  queue(): Promise<ApplicationQueueSummary> {
    return this.applications.queue();
  }

  async decide(ctx: RequestContext, applicationId: string, input: DecisionInput): Promise<ApplicationRecord> {
    const decider = requireAccount(ctx);
    return this.firebase.db.runTransaction(async (tx) => {
      const found = await this.applications.get(tx, applicationId);
      const current = found && (await this.members.get(tx, found.accountId));
      const at = new Date().toISOString();
      const tell = found && (await this.notices.prepare(tx, found.accountId, applicationDecidedNotice(found.applicationId, input.decision, input.reason), at));
      const { application, transition } = accepted(decideApplication({ application: found, current, decider, input, at }));
      await this.statusChanges.record(tx, transition);
      this.applications.save(tx, application);
      tell?.();
      return application;
    });
  }
}
