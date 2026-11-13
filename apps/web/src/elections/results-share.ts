import { absoluteUrl, percent, type ResultsSynopsis, type Shareable } from 'ustp-domain';

/**
 * What a finished election's share buttons share (design §10.16, "Result cards"): its status and outcome in one
 * line, and its results page here, whose link preview carries the result card. A rehearsal says so.
 */
export function resultsShareable(synopsis: ResultsSynopsis, rehearsal: boolean, origin = location.origin): Shareable {
  const status = synopsis.certifiedAt ? 'Certified' : 'Provisional';
  const { proposals, candidateContests } = synopsis.tally;
  const outcome = [
    proposals.total ? `${proposals.passed} of ${proposals.total} ${proposals.total === 1 ? 'proposal' : 'proposals'} passed` : null,
    candidateContests.total ? `${candidateContests.elected} of ${candidateContests.seats} ${candidateContests.seats === 1 ? 'seat' : 'seats'} filled` : null,
  ].filter(Boolean);
  const turnout = percent(synopsis.turnout, 0);
  const text = [
    `${rehearsal ? 'Rehearsal: ' : ''}${status} results of ${synopsis.title}${outcome.length ? `: ${outcome.join(', ')}` : ''}${turnout ? ` (${turnout} turnout)` : ''}.`,
    'Anyone can verify them from the published record.',
  ].join(' ');
  return {
    text,
    url: absoluteUrl(`/results/${encodeURIComponent(synopsis.electionId)}`, origin),
    hashtags: rehearsal ? [] : ['USTP'],
    title: `Results: ${synopsis.title}`,
  };
}
