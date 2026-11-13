import type { StepStatus } from '../election-progress.js';
import type { ElectionRecord } from '../elections.js';
import { DEFAULT_NOTICE_SETTINGS } from './notice-settings.js';
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
 * Why an email will not come: `all_off` (a System Admin switched all the site's email off), `off` (a System Admin
 * switched this one off), `not_set_up` (the deployment sends no email),
 * `no_contact` (no contact for questions is set, so nothing is mailed), `rehearsal` (a rehearsal outside testing
 * mode), `short_window` (voting is open no longer than the reminder's lead time), `closed` (voting ended first).
 */
export type NoticeAbsence = 'all_off' | 'off' | 'not_set_up' | 'no_contact' | 'rehearsal' | 'short_window' | 'closed';

/**
 * The election emails' place in the election editor's workflow (design §6.1, §6.8): for each, whether it has gone, is
 * going, is still to come or will not come, and why not, read from the notices' counts, the settings and the election
 * alone, never from who they went to. The workflow shows them beside the lifecycle's steps; they never hold the
 * election up.
 */
export interface NoticeStep {
  readonly kind: NoticeKind;
  /** `done` sent (whatever the counts say), `current` sending or due now, `upcoming`, or `not_reached`. */
  readonly status: StepStatus;
  /** The notice once the worker has started it; null before. */
  readonly notice: NoticeSummary | null;
  /** Why it will not come; null when it has gone or still can. */
  readonly absent: NoticeAbsence | null;
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
  const settings = view?.settings ?? DEFAULT_NOTICE_SETTINGS;
  const hours = settings.reminderHours;
  const delivery = noticeDelivery({ rehearsal: input.rehearsal, testingMode: input.testingMode, transport: view?.delivery ?? 'mail' });
  return NOTICE_KINDS.map((kind): NoticeStep => {
    const notice = view?.notices.find((n) => n.kind === kind) ?? null;
    if (notice) return { kind, status: notice.status === 'done' ? 'done' : 'current', notice, absent: null };
    const absent: NoticeAbsence | null = !delivery
      ? input.rehearsal
        ? 'rehearsal'
        : 'not_set_up'
      : view && !input.rehearsal && !settings.allEmails
        ? 'all_off'
        : !settings.kinds[kind].enabled
          ? 'off'
          : delivery === 'mail' && view && !view.contact
            ? 'no_contact'
            : kind === 'closing_soon' && !hasReminder(election, hours)
              ? 'short_window'
              : null;
    if (absent) return { kind, status: 'not_reached', notice: null, absent };
    if (election.state === 'draft' || election.state === 'scheduled') return { kind, status: 'upcoming', notice: null, absent: null };
    const due = kind === 'closing_soon' ? isReminderDue(election, now, hours) : isVotingOpen(election, now);
    if (due) return { kind, status: 'current', notice: null, absent: null };
    return kind === 'closing_soon' && isVotingOpen(election, now)
      ? { kind, status: 'upcoming', notice: null, absent: null }
      : { kind, status: 'not_reached', notice: null, absent: 'closed' };
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
