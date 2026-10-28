import { rulesText, splitLines, type ElectionFinding } from 'ustp-domain';
import { tidyElectionFindings, type ElectionChecker, type ElectionCheckInput, type ElectionCheckOutput } from './checker.js';

const TWO_THIRDS = /\btwo[- ]thirds\b/i;
const QUORUM = /\bquorum\b/i;

/**
 * Emulator-only stand-in for Claude (there is no Anthropic emulator), deterministic and offline: notes a proposal that
 * passes with less than two-thirds when a bylaws line mentions "two-thirds", and a proposal with no quorum when a line
 * mentions "quorum". Not a review of anything; the server refuses to use it outside the emulators.
 */
export class StubElectionChecker implements ElectionChecker {
  readonly name = 'stub';

  async check(input: ElectionCheckInput): Promise<ElectionCheckOutput> {
    const lines = splitLines(input.bylaws.text);
    const lineOf = (pattern: RegExp) => lines.findIndex((l) => pattern.test(l)) + 1;
    const twoThirds = lineOf(TWO_THIRDS);
    const quorum = lineOf(QUORUM);
    const findings: ElectionFinding[] = [];
    for (const c of input.definition.contests) {
      if (c.spec.kind !== 'proposal') continue;
      const { ratio } = c.spec.passRule.threshold;
      if (twoThirds && ratio.num * 3 < ratio.den * 2) {
        findings.push({
          contestId: c.contestId,
          bylawsLines: [twoThirds],
          topic: 'pass-threshold',
          severity: 'medium',
          explanation: `Local stand-in, not a review: bylaws line ${twoThirds} mentions two-thirds, and this proposal ${rulesText(c.spec)[0]!.toLowerCase().replace(/\.$/, '')}.`,
        });
      }
      if (quorum && !c.spec.quorum?.minBallots && !c.spec.quorum?.rollRatio) {
        findings.push({
          contestId: c.contestId,
          bylawsLines: [quorum],
          topic: 'quorum',
          severity: 'low',
          explanation: `Local stand-in, not a review: bylaws line ${quorum} mentions a quorum, and this proposal has none.`,
        });
      }
    }
    const tidy = tidyElectionFindings(findings, lines.length, input.definition);
    return {
      findings: tidy,
      summary: `The local stand-in compared the proposals with two test phrases and made ${tidy.length} ${tidy.length === 1 ? 'note' : 'notes'}. It is not an AI review.`,
      model: null,
      usage: null,
    };
  }
}
