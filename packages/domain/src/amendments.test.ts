import { sha256Hex } from 'ustp-audit';
import { describe, expect, it } from 'vitest';
import {
  amendingContests,
  amendmentConflicts,
  amendmentDiff,
  amendmentFromTexts,
  amendmentProblems,
  amendmentText,
  applyAmendment,
  applyAmendments,
  bylawsAmendmentSchema,
  type AmendmentChange,
  type BylawsAmendment,
} from './amendments.js';
import { splitLines } from './text-diff.js';

// Lines: 1 title, 2–3 Article I, 4–5 Article II, 6 the empty line after the final newline.
const text = 'USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\nArticle II. Membership.\nMembership is open to all.\n';
const base = { version: '2026.1', contentHash: sha256Hex(text), text };

function amend(...changes: AmendmentChange[]): BylawsAmendment {
  return bylawsAmendmentSchema.parse({ v: 1, base: { version: base.version, contentHash: base.contentHash }, changes });
}
const replace = (from: number, to: number, lines: string[]): AmendmentChange => ({
  op: 'replace',
  from,
  to,
  expect: splitLines(text).slice(from - 1, to),
  lines,
});
const insert = (after: number, lines: string[]): AmendmentChange => ({
  op: 'insert',
  after,
  anchor: after === 0 ? null : splitLines(text)[after - 1]!,
  lines,
});
const remove = (from: number, to: number): AmendmentChange => ({ op: 'delete', from, to, expect: splitLines(text).slice(from - 1, to) });
const applied = (...changes: AmendmentChange[]) => {
  const result = applyAmendment(base, amend(...changes));
  if (!result.ok) throw new Error(result.problems.join('; '));
  return result.text;
};
const issues = (value: unknown) => {
  const parsed = bylawsAmendmentSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};
const raw = (...changes: unknown[]) => ({ v: 1, base: { version: base.version, contentHash: base.contentHash }, changes });

describe('bylaws amendment format', () => {
  it('accepts replace, insert and delete changes running top to bottom', () => {
    expect(issues(raw(insert(0, ['Preamble.']), replace(3, 3, ['The party is the United States Transhumanist Party.']), remove(5, 5)))).toEqual([]);
  });

  it('refuses quotes that do not cover the range, ranges backwards, and anchors that do not fit', () => {
    expect(issues(raw({ op: 'replace', from: 2, to: 3, expect: ['Article I. Name.'], lines: ['x'] }))).toEqual([
      expect.stringMatching(/quote all 2 lines from 2 to 3/),
    ]);
    expect(issues(raw({ op: 'delete', from: 3, to: 2, expect: ['x'] }))).toEqual([expect.stringMatching(/`to` comes before `from`/)]);
    expect(issues(raw({ op: 'insert', after: 0, anchor: 'USTP Bylaws', lines: ['x'] }))).toEqual([expect.stringMatching(/null when inserting at the top/)]);
    expect(issues(raw({ op: 'insert', after: 2, anchor: null, lines: ['x'] }))).toEqual([expect.stringMatching(/quote line `after`/)]);
  });

  it('refuses changes out of order or overlapping, two inserts at one point, line breaks and trailing spaces', () => {
    expect(issues(raw(replace(4, 4, ['x']), replace(2, 2, ['y'])))).toEqual([expect.stringMatching(/top to bottom/)]);
    expect(issues(raw(replace(2, 4, ['x']), remove(4, 5)))).toEqual([expect.stringMatching(/overlaps the one before/)]);
    expect(issues(raw(insert(2, ['x']), insert(2, ['y'])))).toEqual([expect.stringMatching(/top to bottom/)]);
    expect(issues(raw(replace(2, 2, ['two\nlines'])))).toEqual([expect.stringMatching(/cannot contain a line break/)]);
    expect(issues(raw(replace(2, 2, ['trailing space '])))).toEqual([expect.stringMatching(/spaces at the end/)]);
  });

  it('allows an insert just before a change that starts at the same line', () => {
    expect(issues(raw(insert(2, ['x']), replace(3, 3, ['y'])))).toEqual([]);
  });
});

