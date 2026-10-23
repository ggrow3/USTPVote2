import { describe, expect, it } from 'vitest';
import { diffLines, splitLines } from './text-diff.js';

const changes = (oldText: string, newText: string) =>
  diffLines(oldText, newText)
    .filter((l) => l.kind !== 'same')
    .map((l) => `${l.kind === 'added' ? '+' : '-'}${l.before ?? l.after} ${l.text}`);

describe('diffLines', () => {
  it('reports nothing for identical texts and treats CRLF like LF', () => {
    expect(changes('a\nb\nc', 'a\r\nb\r\nc')).toEqual([]);
    expect(splitLines('a\r\nb\rc')).toEqual(['a', 'b', 'c']);
  });

  it('shows one edited line as removed and added at its line number', () => {
    const before = 'Article I\nThe party meets yearly.\nArticle II';
    const after = 'Article I\nThe party meets twice a year.\nArticle II';
    expect(changes(before, after)).toEqual(['-2 The party meets yearly.', '+2 The party meets twice a year.']);
  });

  it('numbers inserted and deleted lines in the text they belong to', () => {
    expect(changes('a\nb\nc\nd', 'a\nc\nd\ne')).toEqual(['-2 b', '+4 e']);
    expect(changes('a\nc', 'a\nb\nc')).toEqual(['+2 b']);
  });

  it('keeps every line of both texts exactly once, in order', () => {
    const before = 'x\ny\nz\nw\nv';
    const after = 'x\nz\nq\nw\nr';
    const diff = diffLines(before, after);
    expect(diff.filter((l) => l.kind !== 'added').map((l) => l.text)).toEqual(splitLines(before));
    expect(diff.filter((l) => l.kind !== 'removed').map((l) => l.text)).toEqual(splitLines(after));
  });

  it('reports a wholesale rewrite as removed then added', () => {
    const big = (tag: string) => Array.from({ length: 2500 }, (_, i) => `${tag} ${i}`).join('\n');
    const diff = diffLines(big('old'), big('new'));
    expect(diff.filter((l) => l.kind === 'removed')).toHaveLength(2500);
    expect(diff[0]!.kind).toBe('removed');
    expect(diff.at(-1)!.kind).toBe('added');
  });
});
