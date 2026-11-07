import type { Secrecy, VoterElection } from 'ustp-domain';

/**
 * The voter's ballot list and ballot page in words (design §10.5): short dates, what the election's state means for
 * them, and what they can do next.
 */

/** Where and when dates are shown: the browser's own language and time zone unless given (the tests give both). */
export interface DateOptions {
  readonly now?: Date;
  readonly locale?: string;
  readonly timeZone?: string;
}

const yearOf = (at: Date, timeZone?: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(at);

/** "Oct 25, 3:30 PM", with the year only when one of `dates` is in another year than now. */
function formatter(dates: readonly Date[], { now = new Date(), locale, timeZone }: DateOptions): Intl.DateTimeFormat {
  const thisYear = yearOf(now, timeZone);
  const withYear = dates.some((d) => yearOf(d, timeZone) !== thisYear);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(withYear && { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
}

/** The parts as text, a time kept on one line with its AM or PM (browsers put an ordinary space between them). */
const joined = (parts: readonly Intl.DateTimeFormatPart[]) =>
  parts.map((p, i) => (p.type === 'literal' && parts[i + 1]?.type === 'dayPeriod' ? p.value.replace(/\s/g, ' ') : p.value)).join('');

/** A moment, short: "Oct 26, 4:01 PM", or "Oct 26, 2025, 4:01 PM" in another year. */
export function shortWhen(iso: string, options: DateOptions = {}): string {
  const at = new Date(iso);
  return joined(formatter([at], options).formatToParts(at));
}

/** The voting window: "Voting Oct 25, 3:30 PM – Nov 15, 2:18 PM", or "Voting Oct 25, 3:30 – 5:00 PM" within a day. */
export function votingWindow(opensAt: string, closesAt: string, options: DateOptions = {}): string {
  const from = new Date(opensAt);
  const to = new Date(closesAt);
  return `Voting ${joined(formatter([from, to], options).formatRangeToParts(from, to))}`;
}

export function secrecyText(secrecy: Secrecy): string {
  return secrecy === 'secret' ? 'Secret ballot' : 'Roll-call: how you vote is published with your name';
}

/** Voting has closed: the vote is over for the voter, whether or not they took part. */
export const votingFinished = (e: Pick<VoterElection, 'state'>): boolean => e.state === 'closed' || e.state === 'certified';

/** The voter's elections apart: those still to come or under way as they were, and the finished, latest closed first. */
export function ballotLists(elections: readonly VoterElection[]): { current: VoterElection[]; finished: VoterElection[] } {
  return {
    current: elections.filter((e) => !votingFinished(e)),
    finished: elections.filter(votingFinished).sort((a, b) => b.closesAt.localeCompare(a.closesAt)),
  };
}

const SHOW_FINISHED_KEY = 'ustp-ballots-show-finished';

/** Whether finished votes are shown on the list: hidden until someone shows them, then their choice, kept in this browser. */
export function finishedVotesShown(): boolean {
  try {
    return localStorage.getItem(SHOW_FINISHED_KEY) === 'true';
  } catch {
    return false; // storage blocked: the default applies
  }
}

export function rememberFinishedVotesShown(shown: boolean): void {
  try {
    localStorage.setItem(SHOW_FINISHED_KEY, String(shown));
  } catch {
    // storage blocked: the choice lasts until the page is left
  }
}

export interface BallotAction {
  readonly label: string;
  readonly to: string;
  /** Filled rather than outlined: the one thing to do now, which is to vote. */
  readonly main: boolean;
}

export interface BallotCard {
  /** Whether the voter has voted and whether voting is open, in words. */
  readonly status: string;
  /** Material icon beside the status. */
  readonly icon: string;
  /** Quasar text colour of the status; each passes 4.5:1 on the card in both themes (app.css). */
  readonly tone: 'positive' | 'primary' | 'grey-7';
  /** The main action first. */
  readonly actions: readonly BallotAction[];
}

/** One election on the ballot list: where the voter stands and what they can do. */
export function ballotCard(e: VoterElection, options: DateOptions = {}): BallotCard {
  const ballot = `/ballot/${e.electionId}`;
  const results = `/results/${e.electionId}`;
  const actions: BallotAction[] = votingFinished(e)
    ? [
        { label: 'See results', to: results, main: false },
        { label: e.castAt ? 'View your ballot' : 'Read the ballot', to: ballot, main: false },
      ]
    : e.state === 'open' && !e.castAt
      ? [{ label: 'Vote now', to: ballot, main: true }]
      : [{ label: e.castAt ? 'View your ballot' : 'Read the ballot', to: ballot, main: false }];
  if (e.castAt) return { status: `You voted on ${shortWhen(e.castAt, options)}.`, icon: 'check_circle', tone: 'positive', actions };
  switch (e.state) {
    case 'open':
      return { status: 'Voting is open. You have not voted yet.', icon: 'how_to_vote', tone: 'primary', actions };
    case 'scheduled':
      return { status: 'Voting has not opened yet. You can read the ballot now.', icon: 'schedule', tone: 'grey-7', actions };
    case 'certified':
      return { status: 'Voting has closed and the results are certified.', icon: 'verified', tone: 'grey-7', actions };
    default:
      return { status: 'Voting has closed.', icon: 'lock', tone: 'grey-7', actions };
  }
}
