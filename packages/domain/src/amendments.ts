import { z } from 'zod';
import { bylawsVersionSchema, hex32Schema } from './api.js';
import type { ElectionDefinition, ProposalSnapshotRecord } from './elections.js';
import type { BylawsRecord } from './records.js';
import { diffLines, splitLines, type DiffLine } from './text-diff.js';

/**
 * Bylaws amendments (design §6.6): a proposal that changes particular lines of a published bylaws version. Lines are
 * those of the version's text (`splitLines`, 1-based, a trailing empty line included, as the bylaws editor numbers
 * them); Word's own numbering never defines them. Every change quotes the lines it replaces, deletes or follows, so an
 * amendment drafted against another text cannot apply by accident.
 */

export const MAX_AMENDMENT_CHANGES = 200;
/** Characters across every quoted and new line of one amendment. */
export const MAX_AMENDMENT_CHARACTERS = 300_000;

const lineText = z
  .string()
  .max(10_000)
  .refine((s) => !/[\r\n]/.test(s), 'a line cannot contain a line break; give each line separately');
/** A new line: also no trailing whitespace, which a Word copy would drop and so read back differently. */
const newLineText = lineText.refine((s) => s === s.trimEnd(), 'remove the spaces at the end of the line');
const lineNumber = z.number().int().min(1);

const replaceChange = z.strictObject({
  op: z.literal('replace'),
  /** First and last line replaced, inclusive. */
  from: lineNumber,
  to: lineNumber,
  /** The lines `from`..`to` as the base reads them. */
  expect: z.array(lineText).min(1),
  lines: z.array(newLineText).min(1),
});
const insertChange = z.strictObject({
  op: z.literal('insert'),
  /** The line the new lines follow; 0 puts them at the top. */
  after: z.number().int().min(0),
  /** Line `after` as the base reads it; null when `after` is 0. */
  anchor: lineText.nullable(),
  lines: z.array(newLineText).min(1),
});
const deleteChange = z.strictObject({
  op: z.literal('delete'),
  from: lineNumber,
  to: lineNumber,
  expect: z.array(lineText).min(1),
});

export const amendmentChangeSchema = z.discriminatedUnion('op', [replaceChange, insertChange, deleteChange]);

export const bylawsAmendmentSchema = z
  .strictObject({
    v: z.literal(1),
    /** The published version the changes apply to. */
    base: z.strictObject({ version: bylawsVersionSchema, contentHash: hex32Schema }),
    /** Top to bottom, none overlapping. */
    changes: z.array(amendmentChangeSchema).min(1).max(MAX_AMENDMENT_CHANGES),
  })
  .superRefine((amendment, ctx) => {
    let characters = 0;
    let previous: Hunk | null = null;
    amendment.changes.forEach((change, i) => {
      const path = ['changes', i];
      if (change.op === 'insert') {
        if ((change.after === 0) !== (change.anchor === null)) {
          ctx.addIssue({ code: 'custom', path: [...path, 'anchor'], message: 'quote line `after`, or give null when inserting at the top' });
        }
      } else {
        if (change.to < change.from) ctx.addIssue({ code: 'custom', path: [...path, 'to'], message: '`to` comes before `from`' });
        else if (change.expect.length !== change.to - change.from + 1) {
          ctx.addIssue({ code: 'custom', path: [...path, 'expect'], message: `quote all ${change.to - change.from + 1} lines from ${change.from} to ${change.to}` });
        }
      }
      const hunk = hunkOf(change, 0, i);
      // Top to bottom: a later start, or an insert followed by a change starting at the same line.
      const inOrder = !previous || hunk.start > previous.start || (hunk.start === previous.start && isInsert(previous) && !isInsert(hunk));
      if (!inOrder) {
        ctx.addIssue({ code: 'custom', path, message: 'changes must run top to bottom' });
      } else if (previous && overlaps(previous, hunk)) {
        ctx.addIssue({ code: 'custom', path, message: 'this change overlaps the one before it' });
      }
      previous = hunk;
      characters += [...(change.op === 'insert' ? [change.anchor ?? ''] : change.expect), ...(change.op === 'delete' ? [] : change.lines)].reduce(
        (n, s) => n + s.length,
        0,
      );
    });
    if (characters > MAX_AMENDMENT_CHARACTERS) {
      ctx.addIssue({ code: 'custom', path: ['changes'], message: `an amendment can quote and add at most ${MAX_AMENDMENT_CHARACTERS} characters` });
    }
  });

