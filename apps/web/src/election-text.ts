import type { ContestSpec, ProposalContest, Ratio, Threshold, TieBreakRecord } from 'ustp-tally';

/** Plain-language descriptions of contest rules (design §9), so admins and voters see what a rule means. */

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

export const KIND_LABELS: Record<ContestSpec['kind'], string> = {
  proposal: 'Proposal (yes / no / abstain)',
  choose_n: 'Choose candidates',
  irv: 'Ranked choice (instant runoff)',
};

const NAMED: Record<string, string> = { '1/2': 'half', '2/3': 'two-thirds', '3/4': 'three-quarters', '3/5': 'three-fifths' };

export function ratioText(r: Ratio): string {
  return NAMED[`${r.num}/${r.den}`] ?? (r.den === 100 ? `${r.num}%` : `${r.num}/${r.den}`);
}

function thresholdText(t: Threshold): string {
  return `${t.comparison === 'gt' ? 'more than' : 'at least'} ${ratioText(t.ratio)}`;
}

const BASE_TEXT: Record<ProposalContest['passRule']['base'], string> = {
  yes_no: 'of yes + no votes (abstentions ignored)',
  yes_no_abstain: 'of all votes, abstentions counting against',
  roll: 'of everyone on the voter roll',
};

export function rulesText(spec: ContestSpec): string[] {
  switch (spec.kind) {
    case 'proposal': {
      const lines = [`Passes with ${thresholdText(spec.passRule.threshold)} ${BASE_TEXT[spec.passRule.base]}.`];
      const q = spec.quorum;
      if (q?.minBallots) lines.push(`Quorum: at least ${q.minBallots} ballots.`);
      if (q?.rollRatio) lines.push(`Quorum: at least ${ratioText(q.rollRatio)} of the roll must vote on it.`);
      return lines;
    }
    case 'choose_n': {
      const n = spec.candidates.length;
      const how =
        spec.seats === 1 && spec.maxSelections === 1
          ? 'Choose one (plurality).'
          : spec.maxSelections >= n && n > 0
            ? `Elect ${spec.seats}; voters approve as many as they like (approval).`
            : `Elect ${spec.seats}; voters choose up to ${spec.maxSelections}.`;
      const lines = [how];
      if (spec.supportFloor) lines.push(`A winner needs ${thresholdText(spec.supportFloor)} of the ballots in this contest.`);
      return lines;
    }
    case 'irv':
      return [
        'One winner. Voters rank candidates; the last-placed is eliminated round by round until someone has a majority.',
        ...(spec.maxRanks ? [`Voters may rank up to ${spec.maxRanks}.`] : []),
      ];
  }
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
