import {
  Controller,
  HttpCode,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  NotImplementedException,
  Param,
  Post,
} from '@nestjs/common';
import type { BylawsRunResult, TickResult } from 'ustp-domain';
import { BylawsCheckRunner } from '../bylaws-check/bylaws-check-runner.js';
import { BallotSealer } from './ballot-sealer.js';
import { ElectionClock } from './election-clock.js';
import { LedgerSealer } from './ledger-sealer.js';
import { Tallier } from './tallier.js';

/**
 * Worker task endpoints (design §13), invoked by Cloud Scheduler and Cloud Tasks. The worker's Cloud Run service only
 * admits their OIDC tokens (IAM invoker), so these routes have no sign-in of their own.
 */
export const WORKER_TASKS = ['tick', 'bylaws-checks', 'email'] as const;
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
  ) {}

  /**
   * Every minute: prepare ballot-pool keys, open and close elections on time, seal ballots, tally elections that are
   * now fully sealed, destroy the pool keys of certified and cancelled elections, then seal new ledger entries (including
   * those) into a signed block, sign approved rolls and anchor new blocks. Each step runs even if an earlier one failed.
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

  @Post(':task')
  @HttpCode(202)
  run(@Param('task') task: string) {
    if (!(WORKER_TASKS as readonly string[]).includes(task)) throw new NotFoundException(`unknown task ${task}`);
    throw new NotImplementedException(`task ${task} is not implemented yet`);
  }
}