export type BylawsAmendment = z.infer<typeof bylawsAmendmentSchema>;
export type AmendmentChange = z.infer<typeof amendmentChangeSchema>;

/** The text an amendment applies to. */
export type AmendmentBase = Pick<BylawsRecord, 'version' | 'contentHash' | 'text'>;

/** One amendment of several, named so problems and conflicts can say which (a contest ID, say). */
export interface NamedAmendment {
  readonly id: string;
  readonly amendment: BylawsAmendment;
}

export type AmendmentResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly problems: readonly string[] };

export interface AmendmentConflict {
  readonly a: string;
  readonly b: string;
  /** `overlap`: the changes touch the same lines; `same_point`: both insert after the same line. */
  readonly kind: 'overlap' | 'same_point';
}

/**
 * A change as the base lines it consumes, `[start, end)` as 0-based indices, and what it puts there. An insert
 * consumes nothing (`start === end`), so it lands before whatever follows that point.
 */
interface Hunk {
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
  readonly source: number;
  readonly change: number;
}

function hunkOf(change: AmendmentChange, source: number, index: number): Hunk {
  if (change.op === 'insert') return { start: change.after, end: change.after, lines: change.lines, source, change: index };
  return { start: change.from - 1, end: change.to, lines: change.op === 'replace' ? change.lines : [], source, change: index };
}

/**
 * Two changes conflict when they touch the same base lines, or both insert at the same point. Adjacent changes do not,
 * and an insert just before or after another change's lines does not either.
 */
function overlaps(x: Hunk, y: Hunk): boolean {
  if (isInsert(x) && isInsert(y)) return x.start === y.start;
  return x.start < y.end && y.start < x.end;
}

function isInsert(h: Hunk): boolean {
  return h.start === h.end;
}

/** Line order, an insert before a change that starts at the same line. */
function byLine(x: Hunk, y: Hunk): number {
  return x.start - y.start || x.end - x.start - (y.end - y.start);
}

function lineLabel(from: number, to: number): string {
  return from === to ? `line ${from}` : `lines ${from}–${to}`;
}

/** What is wrong with applying `amendment` to `base`: the wrong base, a line out of range, or a quoted line that differs. */
function changeProblems(base: AmendmentBase, lines: readonly string[], named: NamedAmendment, who: string): string[] {
  const { amendment } = named;
  if (amendment.base.version !== base.version || amendment.base.contentHash !== base.contentHash) {
    return [`${who} amends version ${amendment.base.version}, not version ${base.version}`];
  }
  const problems: string[] = [];
  amendment.changes.forEach((change, i) => {
    const where = `${who}, change ${i + 1}`;
    if (change.op === 'insert') {
      if (change.after > lines.length) problems.push(`${where}: the bylaws have only ${lines.length} lines, not ${change.after}`);
      else if (change.after > 0 && lines[change.after - 1] !== change.anchor) problems.push(`${where}: line ${change.after} no longer reads as quoted`);
      return;
    }
    if (change.to > lines.length) {
      problems.push(`${where}: the bylaws have only ${lines.length} lines, not ${change.to}`);
      return;
    }
    const actual = lines.slice(change.from - 1, change.to);
    if (actual.some((line, k) => line !== change.expect[k])) problems.push(`${where}: ${lineLabel(change.from, change.to)} no longer read as quoted`);
  });
  return problems;
}

