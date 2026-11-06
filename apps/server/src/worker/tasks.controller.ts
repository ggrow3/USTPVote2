import {
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import type { BylawsRunResult, ConsistencyRunResult, ElectionRunResult, TickResult } from 'ustp-domain';
import { BylawsCheckRunner } from '../bylaws-check/bylaws-check-runner.js';
import { SuggestionsService } from '../communications/suggestions.service.js';
import { ConsistencyCheckRunner } from '../consistency-check/consistency-check-runner.js';
import { ElectionCheckRunner } from '../election-check/election-check-runner.js';
import { MailEventRecorder } from '../notifications/mail-events.js';
import { MailHealthChecker } from '../notifications/mail-health.js';
import { MailRequestSender } from '../notifications/mail-requests.js';
import { NoticeSender } from '../notifications/notice-sender.js';
import { SendVerifier } from '../notifications/send-verification.js';
import { WelcomeSender } from '../notifications/welcome-sender.js';
import { RoomAssistant } from '../room/room-assistant.js';
import { RoomRetention } from '../room/room-retention.js';
import { BallotSealer } from './ballot-sealer.js';
import { ElectionClock } from './election-clock.js';
import { LedgerSealer } from './ledger-sealer.js';
import { Tallier } from './tallier.js';

/**
 * Worker task endpoints (design §13), invoked by Cloud Scheduler and Cloud Tasks. The worker's Cloud Run service only
 * admits their OIDC tokens (IAM invoker), so these routes have no sign-in of their own.
 */
export const WORKER_TASKS = ['tick', 'bylaws-checks', 'consistency-checks', 'election-checks', 'room-assistant', 'room-warm'] as const;
export type WorkerTask = (typeof WORKER_TASKS)[number];

@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(
    private readonly clock: ElectionClock,
    private readonly ballots: BallotSealer,
    private readonly tallier: Tallier,
    private readonly sealer: LedgerSealer,
    private readonly bylawsChecks: BylawsCheckRunner,
    private readonly consistencyChecks: ConsistencyCheckRunner,
    private readonly electionChecks: ElectionCheckRunner,
    private readonly notices: NoticeSender,
    private readonly welcomes: WelcomeSender,
    private readonly mailEvents: MailEventRecorder,
    private readonly mailHealth: MailHealthChecker,
    private readonly mailRequests: MailRequestSender,
    private readonly sendChecks: SendVerifier,
    private readonly suggestions: SuggestionsService,
    private readonly roomRetention: RoomRetention,
    private readonly roomAssistant: RoomAssistant,
  ) {}

  /**
   * Every minute: prepare ballot-pool keys, open and close elections on time, seal ballots, tally elections that are
   * now fully sealed, destroy the pool keys of certified and cancelled elections, send election notices (for at most
   * 20 seconds, vote confirmations first), the test emails Election Admins asked for and the welcome emails of added members (§5.13), record what
   * the mail provider reported of them and ledger each notice round's reports after three days, check how email is set
   * up every hour or when a System Admin asks (§10.12), delete suggestions a year old
   * (design §10.9) and the members' room's records past their time (§5.10), then seal new ledger entries (including those) into a signed block, sign approved rolls and anchor
   * new blocks. Each step runs even if an earlier one failed.
   */
  @Post('tick')
  @HttpCode(200)
  async tick(): Promise<TickResult> {
    const failures: string[] = [];
    const step = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await run();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`tick: ${name} failed: ${message}`);
        failures.push(`${name}: ${message}`);
        return fallback;
      }
    };
    const result: TickResult = {
      poolKeysCreated: await step('prepare pool keys', () => this.clock.preparePoolKeys(), 0),
      electionsOpened: await step('open elections', () => this.clock.openDue(), 0),
      electionsClosed: await step('close elections', () => this.clock.closeDue(), 0),
      ballotsSealed: await step('seal ballots', () => this.ballots.sealAll(), 0),
      resultsComputed: await step('tally results', () => this.tallier.tallyAll(), 0),
      poolKeysDestroyed: await step('destroy pool keys', () => this.clock.destroyPoolKeys(), 0),
      noticesSent: await step('send notices', () => this.notices.sendDue(), 0),
      testEmailsSent: await step('send test emails', () => this.notices.sendTests(), 0),
      welcomeEmailsSent: await step('send welcome emails', () => this.welcomes.sendDue(), 0),
      memberEmailsSent: await step("do members' email requests", () => this.mailRequests.sendDue(), 0),
      mailEventsRecorded: await step('record mail events', () => this.mailEvents.record(), 0),
      deliveryReports: await step('report delivery', () => this.notices.reportDelivery(), 0),
      sendsVerified: await step('verify sends', () => this.sendChecks.verifyDue(), 0),
      mailChecked: await step('check mail setup', () => this.mailHealth.runDue(), false),
      suggestionsDeleted: await step('delete old suggestions', () => this.suggestions.deleteExpired(), 0),
      roomExpired: await step('expire room records', () => this.roomRetention.run(), 0),
      blocksSealed: (await step('seal blocks', () => this.sealer.sealBlocks(), [])).length,
      rollsSigned: await step('sign rolls', () => this.sealer.signRolls(), 0),
      anchored: await step('anchor blocks', () => this.sealer.anchorBlocks(), 0),
    };
    if (failures.length) throw new InternalServerErrorException(`tick incomplete (${JSON.stringify(result)}): ${failures.join('; ')}`);
    return result;
  }

  /**
   * Every minute, on its own Cloud Scheduler job: run queued bylaws checks (design §5.2). Separate from the tick because
   * a review takes a minute or two. A check that fails is recorded on the check, not as a failed task.
   */
  @Post('bylaws-checks')
  @HttpCode(200)
  runBylawsChecks(): Promise<BylawsRunResult> {
    return this.bylawsChecks.runQueued();
  }

  /** Every minute, on its own Cloud Scheduler job: run queued platform consistency checks (design §5.5), as above. */
  @Post('consistency-checks')
  @HttpCode(200)
  runConsistencyChecks(): Promise<ConsistencyRunResult> {
    return this.consistencyChecks.runQueued();
  }

  /** Every minute, on its own Cloud Scheduler job: run queued election setup checks (design §6.9), as above. */
  @Post('election-checks')
  @HttpCode(200)
  runElectionChecks(): Promise<ElectionRunResult> {
    return this.electionChecks.runQueued();
  }

  /**
   * A Cloud Task the api queued for a question in the members' room (design §5.10): the assistant answers it, which may
   * take minutes while the room's model starts. The answer, or why there is none, is posted in the room, so the task
   * itself never fails and Cloud Tasks does not retry it; a retry would find the question taken anyway.
   */
  @Post('room-assistant')
  @HttpCode(200)
  async answerRoomQuestion(@Body() body: unknown): Promise<{ outcome: string }> {
    const jobId = typeof body === 'object' && body && typeof (body as { jobId?: unknown }).jobId === 'string' ? (body as { jobId: string }).jobId : null;
    if (!jobId) throw new NotFoundException('no jobId');
    return { outcome: await this.roomAssistant.run(jobId) };
  }

  /**
   * A Cloud Task the api queued when a System Admin switched the room's model server on: start it and load the models,
   * so the next question need not wait. A failure is logged, not retried: the next question starts the server anyway.
   */
  @Post('room-warm')
  @HttpCode(200)
  async warmRoomModel(): Promise<{ warmed: boolean }> {
    try {
      return { warmed: await this.roomAssistant.warm() };
    } catch (e) {
      this.logger.warn(`room model warm-up failed: ${e instanceof Error ? e.message : e}`);
      return { warmed: false };
    }
  }
}
