import { describe, expect, it } from 'vitest';
import { ago, ballotLine, ballotLink, commentsLine, linkParts, paragraphs, pointsLine } from './forum-text.js';

describe('forum wording', () => {
  it('counts points and comments', () => {
    expect(pointsLine(1)).toBe('1 point');
    expect(pointsLine(0)).toBe('0 points');
    expect(pointsLine(-2)).toBe('−2 points');
    expect(commentsLine(0)).toBe('No comments');
    expect(commentsLine(1)).toBe('1 comment');
    expect(commentsLine(12)).toBe('12 comments');
  });

  it('says how long ago, then the date', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(ago('2026-10-29T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-10-29T11:55:00Z', now)).toBe('5 minutes ago');
    expect(ago('2026-10-29T09:00:00Z', now)).toBe('3 hours ago');
    expect(ago('2026-10-28T12:00:00Z', now)).toBe('yesterday');
    expect(ago('2026-08-01T12:00:00Z', now)).toBe('Aug 1, 2026');
  });

  it('links a ballot while voting and its results after', () => {
    const b = { electionId: 'e 1', contestId: 'c', at: '', electionTitle: '2027 Platform Vote', state: 'open' as const };
    expect(ballotLine(b)).toBe('On the ballot of 2027 Platform Vote (voting now)');
    expect(ballotLink(b)).toBe('/ballot/e%201');
    expect(ballotLink({ ...b, state: 'certified' })).toBe('/results/e%201');
    expect(ballotLink({ ...b, state: 'draft' })).toBeNull();
  });

  it('finds links in text, leaving sentence punctuation outside them', () => {
    expect(linkParts('See https://example.org/a. Then (https://en.wikipedia.org/wiki/IRV_(voting)) ok')).toEqual([
      { text: 'See ' },
      { text: 'https://example.org/a', href: 'https://example.org/a' },
      { text: '. Then (' },
      { text: 'https://en.wikipedia.org/wiki/IRV_(voting)', href: 'https://en.wikipedia.org/wiki/IRV_(voting)' },
      { text: ') ok' },
    ]);
    expect(linkParts('javascript:alert(1) and <b>')).toEqual([{ text: 'javascript:alert(1) and <b>' }]);
  });

  it('splits text into paragraphs on blank lines', () => {
    expect(paragraphs('One\nline\n\n  \nTwo')).toEqual([[{ text: 'One\nline' }], [{ text: 'Two' }]]);
    expect(paragraphs('   ')).toEqual([]);
  });
});
