/**
 * The join funnel (design §5.15): of the people who made an account in a period, how many went on to verify their
 * email, apply, be approved and then do one thing as a member, so Membership Admins can see where people stop. Counts
 * only: the report names nobody. Made on request from records that exist anyway; nothing is stored for it.
 */

/** The periods the report can cover, in days back from today (UTC). */
export const JOIN_FUNNEL_PERIODS = [7, 30, 90, 180, 365] as const;

/** At most this many of the period's accounts are read, oldest first; a longer period is reported as cut short. */
export const JOIN_FUNNEL_MAX_ACCOUNTS = 2000;

/** What a new member can do first, each from a record that says they did. */
export const FIRST_STEPS = ['voted', 'course', 'team', 'room', 'posted'] as const;
export type FirstStep = (typeof FIRST_STEPS)[number];

export const FIRST_STEP_LABELS: Readonly<Record<FirstStep, string>> = {
  voted: 'Cast a ballot',
  course: 'Started a course',
  team: 'Joined a team',
  room: "Entered the members' room",
  posted: 'Posted in the forum',
};

/** One account made in the period, as the funnel sees it. No name: the report is counts. */
export interface JoinFunnelPerson {
  readonly createdAt: string;
  readonly emailVerified: boolean;
  /** Their first application in the period, or null. */
  readonly appliedAt: string | null;
  /** Approved if any application was; else pending if one waits; else rejected; null with no application. */
  readonly decision: 'pending' | 'approved' | 'rejected' | null;
  /** When the application that settled `decision` was decided; null while pending. */
  readonly decidedAt: string | null;
  /** What they have done since, read only for the approved. */
  readonly did: readonly FirstStep[];
}

export const JOIN_FUNNEL_STEPS = ['account', 'verified', 'applied', 'approved', 'active'] as const;
export type JoinFunnelStepId = (typeof JOIN_FUNNEL_STEPS)[number];

export const JOIN_FUNNEL_STEP_LABELS: Readonly<Record<JoinFunnelStepId, string>> = {
  account: 'Made an account',
  verified: 'Verified their email',
  applied: 'Applied to join',
  approved: 'Approved as a member',
  active: 'Did one thing as a member',
};

export interface JoinFunnelStep {
  readonly id: JoinFunnelStepId;
  readonly label: string;
  /** People who reached this step. Each step is counted among those who reached the one before. */
  readonly count: number;
  /** Whole percent of the step before; null for the first step, and when nobody reached the step before. */
  readonly ofPrevious: number | null;
}

/** `GET /v1/admin/join-funnel?days=` */
export interface JoinFunnelReport {
  readonly days: number;
  /** The first UTC day of the period, `YYYY-MM-DD`. */
  readonly from: string;
  /**
   * Times the Register page was opened in the period, and how many of those by someone signed in to an account
   * (design §10.7). Page opens, not people: one person may open it many times.
   */
  readonly registerOpens: number;
  readonly registerOpensSignedIn: number;
  readonly steps: readonly JoinFunnelStep[];
  /** Of the period's applicants: still waiting for a decision, and rejected. */
  readonly waiting: number;
  readonly rejected: number;
  /** Whole days the longest-waiting of them has waited; null when none waits. */
  readonly oldestWaitingDays: number | null;
  /** The median time from applying to a decision, in days to one decimal place; null with no decisions. */
  readonly medianDaysToDecision: number | null;
  /** Of the approved, how many did each thing. One person may have done several. */
  readonly firstSteps: Readonly<Record<FirstStep, number>>;
  /** More accounts were made in the period than `JOIN_FUNNEL_MAX_ACCOUNTS`; the newest are left out. */
  readonly truncated: boolean;
}

const DAY_MS = 86_400_000;
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The report from the period's accounts (any order) and the Register page's opens. */
export function joinFunnelReport(input: {
  readonly days: number;
  readonly from: string;
  readonly now: string;
  readonly registerOpens: number;
  readonly registerOpensSignedIn: number;
  readonly people: readonly JoinFunnelPerson[];
  readonly truncated: boolean;
}): JoinFunnelReport {
  const { people } = input;
  // Applying needs a verified address, so an applicant counts as verified even if the flag has not caught up.
  const verified = people.filter((p) => p.emailVerified || p.appliedAt !== null);
  const applied = verified.filter((p) => p.appliedAt !== null);
  const approved = applied.filter((p) => p.decision === 'approved');
  const active = approved.filter((p) => p.did.length > 0);
  const counts: Record<JoinFunnelStepId, number> = {
    account: people.length,
    verified: verified.length,
    applied: applied.length,
    approved: approved.length,
    active: active.length,
  };
  const steps = JOIN_FUNNEL_STEPS.map((id, i) => ({
    id,
    label: JOIN_FUNNEL_STEP_LABELS[id],
    count: counts[id],
    ofPrevious: i === 0 ? null : percent(counts[id], counts[JOIN_FUNNEL_STEPS[i - 1]!]),
  }));
  const now = Date.parse(input.now);
  const waiting = applied.filter((p) => p.decision === 'pending');
  const waits = waiting.map((p) => Math.floor((now - Date.parse(p.appliedAt!)) / DAY_MS));
  const decisionDays = applied
    .filter((p) => p.decidedAt !== null)
    .map((p) => (Date.parse(p.decidedAt!) - Date.parse(p.appliedAt!)) / DAY_MS)
    .filter((d) => d >= 0);
  const mid = median(decisionDays);
  return {
    days: input.days,
    from: input.from,
    registerOpens: input.registerOpens,
    registerOpensSignedIn: input.registerOpensSignedIn,
    steps,
    waiting: waiting.length,
    rejected: applied.filter((p) => p.decision === 'rejected').length,
    oldestWaitingDays: waits.length ? Math.max(0, ...waits) : null,
    medianDaysToDecision: mid === null ? null : Math.round(mid * 10) / 10,
    firstSteps: Object.fromEntries(FIRST_STEPS.map((step) => [step, approved.filter((p) => p.did.includes(step)).length])) as Record<
      FirstStep,
      number
    >,
    truncated: input.truncated,
  };
}

/** Where the most people stop: the step with the largest loss from the one before, or null when nobody was lost. */
export function biggestDrop(report: JoinFunnelReport): { readonly step: JoinFunnelStep; readonly lost: number } | null {
  let worst: { step: JoinFunnelStep; lost: number } | null = null;
  for (let i = 1; i < report.steps.length; i++) {
    const step = report.steps[i]!;
    const lost = report.steps[i - 1]!.count - step.count;
    if (lost > 0 && (!worst || lost > worst.lost)) worst = { step, lost };
  }
  return worst;
}
