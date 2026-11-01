import {
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  NotImplementedException,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { BylawsRunResult, ConsistencyRunResult, ElectionRunResult, TickResult } from 'ustp-domain';
import { BylawsCheckRunner } from '../bylaws-check/bylaws-check-runner.js';
import { SuggestionsService } from '../communications/suggestions.service.js';
import { ConsistencyCheckRunner } from '../consistency-check/consistency-check-runner.js';
import { ElectionCheckRunner } from '../election-check/election-check-runner.js';
import { NoticeSender } from '../notifications/notice-sender.js';
import { RoomAssistant } from '../room/room-assistant.js';
import { RoomModelDeployment } from '../room/room-model-deployment.js';
import { RoomRetention } from '../room/room-retention.js';
import { BallotSealer } from './ballot-sealer.js';
import { ElectionClock } from './election-clock.js';
import { LedgerSealer } from './ledger-sealer.js';
import { Tallier } from './tallier.js';

/**
 * Worker task endpoints (design §13), invoked by Cloud Scheduler and Cloud Tasks. The worker's Cloud Run service only
 * admits their OIDC tokens (IAM invoker), so these routes have no sign-in of their own.
 */
export const WORKER_TASKS = [
  'tick',
  'bylaws-checks',
  'consistency-checks',
  'election-checks',
  'room-assistant',
  'room-warm',
  'room-model-budget',
  'email',
] as const;
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
    private readonly suggestions: SuggestionsService,
    private readonly roomRetention: RoomRetention,
    private readonly roomAssistant: RoomAssistant,
    private readonly roomModel: RoomModelDeployment,
  ) {}

  /**
   * Every minute: prepare ballot-pool keys, open and close elections on time, seal ballots, tally elections that are
   * now fully sealed, destroy the pool keys of certified and cancelled elections, send election notices (for at most
   * 20 seconds) and the test emails Election Admins asked for, and record their bounces, delete suggestions a year old
   * (design §10.9) and the members' room's records past their time (§5.10), keep the room's model deployed on Vertex
   * AI as its switch and budget say, then seal new ledger entries (including those) into a signed block, sign approved
   * rolls and anchor new blocks. Each step runs even if an earlier one failed.
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
      bouncesRecorded: await step('record bounces', () => this.notices.recordBounces(), 0),
      suggestionsDeleted: await step('delete old suggestions', () => this.suggestions.deleteExpired(), 0),
      roomExpired: await step('expire room records', () => this.roomRetention.run(), 0),
      roomModel: await step('deploy the room model', () => this.roomModel.reconcile(), 'failed'),
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
   * itself does not fail and Cloud Tasks does not retry it; a retry would find the question taken anyway. The exception
   * is a model on Vertex AI still waking up: the question goes back in the queue and the task answers 503, so Cloud
   * Tasks tries it again shortly.
   */
  @Post('room-assistant')
  @HttpCode(200)
  async answerRoomQuestion(@Body() body: unknown): Promise<{ outcome: string }> {
    const jobId = typeof body === 'object' && body && typeof (body as { jobId?: unknown }).jobId === 'string' ? (body as { jobId: string }).jobId : null;
    if (!jobId) throw new NotFoundException('no jobId');
    const outcome = await this.roomAssistant.run(jobId);
    if (outcome === 'waking') throw new ServiceUnavailableException('the room model is still starting; the question waits');
    return { outcome };
  }

  /**
   * Google Cloud's budget for the room's model, pushed by Pub/Sub several times a day (design §5.10): once the month's
   * real bill reaches it, the model is stopped until the month ends. Always 204, so Pub/Sub does not push it again.
   */
  @Post('room-model-budget')
  @HttpCode(204)
  async roomModelBudget(@Body() body: unknown): Promise<void> {
    try {
      await this.roomModel.budgetNotice(body);
    } catch (e) {
      this.logger.error(`room model budget notice failed: ${e instanceof Error ? e.message : e}`);
    }
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

  @Post(':task')
  @HttpCode(202)
  run(@Param('task') task: string) {
    if (!(WORKER_TASKS as readonly string[]).includes(task)) throw new NotFoundException(`unknown task ${task}`);
    throw new NotImplementedException(`task ${task} is not implemented yet`);
  }
}
