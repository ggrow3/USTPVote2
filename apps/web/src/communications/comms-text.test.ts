import { describe, expect, it } from 'vitest';
import { fileSize, formatHashtags, fromLocalInput, kitShareable, newsShareable, parseHashtags, toLocalInput } from './comms-text.js';

const ORIGIN = 'https://vote.example';

describe('communications wording', () => {
  it('shares a news post as its summary, hashtags and page here', () => {
    expect(newsShareable({ slug: 'platform-2028', title: 'Our platform', summary: '', hashtags: ['USTP'] }, ORIGIN)).toEqual({
      text: 'Our platform',
      url: `${ORIGIN}/news/platform-2028`,
      hashtags: ['USTP'],
      title: 'Our platform',
    });
  });

  it('shares a kit post with its link made absolute, or none', () => {
    expect(kitShareable({ title: 't', text: 'Watch', url: '/news/x', hashtags: [] }, ORIGIN).url).toBe(`${ORIGIN}/news/x`);
    expect(kitShareable({ title: 't', text: 'Watch', url: 'https://a.example', hashtags: [] }, ORIGIN).url).toBe('https://a.example');
    expect(kitShareable({ title: 't', text: 'Watch', url: '', hashtags: [] }, ORIGIN).url).toBeNull();
  });

  it('round-trips a local date and time, and refuses nonsense', () => {
    const iso = '2030-01-01T17:00:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(fromLocalInput('not a date')).toBe('');
  });

  it('says file sizes in words', () => {
    expect(fileSize(400)).toBe('1 KB');
    expect(fileSize(640_000)).toBe('640 KB');
    expect(fileSize(1_234_567)).toBe('1.2 MB');
  });

  it('reads hashtags as typed, and writes them back with their #', () => {
    expect(parseHashtags('#USTP, Future  #AI')).toEqual(['#USTP', 'Future', '#AI']);
    expect(formatHashtags(['USTP', 'AI'])).toBe('#USTP #AI');
  });
});
