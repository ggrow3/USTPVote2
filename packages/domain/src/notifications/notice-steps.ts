import type { StepStatus } from '../election-progress.js';
import type { ElectionRecord } from '../elections.js';
import {
  hasReminder,
  isReminderDue,
  isVotingOpen,
  noticeDelivery,
  NOTICE_KINDS,
  type NoticeKind,
  type NoticesView,
  type NoticeSummary,
} from './notices.js';

/**
 * The election emails' place in the election editor's workflow (design §6.1, §6.8): for each, whether it has gone, is
 * going, is still to come or will not come, read from the notices' counts and the election alone, never from who they
 * went to. The workflow shows them beside the lifecycle's steps; they never hold the election up.
 */
export interface NoticeStep {
  readonly kind: NoticeKind;
  /** `done` sent (whatever the counts say), `current` sending or due now, `upcoming`, or `not_reached`. */
  readonly status: StepStatus;
  /** The notice once the worker has started it; null before. */
  readonly notice: NoticeSummary | null;
}

export function noticeSteps(input: {
  readonly election: Pick<ElectionRecord, 'state' | 'opensAt' | 'closesAt'>;
  /** The roll is test voters only (design §10.4). */
  readonly rehearsal: boolean;
  readonly testingMode: boolean;
  /** The admin view of the election's notices; null until it has loaded, when how they are sent is not known yet. */
  readonly view: NoticesView | null;
  readonly now: Date;
}): NoticeStep[] {
  const { election, now, view } = input;
  const sends = noticeDelivery({ rehearsal: input.rehearsal, testingMode: input.testingMode, transport: view?.delivery ?? 'mail' }) !== null;
  return NOTICE_KINDS.map((kind): NoticeStep => {
    const notice = view?.notices.find((n) => n.kind === kind) ?? null;
    if (notice) return { kind, status: notice.status === 'done' ? 'done' : 'current', notice };
    const status: StepStatus =
      !sends || (kind === 'closing_soon' && !hasReminder(election))
        ? 'not_reached'
        : election.state === 'draft' || election.state === 'scheduled'
          ? 'upcoming'
          : kind === 'voting_open'
            ? isVotingOpen(election, now)
              ? 'current'
              : 'not_reached'
            : isReminderDue(election, now)
              ? 'current'
              : isVotingOpen(election, now)
                ? 'upcoming'
                : 'not_reached';
    return { kind, status, notice: null };
  });
}

/**
 * The emails together, for their line in the workflow's list: going if either is, none at all if neither can come,
 * still to come if one is, and done once every one that can come has gone.
 */
export function emailStepStatus(steps: readonly NoticeStep[]): StepStatus {
  const has = (status: StepStatus) => steps.some((s) => s.status === status);
  if (has('current')) return 'current';
  if (steps.every((s) => s.status === 'not_reached')) return 'not_reached';
  return has('upcoming') ? 'upcoming' : 'done';
}
