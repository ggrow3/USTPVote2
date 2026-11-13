import { describe, expect, it } from 'vitest';
import { courseEmbed, coursesEmbed, embedLink } from './course-embed.js';
import type { CoursePackage } from './course-package.js';

const PKG = {
  format: 'ustp.course',
  version: 1,
  exportedAt: '2026-11-12T00:00:00.000Z',
  source: { content: 'published', courseVersion: 3, publishedAt: '2026-11-01T00:00:00.000Z' },
  course: { courseId: 'transhumanism', title: 'Transhumanism', summary: 'An introduction.' },
  lessons: [
    {
      lessonId: 'one',
      order: 1,
      title: 'One',
      summary: 'First.',
      body: 'First paragraph.\n\nSecond paragraph.\n  \nThird.',
      video: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', start: 30 },
      estimatedMinutes: 10,
      questions: [{ questionId: 'q1', prompt: 'Why?', choices: ['A', 'B'], correctIndex: 1, explanation: 'Because B.' }],
    },
    { lessonId: 'two', order: 2, title: 'Two', summary: '', body: 'Text.', video: { kind: 'upload', videoId: '019a0000-0000-7000-8000-000000000000' }, estimatedMinutes: 5, questions: [] },
  ],
  profiles: [
    {
      profileId: 'p1', order: 1, name: 'Uploaded', category: 'scientist', biography: 'Bio.', ideas: ['Idea'], quote: 'Q', quoteSource: 'Book',
      quoteUrl: 'javascript:alert(1)', portraitImage: 'abc', portraitUrl: null, portraitAlt: 'A face', portraitCredit: 'Jo', portraitLicense: 'CC BY 4.0',
      portraitSourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', furtherReadingUrl: 'https://example.org/read',
    },
    {
      profileId: 'p2', order: 2, name: 'Elsewhere', category: 'scientist', biography: 'Bio.', ideas: [], quote: '', quoteSource: '', quoteUrl: '',
      portraitImage: null, portraitUrl: 'https://upload.wikimedia.org/a.jpg', portraitAlt: 'B', portraitCredit: null, portraitLicense: 'Public domain',
      portraitSourceUrl: null, furtherReadingUrl: '',
    },
    {
      profileId: 'p3', order: 3, name: 'Insecure', category: 'scientist', biography: 'Bio.', ideas: [], quote: '', quoteSource: '', quoteUrl: '',
      portraitImage: null, portraitUrl: 'http://example.org/c.jpg', portraitAlt: 'C', portraitCredit: null, portraitLicense: null, portraitSourceUrl: null, furtherReadingUrl: '',
    },
  ],
} as unknown as CoursePackage;

const SITE = { origin: 'https://vote.example.org/', name: 'U.S. Transhumanist Party' };

describe('the course embed’s view of a course', () => {
  it('links to the course’s own page, and plays videos as the site does', () => {
    const embed = courseEmbed(PKG, SITE);
    expect(embed).toMatchObject({ view: 'course', pageUrl: 'https://vote.example.org/course/transhumanism', listPath: '/embed/courses', passPercent: 80, course: { version: 3 } });
    expect(embed.lessons[0]).toMatchObject({
      paragraphs: ['First paragraph.', 'Second paragraph.', 'Third.'],
      video: { kind: 'youtube', embedSrc: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=30', watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s' },
      questions: [{ prompt: 'Why?', correctIndex: 1, explanation: 'Because B.' }],
    });
    expect(embed.lessons[1]!.video).toEqual({ kind: 'upload', src: '/v1/public/videos/019a0000-0000-7000-8000-000000000000' });
  });

  it('keeps each portrait’s credit, shows https pictures, and drops links that are not http(s)', () => {
    const [uploaded, elsewhere, insecure] = courseEmbed(PKG, SITE).profiles;
    expect(uploaded).toMatchObject({
      quoteUrl: null,
      furtherReadingUrl: 'https://example.org/read',
      portrait: { src: '/v1/public/course-images/abc', link: 'https://commons.wikimedia.org/wiki/File:A.jpg', credit: 'Jo · CC BY 4.0' },
    });
    expect(elsewhere!.portrait).toEqual({ src: 'https://upload.wikimedia.org/a.jpg', link: null, alt: 'B', credit: 'Public domain' });
    expect(insecure!.portrait).toEqual({ src: null, link: 'http://example.org/c.jpg', alt: 'C', credit: '' });
    expect(embedLink('data:text/html,hi')).toBeNull();
  });

  it('is only made of a published course', () => {
    expect(() => courseEmbed({ ...PKG, source: { content: 'draft' } } as unknown as CoursePackage, SITE)).toThrow();
  });

  it('lists the published courses of the map, each opening in the frame', () => {
    const map = {
      courses: [
        { courseId: 'a', title: 'A', summary: 'About A', published: true, lessonCount: 3, prerequisites: [], position: null },
        { courseId: 'b', title: 'B', summary: null, published: false, lessonCount: 0, prerequisites: [], position: null },
      ],
    };
    expect(coursesEmbed(map, SITE)).toEqual({
      view: 'courses',
      site: { origin: 'https://vote.example.org', name: 'U.S. Transhumanist Party' },
      pageUrl: 'https://vote.example.org/courses',
      courses: [{ courseId: 'a', title: 'A', summary: 'About A', lessonCount: 3, embedPath: '/embed/course/a' }],
    });
  });
});
