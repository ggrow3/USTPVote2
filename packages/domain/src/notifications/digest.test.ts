import { describe, expect, it } from 'vitest';
import { digestIsEmpty, digestMessage, nextWeeklyDigestAt } from './digest.js';

const origin = 'https://vote.example.org';

describe('the weekly digest', () => {
  it('is due on Mondays at 13:00 UTC', () => {
    // Tuesday 2026-11-10.
    expect(nextWeeklyDigestAt(new Date('2026-11-10T09:00:00.000Z'))).toBe('2026-11-16T13:00:00.000Z');
    expect(nextWeeklyDigestAt(new Date('2026-11-16T12:59:00.000Z'))).toBe('2026-11-16T13:00:00.000Z');
    expect(nextWeeklyDigestAt(new Date('2026-11-16T13:00:00.000Z'))).toBe('2026-11-23T13:00:00.000Z');
  });

  it('lists what is new, each with its address, and says so in the subject', () => {
    const { subject, body } = digestMessage({
      origin,
      content: {
        elections: [{ title: 'Platform  Vote #9', closesAt: '2026-11-20T18:00:00.000Z' }],
        news: [
          { title: 'Convention dates', slug: 'convention-dates' },
          { title: 'A new chapter', slug: 'a-new-chapter' },
        ],
        courses: [{ title: 'Why USTP', courseId: 'why-ustp' }],
      },
    });
    expect(subject).toBe('This week at the US Transhumanist Party: 1 vote open, 2 news posts, 1 course');
    expect(body).toContain('A vote is open:\n- Platform Vote #9 (closes Friday, November 20, UTC)\nYour ballots: https://vote.example.org/ballot');
    expect(body).toContain('- Convention dates: https://vote.example.org/news/convention-dates');
    expect(body).toContain('- Why USTP: https://vote.example.org/course/why-ustp');
    expect(body.split('\n\n')).toHaveLength(5);
  });

  it('leaves out a kind with nothing new, caps a long list, and knows an empty week', () => {
    const news = Array.from({ length: 11 }, (_, i) => ({ title: `Post ${i}`, slug: `post-${i}` }));
    const { subject, body } = digestMessage({ origin, content: { elections: [], news, courses: [] } });
    expect(subject).toBe('This week at the US Transhumanist Party: 11 news posts');
    expect(body).not.toContain('open:');
    expect(body).toContain('And 3 more: https://vote.example.org/news');
    expect(digestIsEmpty({ elections: [], news: [], courses: [] })).toBe(true);
    expect(digestIsEmpty({ elections: [], news, courses: [] })).toBe(false);
  });
});
