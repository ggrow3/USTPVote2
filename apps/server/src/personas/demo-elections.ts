import { randomBytes } from 'node:crypto';
import { Body, ConflictException, Controller, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Post } from '@nestjs/common';
import {
  APPROVAL_MAX_AUTH_AGE_SECONDS,
  DEMO_MIN_TEST_VOTERS,
  DEMO_OPENINGS,
  demoElection,
  demoElectionInputSchema,
  MAX_TEST_VOTERS,
  PROBLEM_TYPES,
  seededRandom,
  type DemoElectionResult,
  type PersonaKind,
  type PersonaSummary,
} from 'ustp-domain';
import { ApprovalsService } from '../administration/approvals.service.js';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import { actorOf, type RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionsService } from '../elections/elections.service.js';
import { PersonasService } from './personas.service.js';

/** The written reason on every request and decision a demo makes; Auditors see it in the ledger and Approvals. */
export const DEMO_REASON = 'Demo election, made up at random for testing (Admin → Testing)';

/**
 * Demo elections (design §10.4): one click makes a rehearsal of a random election on Transhumanist themes, scheduled
 * and ready to vote in. It is built as a rehearsal is by hand: the Test Election Admin imports it and requests a roll
 * of the test voters and the schedule, and the Test Auditor approves both, through the ordinary services and their
 * checks. Its roll is test voters only, so its notices go to the outbox and nobody is mailed (§6.8), and once
 * certified or cancelled it can be deleted like any rehearsal (§6.1).
 */
@Injectable()
export class DemoElectionsService {
  private readonly logger = new Logger('TestPersonas');

  constructor(
    private readonly personas: PersonasService,
    private readonly elections: ElectionsService,
    private readonly approvals: ApprovalsService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  /** `body` is checked only once testing mode is known to be on, so the route answers 404 whatever is sent without it. */
  async create(ctx: RequestContext, body: unknown): Promise<DemoElectionResult> {
    if (!this.config.testingMode) throw new NotFoundException('testing mode is off on this deployment');
    const operator = requireAccount(ctx);
    const { opens, votingMinutes, secrecy, seed = randomBytes(8).toString('hex') } = new ZodPipe(demoElectionInputSchema).transform(body);
    // The approvals need a recent sign-in. Checking it first means a demo is never left half built.
    if (actorOf(ctx, this.config.adminMfaRequired).authAgeSeconds > APPROVAL_MAX_AUTH_AGE_SECONDS) {
      throw new ForbiddenException({ message: 'sign in again to create a demo election', type: PROBLEM_TYPES.reauthRequired });
    }
    const personas = await this.ensurePersonas(ctx);
    const admin = this.actingAs(ctx, personas, 'election_admin');
    const auditor = this.actingAs(ctx, personas, 'auditor');

    const pkg = demoElection(seededRandom(seed), {
      now: new Date(),
      opensInSeconds: DEMO_OPENINGS[opens],
      votingSeconds: votingMinutes * 60,
      ...(secrecy && { secrecy }),
    });
    const { electionId } = (await this.elections.importPackage(admin, pkg)).election;
    // Persona accounts have no login of their own, so this log ties the demo's actions to a real person, as the guard's
    // does for each request made as a persona.
    this.logger.log(
      `${operator} acting as test personas ${admin.accountId} and ${auditor.accountId}: demo election ${electionId} (seed ${seed})`,
    );
    try {
      const roll = await this.elections.requestRoll(admin, electionId, DEMO_REASON, 'test_voters');
      await this.approvals.decide(auditor, roll.approvalId, { decision: 'approve', reason: DEMO_REASON });
      const schedule = await this.elections.requestSchedule(admin, electionId, DEMO_REASON);
      await this.approvals.decide(auditor, schedule.id, { decision: 'approve', reason: DEMO_REASON });
    } catch (e) {
      await this.discard(admin, electionId);
      throw e;
    }
    return { seed, election: await this.elections.detail(electionId) };
  }

  /** The admin personas, and enough Active test voters for a vote (adding them needs published bylaws: 409). */
  private async ensurePersonas(ctx: RequestContext): Promise<PersonaSummary[]> {
    const personas = await this.personas.create(ctx, { voters: 0 });
    const voters = personas.filter((p) => p.kind === 'voter');
    const active = voters.filter((p) => p.memberStatus === 'active').length;
    const missing = Math.min(DEMO_MIN_TEST_VOTERS - active, MAX_TEST_VOTERS - voters.length);
    return missing > 0 ? this.personas.create(ctx, { voters: missing }) : personas;
  }

  /**
   * The request as the persona of this kind would make it, with the System Admin kept as its operator. A persona whose
   * role was revoked is refused here, before anything is written, as the guard would refuse its own requests.
   */
  private actingAs(ctx: RequestContext, personas: readonly PersonaSummary[], kind: Exclude<PersonaKind, 'voter'>): RequestContext {
    const persona = personas.find((p) => p.kind === kind)!;
    if (!persona.roles.includes(kind)) {
      throw new ConflictException(`${persona.label} no longer holds its role; grant it again under Admin → People`);
    }
    return { principal: ctx.principal, accountId: persona.accountId, roles: persona.roles, operator: ctx.accountId };
  }

  /** A demo that failed on the way is still a draft: cancelled and deleted again, as an Election Admin could. */
  private async discard(admin: RequestContext, electionId: string): Promise<void> {
    try {
      await this.elections.cancel(admin, electionId, DEMO_REASON);
      await this.elections.delete(admin, electionId, DEMO_REASON);
    } catch (e) {
      this.logger.warn(`demo election ${electionId} failed and could not be removed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** `POST /v1/testing/demo-elections`: System Admins only, and only in testing mode (404 otherwise). */
@Controller('v1/testing/demo-elections')
@Roles('system_admin')
export class DemoElectionsController {
  constructor(private readonly demos: DemoElectionsService) {}

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.demos.create(ctx, body);
  }
}
