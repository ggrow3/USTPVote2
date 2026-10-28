import type { ProposalContest, TieBreakRecord } from 'ustp-tally';

/**
 * Plain-language descriptions of contest rules (design §9), so admins and voters see what a rule means. The rules' own
 * wording lives in `ustp-domain`, which the election setup check's request to Claude uses too (§6.9).
 */
export { KIND_LABELS, ratioText, rulesText, thresholdText } from 'ustp-domain';

/** An election's title as it goes into file names: `2026 Officer Election!` → `2026-officer-election`. */
export function electionSlug(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || 'election'
  );
}

/** A file's date, YYYY-MM-DD, in `timeZone` (the browser's when left out). */
export function fileDate(at: Date, timeZone?: string): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** A tie and how it was broken (design §9), in words; `names` turns candidate IDs into a list of names. */
export function tieBreakText(t: TieBreakRecord, names: (ids: readonly string[]) => string): string {
  const where = t.reason === 'seat_cutoff' ? 'for the last seat' : `for last place in round ${t.round}`;
  const how = t.resolvedBy === 'previous_rounds' ? 'by the earlier rounds’ counts' : 'by the tie-break order drawn from the election’s seed';
  const lost = t.reason === 'seat_cutoff' ? 'not elected' : 'eliminated';
  return `${names(t.tied)} tied ${where}; resolved ${how}: ${names(t.excluded)} ${lost}.`;
}

export interface PassRulePreset {
  readonly label: string;
  readonly value: ProposalContest['passRule'];
}

export const PASS_RULE_PRESETS: readonly PassRulePreset[] = [
  {
    label: 'Simple majority of yes + no',
    value: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' },
  },
  {
    label: 'Two-thirds of yes + no',
    value: { threshold: { ratio: { num: 2, den: 3 }, comparison: 'gte' }, base: 'yes_no' },
  },
  {
    label: 'Majority of all votes (abstentions count against)',
    value: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no_abstain' },
  },
  {
    label: 'Majority of the whole voter roll',
    value: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'roll' },
  },
];

/** `datetime-local` input value (local time) ↔ ISO 8601 UTC. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
