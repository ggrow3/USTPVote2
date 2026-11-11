/**
 * The queue of applications waiting for a Membership Admin (design §5.2): how many, and how long the oldest has
 * waited, so the time to a decision does not become what keeps people out.
 */

/** An application that has waited this many days or more is marked as waiting long. */
export const APPLICATION_WAIT_WARNING_DAYS = 3;

/** `GET /v1/admin/applications/summary` */
export interface ApplicationQueueSummary {
  /** Applications waiting for a decision. */
  readonly pending: number;
  /** When the one waiting longest was submitted; null when none waits. */
  readonly oldestSubmittedAt: string | null;
}

const DAY_MS = 86_400_000;

/** Whole days since it was submitted, never negative. */
export function waitingDays(submittedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(submittedAt)) / DAY_MS));
}

/** "less than a day", "1 day", "5 days". */
export function waitText(days: number): string {
  return days < 1 ? 'less than a day' : days === 1 ? '1 day' : `${days} days`;
}

export function waitsLong(submittedAt: string, now: Date): boolean {
  return waitingDays(submittedAt, now) >= APPLICATION_WAIT_WARNING_DAYS;
}

/** "3 applications waiting, the oldest for 5 days." */
export function queueSummaryText(summary: ApplicationQueueSummary, now: Date): string {
  if (!summary.pending || !summary.oldestSubmittedAt) return 'No applications are waiting.';
  const oldest = waitText(waitingDays(summary.oldestSubmittedAt, now));
  return summary.pending === 1 ? `1 application waiting, for ${oldest}.` : `${summary.pending} applications waiting, the oldest for ${oldest}.`;
}

/** The count as a badge shows it: capped so it fits. */
export function queueBadge(pending: number): string {
  return pending > 99 ? '99+' : String(pending);
}