describe('applying one amendment', () => {
  it('replaces, inserts and deletes lines', () => {
    expect(applied(replace(5, 5, ['Membership is open to every adult.']))).toBe(
      'USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\nArticle II. Membership.\nMembership is open to every adult.\n',
    );
    expect(applied(insert(0, ['Adopted 2026.']))).toBe(`Adopted 2026.\n${text}`);
    expect(applied(insert(3, ['Its colours are orange and black.']))).toBe(
      'USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\nIts colours are orange and black.\nArticle II. Membership.\nMembership is open to all.\n',
    );
    expect(applied(insert(6, ['Article III. Officers.']))).toBe(`${text}\nArticle III. Officers.`);
    expect(applied(remove(4, 5))).toBe('USTP Bylaws\nArticle I. Name.\nThe party is the USTP.\n');
  });

  it('applies several changes at once, by base line numbers', () => {
    expect(applied(insert(0, ['Preamble.']), replace(3, 3, ['The party is the USTP (the Party).']), remove(5, 5), insert(6, ['End.']))).toBe(
      'Preamble.\nUSTP Bylaws\nArticle I. Name.\nThe party is the USTP (the Party).\nArticle II. Membership.\n\nEnd.',
    );
  });

  it('refuses another base version, a line past the end, and lines that no longer read as quoted', () => {
    const elsewhere = { ...base, version: '2026.2' };
    expect(applyAmendment(elsewhere, amend(replace(2, 2, ['x'])))).toEqual({
      ok: false,
      problems: ['the amendment amends version 2026.1, not version 2026.2'],
    });
    const short = { ...base, text: 'USTP Bylaws\nArticle I. Name.' };
    const tooFar = applyAmendment(short, amend(replace(5, 5, ['x']), insert(6, ['y'])));
    expect(tooFar).toEqual({ ok: false, problems: [expect.stringMatching(/only 2 lines, not 5/), expect.stringMatching(/only 2 lines, not 6/)] });
    const edited = { ...base, text: text.replace('open to all', 'open to everyone') };
    expect(applyAmendment(edited, amend(replace(5, 5, ['x']), insert(5, ['y'])))).toEqual({
      ok: false,
      problems: [expect.stringMatching(/change 1: line 5 no longer read as quoted/), expect.stringMatching(/change 2: line 5 no longer reads as quoted/)],
    });
  });

  it('reads a base saved with Windows line endings, and joins the result with \\n', () => {
    const crlf = { ...base, text: text.replace(/\n/g, '\r\n') };
    const result = applyAmendment(crlf, amend(replace(2, 2, ['Article I. Name and seal.'])));
    expect(result).toEqual({ ok: true, text: text.replace('Article I. Name.', 'Article I. Name and seal.') });
  });
});

