import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BYLAWS_CHECK_TIMEOUT_MINUTES,
  Collections,
  diffLines,
  type BylawsCheckRecord,
  type BylawsRecord,
  type BylawsRunResult,
} from 'ustp-domain';
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

  async runQueued(): Promise<BylawsRunResult> {
    const db = this.firebase.db;
    const checks = db.collection(Collections.bylawsChecks);
    const cutoff = new Date(Date.now() - BYLAWS_CHECK_TIMEOUT_MINUTES * 60_000).toISOString();
    let timedOut = 0;
    for (const doc of (await checks.where('status', '==', 'running').get()).docs) {
      const check = doc.data() as BylawsCheckRecord;
      if ((check.startedAt ?? check.requestedAt) >= cutoff) continue;
      await this.finish(check.checkId, { error: `the check did not finish within ${BYLAWS_CHECK_TIMEOUT_MINUTES} minutes; request it again` });
      timedOut++;
    }

    const queued = (await checks.where('status', '==', 'queued').orderBy('requestedAt').limit(MAX_CHECKS_PER_RUN).get()).docs;
    const claimed: BylawsCheckRecord[] = [];
    for (const doc of queued) {
      const check = await db.runTransaction(async (tx) => {
        const current = (await tx.get(doc.ref)).data() as BylawsCheckRecord | undefined;
        if (current?.status !== 'queued') return null; // another run took it
        tx.update(doc.ref, { status: 'running', startedAt: new Date().toISOString(), checker: this.checker?.name ?? null });
        return current;
      });
      if (check) claimed.push(check);
    }

    const outcomes = await Promise.all(claimed.map((check) => this.run(check)));
    return {
      checked: outcomes.filter((ok) => ok).length,
      failed: outcomes.filter((ok) => !ok).length + timedOut,
    };
  }

  private async run(check: BylawsCheckRecord): Promise<boolean> {
    try {
      if (!this.checker) throw new Error('the bylaws check is not set up on the worker');
      const output = await this.checker.check(await this.input(check));
      await this.finish(check.checkId, {
        findings: output.findings,
        summary: output.summary,
        references: output.references,
        model: output.model,
        usage: output.usage,
      });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`bylaws check ${check.checkId} failed: ${message}`);
      await this.finish(check.checkId, { error: message.slice(0, 500) });
      return false;
    }
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

  private async finish(checkId: string, result: Partial<BylawsCheckRecord>): Promise<void> {
    await this.firebase.db
      .collection(Collections.bylawsChecks)
      .doc(checkId)
      .update({ ...result, status: result.error ? 'failed' : 'done', finishedAt: new Date().toISOString() });
  }
}
