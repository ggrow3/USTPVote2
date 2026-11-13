import {
  absoluteUrl,
  BILL_TOPIC_LABELS,
  BILL_TOPICS,
  memberLabel,
  memberTag,
  VOTE_CAST_LABELS,
  type BillTopic,
  type PartyPosition,
  type PublicBillCard,
  type ScorecardRow,
  type Shareable,
  type VoteOutcome,
} from 'ustp-domain';

/** Wording for the public Legislation page and scorecard (design §5.14, "Legislation and the scorecard"). */

export const TOPIC_OPTIONS: readonly { readonly label: string; readonly value: BillTopic | null }[] = [
  { label: 'All topics', value: null },
  ...BILL_TOPICS.map((t) => ({ label: BILL_TOPIC_LABELS[t], value: t })),
];

/** Each topic's chip colour (white text on each passes 4.5:1). */
export const TOPIC_COLORS: Readonly<Record<BillTopic, string>> = { science: 'teal-9', ai: 'deep-purple-8', longevity: 'green-9' };

export const OUTCOME_LABELS: Readonly<Record<VoteOutcome, string>> = {
  with: 'With the party',
  against: 'Against the party',
  missed: 'Did not vote yea or nay',
  unscored: 'Not scored',
};

export const OUTCOME_COLORS: Readonly<Record<VoteOutcome, string>> = { with: 'green-9', against: 'red-9', missed: 'grey-8', unscored: 'blue-grey-7' };

/** The choices for the party's position on a roll call, in the team's panel. */
export const POSITION_OPTIONS: readonly { readonly label: string; readonly value: PartyPosition | null }[] = [
  { label: 'No position (shown, not scored)', value: null },
  { label: 'Yea', value: 'yea' },
  { label: 'Nay', value: 'nay' },
];

/** "The party's position: Yea", or that it took none. */
export function positionLine(position: PartyPosition | null): string {
  return position ? `The party’s position: ${VOTE_CAST_LABELS[position]}` : 'The party took no position on this vote, so it is not scored';
}

/** "80%", or a dash when nothing of theirs is scored. */
export function scorePercent(score: number | null): string {
  return score === null ? '–' : `${Math.round(score * 100)}%`;
}

/**
 * The text colour of a score: green from three in four with the party, red under two in five, orange between, grey for
 * none. Each is one the app keeps at 4.5:1 in both themes (app.css).
 */
export function scoreColor(score: number | null): string {
  if (score === null) return 'grey-7';
  if (score >= 0.75) return 'positive';
  if (score >= 0.4) return 'deep-orange-10';
  return 'negative';
}

/** What a bill's share buttons share: the team's summary, or its title, and its public page. */
export function billShareable(bill: Pick<PublicBillCard, 'id' | 'label' | 'title' | 'summary'>, origin = location.origin): Shareable {
  const title = `${bill.label}: ${bill.title}`;
  return { text: bill.summary || title, url: absoluteUrl(`/legislation/${encodeURIComponent(bill.id)}`, origin), hashtags: [], title };
}

/** What a member's share buttons share: their score on the bills, and their scorecard page. */
export function memberShareable(row: ScorecardRow, origin = location.origin): Shareable {
  const who = `${memberLabel(row)} (${memberTag(row)})`;
  return {
    text:
      row.score === null
        ? `${who} on the science, AI and longevity bills the U.S. Transhumanist Party follows.`
        : `${who} voted with the U.S. Transhumanist Party’s position on ${row.with} of ${row.with + row.against} scored votes on science, AI and longevity bills.`,
    url: absoluteUrl(`/scorecard/${encodeURIComponent(row.memberId)}`, origin),
    hashtags: [],
    title: `${who}: scorecard`,
  };
}

/** The scorecard's rows matching a search of names, a state and a chamber. */
export function filterRows<T extends Pick<ScorecardRow, 'name' | 'state' | 'chamber'>>(rows: readonly T[], words: string, state: string | null, chamber: 'house' | 'senate' | null): T[] {
  const wanted = words.trim().toLocaleLowerCase('en');
  return rows.filter(
    (r) => (!state || r.state === state) && (!chamber || r.chamber === chamber) && (!wanted || r.name.toLocaleLowerCase('en').includes(wanted)),
  );
}
