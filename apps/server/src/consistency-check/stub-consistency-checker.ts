import { contestText, tidyConsistencyFindings, type ConsistencyFinding } from 'ustp-domain';
import { ReferenceLibrary } from '../bylaws-check/references.js';
import type { ConsistencyChecker, ConsistencyCheckInput, ConsistencyCheckOutput } from './checker.js';

type Rule = Pick<ConsistencyFinding, 'source' | 'provision' | 'severity'> & { readonly pattern: RegExp; readonly why: string };

/** Phrases the stand-in flags in a question, so the check can be exercised without Anthropic. Not a review of anything. */
export const STUB_RULES: readonly Rule[] = [
  {
    pattern: /\b(?:ban|bans|prohibit|prohibits|oppose|opposes)\b.{0,60}\b(?:life extension|longevity|anti-aging)\b/i,
    source: 'platform',
    provision: 'Article VI',
    severity: 'high',
    why: 'opposition to life extension',
  },
  {
    pattern: /\bwithout (?:a )?(?:vote|ballot) of the members\b/i,
    source: 'constitution',
    provision: 'Article V (Amendments)',
    severity: 'medium',
    why: 'acting without a vote of the members',
  },
  {
    pattern: /\breplaces?\b/i,
    source: 'platform',
    provision: 'Article VI',
    severity: 'low',
    why: 'replacing something the party has adopted',
  },
];

/** "Section E9-A", "Section XXVII": a platform section a question names. */
const SECTION = /\bSection ([A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g;

/**
 * Emulator-only stand-in for Claude (there is no Anthropic emulator): flags the questions that contain one of
 * {@link STUB_RULES}' phrases, and questions that name the same platform section as each other, deterministically and
 * offline. The server refuses to use it outside the emulators.
 */
export class StubConsistencyChecker implements ConsistencyChecker {
  readonly name = 'stub';

  async check(input: ConsistencyCheckInput): Promise<ConsistencyCheckOutput> {
    const findings: ConsistencyFinding[] = [];
    const sections = new Map<string, number[]>();
    for (const contest of input.material) {
      const text = contestText(contest);
      for (const rule of STUB_RULES) {
        const match = rule.pattern.exec(text);
        if (!match) continue;
        const { pattern: _, why, ...finding } = rule;
        findings.push({
          ...finding,
          contests: [contest.position],
          passage: match[0],
          explanation: `Local stand-in, not a review: the words “${match[0]}” suggest ${why}, which this stand-in always flags.`,
        });
      }
      for (const [, section] of text.matchAll(SECTION)) {
        const named = sections.get(section!) ?? [];
        if (!named.includes(contest.position)) sections.set(section!, [...named, contest.position]);
      }
    }
    for (const [section, positions] of sections) {
      if (positions.length < 2) continue;
      findings.push({
        contests: positions,
        source: 'ballot',
        provision: input.material.find((c) => c.position === positions[1])!.title,
        passage: `Section ${section}`,
        severity: 'low',
        explanation: `Local stand-in, not a review: ${positions.length} questions name Section ${section}, so how one is decided may matter to the others.`,
      });
    }
    const tidy = tidyConsistencyFindings(findings, input.material);
    return {
      findings: tidy,
      summary: `The local stand-in looked for ${STUB_RULES.length} test phrases and for questions naming the same section, and made ${tidy.length} ${tidy.length === 1 ? 'finding' : 'findings'}. It is not an AI review.`,
      references: ReferenceLibrary.unread().filter((ref) => ref.id !== 'us-constitution'),
      model: null,
      usage: null,
    };
  }
}
