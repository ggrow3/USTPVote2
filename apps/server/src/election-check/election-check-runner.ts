import { Inject, Injectable, Logger } from '@nestjs/common';
import { Collections, ELECTION_CHECK_TIMEOUT_MINUTES, splitLines, type ElectionCheckRecord, type ElectionRunResult } from 'ustp-domain';
import { runCheckQueue } from '../claude-checks/check-queue.js';
import { Firebase } from '../infra/firebase.js';
import { ELECTION_CHECKER, type ElectionChecker } from './checker.js';
import { ElectionCheckMaterials } from './election-check-material.js';

/** Checks one run takes on; each is one Claude request of a minute or two, run side by side. */
export const MAX_ELECTION_CHECKS_PER_RUN = 3;

/**
 * Runs queued election setup checks in the worker (design §6.9, §13), on its own Cloud Scheduler job, the way the
 * bylaws and consistency checks run. The election, its offices and the bylaws are read when the check runs, and what
 * was compared is recorded with the notes, with the bylaws lines they cite as they read then.
 */
@Injectable()
export class ElectionCheckRunner {
  private readonly logger = new Logger(ElectionCheckRunner.name);

  constructor(
    private readonly firebase: Firebase,
    private readonly materials: ElectionCheckMaterials,
    @Inject(ELECTION_CHECKER) private readonly checker: ElectionChecker | null,
  ) {}

  runQueued(): Promise<ElectionRunResult> {
    return runCheckQueue<ElectionCheckRecord>(
      this.firebase.db.collection(Collections.electionChecks),
      {
        what: 'election setup check',
        timeoutMinutes: ELECTION_CHECK_TIMEOUT_MINUTES,
        maxPerRun: MAX_ELECTION_CHECKS_PER_RUN,
        checker: this.checker?.name ?? null,
        logger: this.logger,
      },
      async (check) => {
        if (!this.checker) throw new Error('the election setup check is not set up on the worker');
        const { definition, proposals, positions, bylaws, basis } = await this.materials.load(check.electionId);
        if (!bylaws || !basis) throw new Error('no bylaws have been published, so there is nothing to check against');
        const output = await this.checker.check({ definition, proposals, positions, bylaws });
        const lines = splitLines(bylaws.text);
        const cited = [...new Set(output.findings.flatMap((f) => f.bylawsLines))].sort((a, b) => a - b);
        return {
          basis,
          findings: output.findings,
          quotedLines: cited.map((line) => ({ line, text: lines[line - 1]! })),
          summary: output.summary,
          model: output.model,
          usage: output.usage,
        };
      },
    );
  }
}