/** Every pair of changes, from different amendments, that cannot both apply. */
export function amendmentConflicts(list: readonly NamedAmendment[]): AmendmentConflict[] {
  const hunks = list.flatMap((named, source) => named.amendment.changes.map((c, i) => hunkOf(c, source, i)));
  const found = new Map<string, AmendmentConflict>();
  for (let i = 0; i < hunks.length; i++) {
    for (let j = i + 1; j < hunks.length; j++) {
      const x = hunks[i]!;
      const y = hunks[j]!;
      if (x.source === y.source || !overlaps(x, y)) continue;
      const kind = isInsert(x) && isInsert(y) ? 'same_point' : 'overlap';
      const [a, b] = [list[x.source]!.id, list[y.source]!.id];
      found.set(`${a}\u0000${b}\u0000${kind}`, { a, b, kind });
    }
  }
  return [...found.values()];
}

/**
 * The base with every amendment applied (design §6.6, application v1). All amendments must be drafted against `base`
 * and none may conflict. The changes are merged in line order (an insert before a change starting at the same line)
 * and applied in one pass, so the result does not depend on the order of `list`. Lines are joined with `\n`.
 */
export function applyAmendments(base: AmendmentBase, list: readonly NamedAmendment[]): AmendmentResult {
  const lines = splitLines(base.text);
  const problems = list.flatMap((named) => changeProblems(base, lines, named, named.id));
  for (const c of amendmentConflicts(list)) {
    problems.push(c.kind === 'same_point' ? `${c.a} and ${c.b} both insert after the same line` : `${c.a} and ${c.b} change the same lines`);
  }
  if (problems.length) return { ok: false, problems };

  const hunks = list
    .flatMap((named, source) => named.amendment.changes.map((c, i) => hunkOf(c, source, i)))
    .sort(byLine);
  const out: string[] = [];
  let at = 0;
  for (const h of hunks) {
    out.push(...lines.slice(at, h.start), ...h.lines);
    at = h.end;
  }
  out.push(...lines.slice(at));
  return { ok: true, text: out.join('\n') };
}

/** `base` with one amendment applied; see `applyAmendments`. */
export function applyAmendment(base: AmendmentBase, amendment: BylawsAmendment): AmendmentResult {
  return applyAmendments(base, [{ id: 'the amendment', amendment }]);
}

/** A proposal contest whose text amends the bylaws. */
export interface AmendingContest {
  readonly contestId: string;
  readonly title: string;
  readonly amendment: BylawsAmendment;
}

/** The contests of a definition that amend the bylaws, with their amendments, in ballot order. */
export function amendingContests(definition: ElectionDefinition, proposals: readonly ProposalSnapshotRecord[]): AmendingContest[] {
  return definition.contests.flatMap((c) => {
    const amendment = c.proposal && proposals.find((p) => p.snapshotId === c.proposal!.snapshotId)?.amendment;
    return amendment ? [{ contestId: c.contestId, title: c.title, amendment }] : [];
  });
}

/**
 * Why an election's bylaws amendments cannot go to a vote (design §6.6): they must all amend one version, which must be
 * the current one, every change must still fit it, and no two may conflict. Empty when the election amends nothing.
 */
export function amendmentProblems(contests: readonly AmendingContest[], current: AmendmentBase | null): string[] {
  if (!contests.length) return [];
  const versions = [...new Set(contests.map((c) => c.amendment.base.version))];
  if (versions.length > 1) return [`the proposals amend different bylaws versions (${versions.join(', ')}); one election amends one version`];
  if (!current) return ['no bylaws are published, so there is nothing to amend'];
  if (versions[0] !== current.version) {
    return [`the proposals amend bylaws version ${versions[0]}, but version ${current.version} is current; write them again against it`];
  }
  const result = applyAmendments(
    current,
    contests.map((c) => ({ id: `"${c.title}"`, amendment: c.amendment })),
  );
  return result.ok ? [] : [...result.problems];
}

/**
 * The amended text against the base, line by line, exactly as the amendments say (not a recomputed diff): each change
 * shows its removed lines, then its added ones. `context` keeps that many unchanged lines around each change (all of
 * them by default). Line numbers are the base's (`before`) and the amended text's (`after`).
 */
