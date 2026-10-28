import type { ContestSpec, ProposalContest, Ratio, Threshold } from 'ustp-tally';

/**
 * Plain-language descriptions of contest rules (design §9), so admins and voters see what a rule means. The election
 * setup check (§6.9) gives Claude the same wording, so a note and the pages describe a rule alike.
 */

export const KIND_LABELS: Record<ContestSpec['kind'], string> = {
  proposal: 'Proposal (yes / no / abstain)',
  choose_n: 'Choose candidates',
  irv: 'Ranked choice (instant runoff)',
};

const NAMED: Record<string, string> = { '1/2': 'half', '2/3': 'two-thirds', '3/4': 'three-quarters', '3/5': 'three-fifths' };

export function ratioText(r: Ratio): string {
  return NAMED[`${r.num}/${r.den}`] ?? (r.den === 100 ? `${r.num}%` : `${r.num}/${r.den}`);
}

export function thresholdText(t: Threshold): string {
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
