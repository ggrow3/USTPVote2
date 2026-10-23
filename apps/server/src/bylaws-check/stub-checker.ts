import { splitLines, type BylawsFinding } from 'ustp-domain';
import { tidyFindings, type BylawsChecker, type BylawsCheckInput, type BylawsCheckOutput } from './checker.js';
import { ReferenceLibrary } from './references.js';

type Rule = Omit<BylawsFinding, 'lines' | 'explanation'> & { readonly pattern: RegExp; readonly why: string };

/** Phrases the stand-in flags, so the check can be exercised without Anthropic. Not a review of anything. */
export const STUB_RULES: readonly Rule[] = [
  {
    pattern: /\breligious test\b|\bprofess (?:a|any) (?:faith|religion)\b/i,
    source: 'us-constitution',
    provision: 'Article VI and Amendment I',
    severity: 'medium',
    why: 'a religious requirement',
  },
  {
    pattern: /\b(?:ban|bans|prohibit|prohibits|oppose|opposes)\b.{0,60}\b(?:life extension|longevity|anti-aging)\b/i,
    source: 'transhumanist-principles',
    provision: 'USTP Constitution, Article I, Section I, Ideal 1',
    severity: 'high',
    why: 'opposition to life extension',
  },
  {
    pattern: /\bwithout (?:a )?(?:vote|ballot) of the members\b/i,
    source: 'ustp-constitution',
    provision: 'Article V (Amendments)',
    severity: 'medium',
    why: 'acting without a vote of the members',
  },
];

/**
 * Emulator-only stand-in for Claude (there is no Anthropic emulator): flags the lines that contain one of
 * {@link STUB_RULES}' phrases, deterministically and offline. The server refuses to use it outside the emulators.
 */
export class StubBylawsChecker implements BylawsChecker {
  readonly name = 'stub';

  async check(input: BylawsCheckInput): Promise<BylawsCheckOutput> {
    const lines = splitLines(input.text);
    const findings: BylawsFinding[] = [];
    lines.forEach((text, i) => {
      for (const rule of STUB_RULES) {
        const match = rule.pattern.exec(text);
        if (!match) continue;
        const { pattern: _, why, ...finding } = rule;
        findings.push({
          ...finding,
          lines: [i + 1],
          explanation: `Local stand-in, not a review: the words “${match[0]}” suggest ${why}, which this stand-in always flags.`,
        });
      }
    });
    const tidy = tidyFindings(findings, lines.length, input.focusLines);
    return {
      findings: tidy,
      summary: `The local stand-in looked for ${STUB_RULES.length} test phrases and made ${tidy.length} ${tidy.length === 1 ? 'finding' : 'findings'}. It is not an AI review.`,
      references: ReferenceLibrary.unread(),
      model: null,
      usage: null,
    };
  }
}
