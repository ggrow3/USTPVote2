import {
  BILL_STATUS_LABELS,
  BILL_TYPE_LABELS,
  BILL_TYPE_NAMES,
  BILL_TYPES,
  FIRST_CONGRESS,
  ordinal,
  STAGE_LABELS,
  BILL_STAGES,
  type BillKeySource,
  type BillLatestAction,
  type BillSearchSort,
  type BillStatus,
  type BillWatchSort,
  type BillRecentSort,
} from 'ustp-domain';

/** Wording for the Bills page (design §5.14). */

/** "119th Congress (2025–2026)". */
export function congressOption(congress: number): string {
  const first = 1789 + (congress - 1) * 2;
  return `${ordinal(congress)} Congress (${first}–${first + 1})`;
}

/** The Congresses to pick from, newest first. */
export function congressOptions(latest: number): { label: string; value: number }[] {
  return Array.from({ length: latest - FIRST_CONGRESS + 1 }, (_, i) => latest - i).map((c) => ({ label: congressOption(c), value: c }));
}

export const TYPE_OPTIONS = [
  { label: 'Any type', value: null },
  ...BILL_TYPES.map((t) => ({ label: `${BILL_TYPE_LABELS[t]}: ${BILL_TYPE_NAMES[t]}`, value: t })),
];

export const STAGE_OPTIONS = [{ label: 'Any stage', value: null }, ...BILL_STAGES.map((s) => ({ label: STAGE_LABELS[s], value: s }))];

export const SEARCH_SORT_LABELS: Readonly<Record<BillSearchSort, string>> = {
  relevance: 'Best match',
  newest: 'Newest first',
  oldest: 'Oldest first',
  title: 'Title A–Z',
  title_desc: 'Title Z–A',
};

export const RECENT_SORT_LABELS: Readonly<Record<BillRecentSort, string>> = {
  updated: 'Latest update first',
  updated_oldest: 'Earliest update first',
};

export const WATCH_SORT_LABELS: Readonly<Record<BillWatchSort, string>> = {
  latest_action: 'Latest action first',
  added: 'Newest added first',
  number: 'Bill number',
  title: 'Title A–Z',
};

/** The colour of each status's chip: grey until it moves, then blue, green once law, red if vetoed. */
export const STATUS_COLORS: Readonly<Record<BillStatus, string>> = {
  introduced: 'grey-7',
  reported: 'blue-grey-7',
  passed_house: 'blue-8',
  passed_senate: 'blue-8',
  passed_both: 'indigo-8',
  to_president: 'deep-purple-8',
  vetoed: 'red-9',
  law: 'green-9',
};

export const statusLabel = (status: BillStatus) => BILL_STATUS_LABELS[status];

const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };

/** "24 Sept 2026" from a date or a timestamp; the date as given if it cannot be read. */
export function day(date: string | null | undefined, locale?: string): string {
  if (!date) return '';
  const parsed = new Date(date.length === 10 ? `${date}T00:00:00Z` : date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(locale, DAY);
}

/** "24 Sept 2026: Referred to the House Committee on …". */
export function latestActionLine(action: BillLatestAction | null, locale?: string): string {
  return action ? `${day(action.date, locale)}: ${action.text}` : 'No action recorded yet';
}

/** How many versions matched, as GovInfo counts them (a bill once per printed version). */
export function totalLine(total: number, shown: number): string {
  if (total === 0) return 'No bills match.';
  const versions = total === 1 ? '1 printed version matches' : `${total.toLocaleString('en-US')} printed versions match`;
  return `${versions}; ${shown === 1 ? 'one bill is' : `${shown} bills are`} on this page.`;
}

/** Which key the Bills page uses, for its foot and Admin › Bills. */
export function keySourceText(source: BillKeySource): string {
  switch (source) {
    case 'congress':
      return 'It uses the Congress.gov and GovInfo key added under Admin › API keys.';
    case 'fec':
      return 'It uses the FEC key (an api.data.gov key works for Congress.gov and GovInfo too). A key of its own can be added under Admin › API keys.';
    case 'demo':
      return 'No api.data.gov key is set, so it uses the shared demo key, which allows only 30 requests an hour: add a key under Admin › API keys.';
  }
}

/** The confirmation before a bill comes off the watchlist. */
export function unwatchConfirmText(label: string, notes: number): string {
  const lost = notes === 0 ? 'It has no notes.' : notes === 1 ? 'Its note is deleted with it.' : `Its ${notes} notes are deleted with it.`;
  return `${label} comes off the team’s watchlist for everyone. ${lost}`;
}

/** "Edited 3 Nov 2026" or nothing. */
export function editedLine(editedAt: string | null, locale?: string): string {
  return editedAt ? `edited ${day(editedAt, locale)}` : '';
}
