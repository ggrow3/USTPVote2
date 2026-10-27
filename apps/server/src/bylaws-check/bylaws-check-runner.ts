import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BYLAWS_CHECK_TIMEOUT_MINUTES,
  Collections,
  diffLines,
  type BylawsCheckRecord,
  type BylawsRecord,
  type BylawsRunResult,
} from 'ustp-domain';
import { runCheckQueue } from '../claude-checks/check-queue.js';
import { Firebase } from '../infra/firebase.js';
import { BYLAWS_CHECKER, type BylawsChecker, type BylawsCheckInput } from './checker.js';

/** Checks one run takes on; each is one Claude request of a minute or two, run side by side. */
export const MAX_CHECKS_PER_RUN = 3;

/**
 * Runs queued bylaws checks in the worker (design §5.2, §13), on its own Cloud Scheduler job so a review of a minute or
 * two never holds up the election tick. A check is claimed in a transaction (queued → running), so overlapping runs
 * never review the same draft twice; one still running after {@link BYLAWS_CHECK_TIMEOUT_MINUTES} is marked failed.
 */
@Injectable()
export class BylawsCheckRunner {
  private readonly logger = new Logger(BylawsCheckRunner.name);

  constructor(
    private readonly firebase: Firebase,
    @Inject(BYLAWS_CHECKER) private readonly checker: BylawsChecker | null,
  ) {}

  runQueued(): Promise<BylawsRunResult> {
    return runCheckQueue<BylawsCheckRecord>(
      this.firebase.db.collection(Collections.bylawsChecks),
      {
        what: 'bylaws check',
        timeoutMinutes: BYLAWS_CHECK_TIMEOUT_MINUTES,
        maxPerRun: MAX_CHECKS_PER_RUN,
        checker: this.checker?.name ?? null,
        logger: this.logger,
      },
      async (check) => {
        if (!this.checker) throw new Error('the bylaws check is not set up on the worker');
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

  /** For scope `changes`, the lines of the amended version that the draft removed or replaced. */
  private async input(check: BylawsCheckRecord): Promise<BylawsCheckInput> {
    let removed: BylawsCheckInput['removed'] = [];
    if (check.focusLines && check.amends) {
      const base = (await this.firebase.db.collection(Collections.bylawsVersions).doc(check.amends).get()).data() as BylawsRecord | undefined;
      if (!base) throw new Error(`bylaws version ${check.amends} no longer exists`);
      removed = diffLines(base.text, check.text).flatMap((l) => (l.kind === 'removed' ? [{ line: l.before!, text: l.text }] : []));
    }
    return { title: check.title, text: check.text, focusLines: check.focusLines, amends: check.amends, removed };
  }
}
