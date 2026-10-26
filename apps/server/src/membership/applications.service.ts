import { Injectable } from '@nestjs/common';
import {
  applicationWindowStart,
  checkApplicantEmail,
  decideApplication,
  submitApplication,
  type ApplicationRecord,
  type ApplicationStatus,
  type CreateApplicationInput,
  type DecisionInput,
} from 'ustp-domain';
import { requireAccount } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { accepted, assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { ApplicationRepository } from './application.repository.js';
import { MemberRepository } from './member.repository.js';
import { Members } from './members.service.js';
import { MembershipService } from './membership.service.js';

/**
 * Applications to join (design §5.2): submitted against the current bylaws, decided by a Membership Admin. The rules
 * are the MembershipApplication aggregate's in `ustp-domain`; each application also changes its author's status.
 */
@Injectable()
export class MembershipApplications {
  constructor(
    private readonly firebase: Firebase,
    private readonly applications: ApplicationRepository,
    private readonly members: MemberRepository,
    private readonly statusChanges: Members,
    private readonly bylaws: MembershipService,
  ) {}

  async submit(ctx: RequestContext, input: CreateApplicationInput): Promise<ApplicationRecord> {
    const accountId = requireAccount(ctx);
    assertCheck(checkApplicantEmail(ctx.principal.emailVerified));
    return this.firebase.db.runTransaction(async (tx) => {
      const now = new Date();
      const bylaws = await this.bylaws.currentBylaws(tx);
      const recent = await this.applications.countSince(tx, accountId, applicationWindowStart(now));
      const current = await this.members.get(tx, accountId);
      const { application, transition } = accepted(
        submitApplication({ applicationId: this.applications.newId(), accountId, input, bylaws, recent, current, at: now.toISOString() }),
      );
      await this.statusChanges.record(tx, transition);
      this.applications.create(tx, application);
      return application;
    });
  }

  mine(ctx: RequestContext): Promise<ApplicationRecord[]> {
    return this.applications.ofAccount(requireAccount(ctx));
  }

  list(status: ApplicationStatus, limit: number): Promise<ApplicationRecord[]> {
    return this.applications.list(status, limit);
  }

  async decide(ctx: RequestContext, applicationId: string, input: DecisionInput): Promise<ApplicationRecord> {
    const decider = requireAccount(ctx);
    return this.firebase.db.runTransaction(async (tx) => {
      const found = await this.applications.get(tx, applicationId);
      const current = found && (await this.members.get(tx, found.accountId));
      const { application, transition } = accepted(
        decideApplication({ application: found, current, decider, input, at: new Date().toISOString() }),
      );
      await this.statusChanges.record(tx, transition);
      this.applications.save(tx, application);
      return application;
    });
  }
}
