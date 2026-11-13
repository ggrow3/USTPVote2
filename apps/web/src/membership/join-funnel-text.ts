import type { JoinFunnelReport, JoinFunnelStep } from 'ustp-domain';

/** The words of the join funnel card (design §5.15). */

/** A step's count as a share of the accounts made, 0 to 1, for its bar. */
export function stepShare(report: JoinFunnelReport, step: JoinFunnelStep): number {
  const accounts = report.steps[0]?.count ?? 0;
  return accounts > 0 ? step.count / accounts : 0;
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** Where the most people stopped. */
export function dropText(drop: { readonly step: JoinFunnelStep; readonly lost: number }): string {
  const before: Record<JoinFunnelStep['id'], string> = {
    account: '',
    verified: 'before verifying their email',
    applied: 'after verifying their email, before applying',
    approved: 'after applying, before being approved',
    active: 'after being approved, before doing anything as a member',
  };
  return `Most people stop ${before[drop.step.id]}: ${people(drop.lost)}.`;
}

/** How applications are being decided: how many wait and for how long, and the usual time to a decision. */
export function waitingText(report: JoinFunnelReport): string {
  const parts: string[] = [];
  if (report.waiting === 0) parts.push('No application from the period is waiting.');
  else {
    const oldest = report.oldestWaitingDays ?? 0;
    parts.push(
      `${report.waiting} ${report.waiting === 1 ? 'application is' : 'applications are'} waiting, the oldest for ${
        oldest === 0 ? 'less than a day' : oldest === 1 ? '1 day' : `${oldest} days`
      }.`,
    );
  }
  if (report.rejected) parts.push(`${report.rejected} rejected.`);
  if (report.medianDaysToDecision !== null) {
    const days = report.medianDaysToDecision;
    parts.push(`A decision usually takes ${days < 1 ? 'less than a day' : days === 1 ? '1 day' : `${days} days`}.`);
  }
  return parts.join(' ');
}