export function amendmentDiff(
  baseText: string,
  amendments: BylawsAmendment | readonly BylawsAmendment[],
  { context = Infinity }: { readonly context?: number } = {},
): DiffLine[] {
  const lines = splitLines(baseText);
  const list: readonly BylawsAmendment[] = 'changes' in amendments ? [amendments] : amendments;
  const hunks = list
    .flatMap((a, source) => a.changes.map((c, i) => hunkOf(c, source, i)))
    .sort(byLine);
  const out: DiffLine[] = [];
  let at = 0;
  let after = 0;
  const same = (until: number) => {
    for (; at < until; at++) out.push({ kind: 'same', text: lines[at]!, before: at + 1, after: ++after });
  };
  for (const h of hunks) {
    same(Math.min(h.start, lines.length));
    for (let i = h.start; i < Math.min(h.end, lines.length); i++) out.push({ kind: 'removed', text: lines[i]!, before: i + 1, after: null });
    for (const text of h.lines) out.push({ kind: 'added', text, before: null, after: ++after });
    at = Math.max(at, Math.min(h.end, lines.length));
  }
  same(lines.length);
  if (!Number.isFinite(context)) return out;
  const near = new Set<number>();
  out.forEach((line, i) => {
    if (line.kind === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(out.length - 1, i + context); k++) near.add(k);
  });
  return out.filter((_, i) => near.has(i));
}

/**
 * The amendment in words, for a printed copy, a screen reader or a terminal: what each change does and the lines it
 * quotes ("was") and puts in ("now", "new").
 */
export function amendmentText(amendment: BylawsAmendment): string {
  const out = [`Amends bylaws version ${amendment.base.version} (SHA-256 ${amendment.base.contentHash}).`];
  const quote = (label: string, lines: readonly string[]) => lines.forEach((line) => out.push(`   ${label}: ${line}`));
  amendment.changes.forEach((change, i) => {
    const n = `${i + 1}.`;
    if (change.op === 'replace') {
      out.push(`${n} Replace ${lineLabel(change.from, change.to)}:`);
      quote('was', change.expect);
      quote('now', change.lines);
    } else if (change.op === 'delete') {
      out.push(`${n} Delete ${lineLabel(change.from, change.to)}:`);
      quote('was', change.expect);
    } else {
      out.push(change.after === 0 ? `${n} Insert at the top:` : `${n} Insert after line ${change.after}, which reads: ${change.anchor}`);
      quote('new', change.lines);
    }
  });
  return out.join('\n');
}

/**
 * The amendment that turns `base` into `edited`, or null when they read the same: runs of changed lines become one
 * replace, insert or delete each. New lines lose trailing whitespace (the format refuses it); a line changed only by
 * that is no change.
 */
export function amendmentFromTexts(base: AmendmentBase, edited: string): BylawsAmendment | null {
  const baseLines = splitLines(base.text);
  const changes: AmendmentChange[] = [];
  let removed: DiffLine[] = [];
  let added: string[] = [];
  let lastSame = 0;
  const flush = () => {
    const lines = added.map((s) => s.trimEnd());
    const expect = removed.map((d) => d.text);
    if (removed.length && lines.length) {
      if (lines.length !== expect.length || lines.some((s, k) => s !== expect[k]!.trimEnd())) {
        changes.push({ op: 'replace', from: removed[0]!.before!, to: removed.at(-1)!.before!, expect, lines });
      }
    } else if (removed.length) {
      changes.push({ op: 'delete', from: removed[0]!.before!, to: removed.at(-1)!.before!, expect });
    } else if (lines.length) {
      changes.push({ op: 'insert', after: lastSame, anchor: lastSame === 0 ? null : baseLines[lastSame - 1]!, lines });
    }
    removed = [];
    added = [];
  };
  for (const line of diffLines(base.text, edited)) {
    if (line.kind === 'same') {
      flush();
      lastSame = line.before!;
    } else if (line.kind === 'removed') removed.push(line);
    else added.push(line.text);
  }
  flush();
  return changes.length ? { v: 1, base: { version: base.version, contentHash: base.contentHash }, changes } : null;
}
