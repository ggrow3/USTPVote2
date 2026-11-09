import { Injectable } from '@nestjs/common';
import { isRehearsalRoll, percent, resultsSynopsis, type CardBar, type ContestSynopsis, type LinkPreview, type ResultsSynopsis } from 'ustp-domain';
import { orNone, type LinkPreviewSource } from '../link-previews/link-previews.js';
import { PublicElectionsService } from './public-elections.service.js';

const OUTCOMES = { passed: 'Passed', failed: 'Failed', no_quorum: 'No quorum' } as const;

const ratio = (s: { part: number; whole: number }) => (s.whole > 0 ? s.part / s.whole : 0);

/**
 * One bar per contest: a proposal's yes share and outcome; a candidate contest's first winner and their share. A
 * single candidate contest is drawn as its candidates instead.
 */
export function resultBars(synopsis: Pick<ResultsSynopsis, 'contests'>): CardBar[] {
  const { contests } = synopsis;
  const only = contests.length === 1 ? contests[0]! : null;
  if (only?.kind === 'choose_n') {
    return only.candidates.slice(0, 4).map((c) => ({ label: c.name, value: percent(c.votes) ?? '–', share: ratio(c.votes), highlight: c.elected }));
  }
  return contests.map((contest: ContestSynopsis): CardBar => {
    switch (contest.kind) {
      case 'proposal':
        return {
          label: contest.title,
          value: `${OUTCOMES[contest.outcome]}${percent(contest.yesShare, 0) ? ` · ${percent(contest.yesShare, 0)}` : ''}`,
          share: ratio(contest.yesShare),
          highlight: contest.outcome === 'passed',
        };
      case 'choose_n': {
        const elected = contest.candidates.filter((c) => c.elected);
        const top = elected[0] ?? contest.candidates[0];
        return {
          label: elected.length ? `${contest.title}: ${elected.map((c) => c.name).join(', ')}` : `${contest.title}: no one elected`,
          value: top ? (percent(top.votes) ?? '–') : '–',
          share: top ? ratio(top.votes) : 0,
          highlight: elected.length > 0,
        };
      }
      case 'irv':
        return {
          label: contest.winner ? `${contest.title}: ${contest.winner.name}` : `${contest.title}: no one elected`,
          value: contest.winner ? (percent(contest.winner.finalRound) ?? '–') : '–',
          share: contest.winner ? ratio(contest.winner.finalRound) : 0,
          highlight: contest.winner !== null,
        };
    }
  });
}

/**
 * An election's results page's link preview (design §15, "Link previews"): once counted, its contests' outcomes as
 * bars, from the signed bundle anyone may read; before that, when it votes. A rehearsal says so.
 */
@Injectable()
export class ResultsPreviews implements LinkPreviewSource {
  readonly page = '/results/:id';

  constructor(private readonly elections: PublicElectionsService) {}

  async preview({ id }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const record = await orNone(this.elections.record(id!));
    if (!record) return null;
    const { election, definition, roll } = record;
    const rehearsal = isRehearsalRoll(roll?.criteria);
    const prefix = rehearsal ? 'Rehearsal · ' : '';
    const title = `Results: ${definition.title}`;
    const results = record.results ? await orNone(this.elections.results(id!)) : null;
    if (!results) {
      const when = election.state === 'cancelled' ? 'Cancelled' : election.state === 'scheduled' ? 'Voting opens soon' : election.state === 'open' ? 'Voting is open' : 'Counting';
      return {
        title,
        description: `${definition.title}, a U.S. Transhumanist Party election: ${when.toLowerCase()}. Its record is public, and anyone can verify it.`,
        card: { kicker: `${prefix}Election · ${when}`, title: definition.title, lines: ['Results are published once every ballot is sealed and counted'] },
      };
    }
    const synopsis = resultsSynopsis({ results, definition });
    const status = synopsis.certifiedAt ? 'Certified' : 'Provisional';
    const turnout = percent(synopsis.turnout);
    const { proposals, candidateContests } = synopsis.tally;
    const outcome = [
      proposals.total ? `${proposals.passed} of ${proposals.total} ${proposals.total === 1 ? 'proposal' : 'proposals'} passed` : null,
      candidateContests.total ? `${candidateContests.elected} of ${candidateContests.seats} ${candidateContests.seats === 1 ? 'seat' : 'seats'} filled` : null,
    ].filter(Boolean);
    return {
      title,
      description: `${status} results of ${definition.title}: ${synopsis.turnout.part} ${synopsis.turnout.part === 1 ? 'ballot' : 'ballots'} cast${turnout ? ` (${turnout} turnout)` : ''}${outcome.length ? `; ${outcome.join(', ')}` : ''}. Anyone can verify them from the published record.`,
      card: { kicker: `${prefix}Election results · ${status}`, title: definition.title, bars: resultBars(synopsis) },
    };
  }
}
