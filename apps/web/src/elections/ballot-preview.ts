import { buildDefinition, definitionHash, type BallotView, type ElectionDetail } from 'ustp-domain';

/**
 * The ballot as voters will get it (design §6.5, "Preview as voter"): the definition the draft would freeze if it were
 * scheduled now, built as the api builds it, with the proposal texts it names, shown as open and not yet voted in, so
 * the ballot page draws every question with its controls. It is the editor's view of the draft: nothing is published
 * and nothing can be cast from it.
 */
export function previewBallotView(detail: ElectionDetail): BallotView {
  const { election, contests, candidates, proposals } = detail;
  const definition = buildDefinition(election, contests, candidates, proposals);
  return {
    election: {
      electionId: election.electionId,
      title: election.title,
      description: election.description,
      secrecy: election.secrecy,
      state: 'open',
      opensAt: election.opensAt,
      closesAt: election.closesAt,
      castAt: null,
    },
    definition,
    definitionHash: definitionHash(definition),
    proposals: proposals.map((p) => ({ snapshotId: p.snapshotId, title: p.title, body: p.body, contentHash: p.contentHash, amendment: p.amendment ?? null })),
  };
}