describe('applying several amendments', () => {
  const name = { id: 'name', amendment: amend(replace(3, 3, ['The party is the United States Transhumanist Party.'])) };
  const membership = { id: 'membership', amendment: amend(replace(4, 5, ['Article II. Members.', 'Membership is open to every adult.'])) };
  const preamble = { id: 'preamble', amendment: amend(insert(3, ['It was founded in 2014.'])) };

  it('applies adjacent changes, and an insert at the edge of another change, the same in any order', () => {
    const expected =
      'USTP Bylaws\nArticle I. Name.\nThe party is the United States Transhumanist Party.\nIt was founded in 2014.\nArticle II. Members.\nMembership is open to every adult.\n';
    expect(applyAmendments(base, [name, membership, preamble])).toEqual({ ok: true, text: expected });
    expect(applyAmendments(base, [preamble, membership, name])).toEqual({ ok: true, text: expected });
    expect(amendmentConflicts([name, membership, preamble])).toEqual([]);
  });

  it('refuses changes to the same lines, two inserts at one point, and an insert inside another change', () => {
    const shorter = { id: 'shorter', amendment: amend(remove(5, 5)) };
    const another = { id: 'another', amendment: amend(insert(3, ['Its colours are orange and black.'])) };
    const inside = { id: 'inside', amendment: amend(insert(4, ['x'])) };
    expect(amendmentConflicts([membership, shorter, preamble, another, inside])).toEqual([
      { a: 'membership', b: 'shorter', kind: 'overlap' },
      { a: 'membership', b: 'inside', kind: 'overlap' },
      { a: 'preamble', b: 'another', kind: 'same_point' },
    ]);
    expect(applyAmendments(base, [membership, shorter])).toEqual({ ok: false, problems: ['membership and shorter change the same lines'] });
    expect(applyAmendments(base, [preamble, another])).toEqual({ ok: false, problems: ['preamble and another both insert after the same line'] });
  });

  it('gives the same text as splicing each change in from the bottom up, whatever the order', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}.`);
    const big = { version: '2026.1', contentHash: sha256Hex(lines.join('\n')), text: lines.join('\n') };
    let seed = 7;
    const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let round = 0; round < 200; round++) {
      // Non-overlapping changes over the 30 lines, dealt round-robin to three amendments.
      const changes: { change: AmendmentChange; start: number; end: number }[] = [];
      for (let at = 0; at < lines.length; ) {
        const roll = next(4);
        if (roll === 0) {
          changes.push({ change: { op: 'insert', after: at, anchor: at === 0 ? null : lines[at - 1]!, lines: [`New ${round}.${at}`] }, start: at, end: at });
          at += 1 + next(3);
        } else if (roll === 1) {
          const to = Math.min(lines.length, at + 1 + next(3));
          changes.push({ change: { op: 'replace', from: at + 1, to, expect: lines.slice(at, to), lines: [`Changed ${round}.${at}`] }, start: at, end: to });
          at = to + next(2);
        } else if (roll === 2) {
          const to = Math.min(lines.length, at + 1 + next(2));
          changes.push({ change: { op: 'delete', from: at + 1, to, expect: lines.slice(at, to) }, start: at, end: to });
          at = to + 1 + next(2);
        } else at += 1 + next(4);
      }
      if (!changes.length) continue;
      const dealt = [0, 1, 2].map((k) => changes.filter((_, i) => i % 3 === k).map((c) => c.change)).filter((c) => c.length);
      const list = dealt.map((c, k) => ({
        id: `a${k}`,
        amendment: bylawsAmendmentSchema.parse({ v: 1, base: { version: big.version, contentHash: big.contentHash }, changes: c }),
      }));
      const bottomUp = [...lines];
      for (const { change, start, end } of [...changes].reverse()) {
        bottomUp.splice(start, end - start, ...(change.op === 'delete' ? [] : change.lines));
      }
      expect(applyAmendments(big, list)).toEqual({ ok: true, text: bottomUp.join('\n') });
      expect(applyAmendments(big, [...list].reverse())).toEqual({ ok: true, text: bottomUp.join('\n') });
    }
  });
});

describe('the amendments of one election', () => {
  const contest = (contestId: string, amendment: BylawsAmendment) => ({ contestId, title: `Amend ${contestId}`, amendment });

  it('finds the contests that amend the bylaws, in ballot order', () => {
    const amendment = amend(replace(3, 3, ['x']));
    const definition = {
      contests: [
        { contestId: 'b', title: 'B', proposal: { snapshotId: 'p2', title: 'P2', contentHash: 'h2' } },
        { contestId: 'a', title: 'A', proposal: { snapshotId: 'p1', title: 'P1', contentHash: 'h1' } },
        { contestId: 'c', title: 'C', proposal: null },
      ],
    } as never;
    const proposals = [
      { snapshotId: 'p1', amendment },
      { snapshotId: 'p2', amendment: null },
    ] as never;
    expect(amendingContests(definition, proposals)).toEqual([{ contestId: 'a', title: 'A', amendment }]);
  });

  it('need the current version, one base, quotes that still match, and no conflicts', () => {
    const ok = [contest('name', amend(replace(3, 3, ['x']))), contest('members', amend(replace(4, 4, ['y'])))];
    expect(amendmentProblems([], null)).toEqual([]);
    expect(amendmentProblems(ok, base)).toEqual([]);
    expect(amendmentProblems(ok, null)).toEqual(['no bylaws are published, so there is nothing to amend']);
    expect(amendmentProblems(ok, { ...base, version: '2026.2' })).toEqual([
      'the proposals amend bylaws version 2026.1, but version 2026.2 is current; write them again against it',
    ]);
    const other = { ...amend(replace(3, 3, ['x'])), base: { version: '2025.9', contentHash: base.contentHash } };
    expect(amendmentProblems([...ok, contest('old', other)], base)).toEqual([
      'the proposals amend different bylaws versions (2026.1, 2025.9); one election amends one version',
    ]);
    expect(amendmentProblems([...ok, contest('again', amend(remove(3, 4)))], base)).toEqual([
      '"Amend name" and "Amend again" change the same lines',
      '"Amend members" and "Amend again" change the same lines',
    ]);
    const edited = { ...base, text: text.replace('Article II', 'Part II') };
    expect(amendmentProblems(ok, edited)).toEqual([expect.stringMatching(/"Amend members", change 1: line 4 no longer read as quoted/)]);
  });
});

describe('showing an amendment', () => {
  const amendment = amend(insert(2, ['Its seal is the infinity sign.']), replace(5, 5, ['Membership is open to every adult.']));

  it('lists exactly the lines it removes and adds, with base and amended line numbers', () => {
    expect(amendmentDiff(text, amendment, { context: 0 })).toEqual([
      { kind: 'added', text: 'Its seal is the infinity sign.', before: null, after: 3 },
      { kind: 'removed', text: 'Membership is open to all.', before: 5, after: null },
      { kind: 'added', text: 'Membership is open to every adult.', before: null, after: 6 },
    ]);
    const all = amendmentDiff(text, amendment);
    expect(all.filter((l) => l.kind === 'same').map((l) => [l.before, l.after])).toEqual([
      [1, 1],
      [2, 2],
      [3, 4],
      [4, 5],
      [6, 7],
    ]);
    expect(amendmentDiff(text, amendment, { context: 1 }).map((l) => l.before ?? `+${l.after}`)).toEqual([2, '+3', 3, 4, 5, '+6', 6]);
  });

  it('says what each change does, quoting the old and new lines', () => {
    expect(amendmentText(amendment)).toBe(
      [
        `Amends bylaws version 2026.1 (SHA-256 ${base.contentHash}).`,
        '1. Insert after line 2, which reads: Article I. Name.',
        '   new: Its seal is the infinity sign.',
        '2. Replace line 5:',
        '   was: Membership is open to all.',
        '   now: Membership is open to every adult.',
      ].join('\n'),
    );
  });
});

describe('an amendment from an edited copy', () => {
  it('turns runs of changed lines into replace, insert and delete changes that reproduce the edit', () => {
    const edited = 'Article I. Name.\nThe party is the USTP.\nIt has no seal.\nArticle II. Membership.\nMembership is open to every adult.   \n';
    const amendment = amendmentFromTexts(base, edited)!;
    expect(bylawsAmendmentSchema.safeParse(amendment).success).toBe(true);
    expect(amendment.changes.map((c) => c.op)).toEqual(['delete', 'insert', 'replace']);
    expect(applyAmendment(base, amendment)).toEqual({ ok: true, text: edited.replace('adult.   ', 'adult.') });
  });

  it('finds nothing when only trailing spaces changed', () => {
    expect(amendmentFromTexts(base, text)).toBeNull();
    expect(amendmentFromTexts({ ...base, text: 'a\nb ' }, 'a\nb')).toBeNull();
  });
});
