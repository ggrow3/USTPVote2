import type { ElectionDetail } from 'ustp-domain';

/** Wording for Admin → Testing's demo elections (design §10.4). */

/** "10 minutes", "1 hour", "2 hours", "1 day". */
export function votingLength(minutes: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

/** What a demo holds: "3 offices, a committee and 1 ballot measure · secret ballot · 5 test voters". */
export function demoSummary(detail: Pick<ElectionDetail, 'election' | 'contests' | 'roll'>): string {
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const committees = detail.contests.filter((c) => c.spec.kind === 'choose_n' && c.spec.seats > 1).length;
  const measures = detail.contests.filter((c) => c.spec.kind === 'proposal').length;
  const offices = detail.contests.length - committees - measures;
  const parts = [count(offices, 'office'), ...(committees ? [count(committees, 'committee')] : []), ...(measures ? [count(measures, 'ballot measure')] : [])];
  const contents = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]!;
  const ballot = detail.election.secrecy === 'secret' ? 'secret ballot' : 'roll-call ballot';
  return [contents, ballot, count(detail.roll?.count ?? 0, 'test voter')].join(' · ');
}

/** "Voting opens at 4:31 PM and closes at 4:46 PM." in the browser's time zone, with the day when it is not today. */
export function demoWindow(election: Pick<ElectionDetail['election'], 'opensAt' | 'closesAt'>, now: Date = new Date()): string {
  const at = (iso: string) => {
    const date = new Date(iso);
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return date.toDateString() === now.toDateString() ? time : `${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
  };
  return `Voting opens at ${at(election.opensAt)} and closes at ${at(election.closesAt)}.`;
}
