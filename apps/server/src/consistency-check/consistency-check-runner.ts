import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CONSISTENCY_CHECK_TIMEOUT_MINUTES,
  Collections,
  type BylawsRecord,
  type ConsistencyCheckRecord,
  type ConsistencyRunResult,
} from 'ustp-domain';
import { runCheckQueue } from '../claude-checks/check-queue.js';
import { Firebase } from '../infra/firebase.js';
import { CONSISTENCY_CHECKER, type ConsistencyChecker, type ConsistencyCheckInput } from './checker.js';

/** Checks one run takes on; each is one Claude request of a minute or two, run side by side. */
export const MAX_CONSISTENCY_CHECKS_PER_RUN = 3;

/**
 * Runs queued consistency checks in the worker (design §5.5, §13), on its own Cloud Scheduler job, the way the bylaws
 * checks run: claimed in a transaction, side by side, and failed after {@link CONSISTENCY_CHECK_TIMEOUT_MINUTES}.
 */
@Injectable()
export class ConsistencyCheckRunner {
  private readonly logger = new Logger(ConsistencyCheckRunner.name);

  constructor(
    private readonly firebase: Firebase,
    @Inject(CONSISTENCY_CHECKER) private readonly checker: ConsistencyChecker | null,
  ) {}

  runQueued(): Promise<ConsistencyRunResult> {
    return runCheckQueue<ConsistencyCheckRecord>(
      this.firebase.db.collection(Collections.consistencyChecks),
      {
        what: 'consistency check',
        timeoutMinutes: CONSISTENCY_CHECK_TIMEOUT_MINUTES,
        maxPerRun: MAX_CONSISTENCY_CHECKS_PER_RUN,
        checker: this.checker?.name ?? null,
        logger: this.logger,
      },
      async (check) => {
        if (!this.checker) throw new Error('the consistency check is not set up on the worker');
        const output = await this.checker.check(await this.input(check));
        return {
          findings: output.findings,
          summary: output.summary,
          references: output.references,
          model: output.model,
          usage: output.usage,
        };
      },
    );
  }

  /** The questions as they were when asked for, and the bylaws version in force then (versions never change). */
  private async input(check: ConsistencyCheckRecord): Promise<ConsistencyCheckInput> {
    let bylaws: ConsistencyCheckInput['bylaws'] = null;
    if (check.bylaws) {
      const record = (await this.firebase.db.collection(Collections.bylawsVersions).doc(check.bylaws.version).get()).data() as
        | BylawsRecord
        | undefined;
      if (!record) throw new Error(`bylaws version ${check.bylaws.version} no longer exists`);
      bylaws = { version: record.version, title: record.title, text: record.text };
    }
    return { electionTitle: check.electionTitle, electionDescription: check.electionDescription, material: check.material, bylaws };
  }
}
