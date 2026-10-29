import { describe, expect, it } from 'vitest';
import {
  coursePortraitSrc,
  portraitProblem,
  saveCourseLessonSchema,
  saveFuturistProfileSchema,
  submitCourseQuizSchema,
} from './course.js';

const question = (choices: string[], correctIndex: number, questionId?: string) => ({
  ...(questionId && { questionId }),
  prompt: 'Which?',
  choices,
  correctIndex,
  explanation: 'Because.',
});
const lesson = (questions: unknown[]) => ({ order: 1, title: 'T', summary: 'S', body: 'B', estimatedMinutes: 5, questions });
const image = 'a'.repeat(64);
const profile = {
  order: 1,
  name: 'Ada',
  category: 'foundational_visionary',
  biography: 'Bio.',
  ideas: ['Idea'],
  quote: 'Quote.',
  quoteSource: 'Source',
  quoteUrl: 'https://example.test/q',
  portraitImage: null,
  portraitUrl: null,
  portraitAlt: '',
  portraitCredit: null,
  portraitLicense: null,
  portraitSourceUrl: null,
  furtherReadingUrl: 'https://example.test/r',
};
const withPhoto = { portraitImage: image, portraitAlt: 'Ada.', portraitCredit: 'Photo: Bo', portraitLicense: 'CC BY 4.0' };

describe('course quizzes', () => {
  it('take one to ten questions of two to six choices, the answer among them', () => {
    expect(saveCourseLessonSchema.safeParse(lesson([question(['a', 'b'], 1)])).success).toBe(true);
    expect(saveCourseLessonSchema.safeParse(lesson(Array.from({ length: 10 }, () => question(['1', '2', '3', '4', '5', '6'], 5)))).success).toBe(true);
    expect(saveCourseLessonSchema.safeParse(lesson([])).success).toBe(false);
    expect(saveCourseLessonSchema.safeParse(lesson(Array.from({ length: 11 }, () => question(['a', 'b'], 0)))).success).toBe(false);
    expect(saveCourseLessonSchema.safeParse(lesson([question(['a'], 0)])).success).toBe(false);
    expect(saveCourseLessonSchema.safeParse(lesson([question(['1', '2', '3', '4', '5', '6', '7'], 0)])).success).toBe(false);
    expect(saveCourseLessonSchema.safeParse(lesson([question(['a', 'b', 'c'], 3)])).success).toBe(false);
  });

  it('refuse two questions with one ID, and let new questions come without one', () => {
    expect(saveCourseLessonSchema.safeParse(lesson([question(['a', 'b'], 0, 'q'), question(['a', 'b'], 0, 'q')])).success).toBe(false);
    expect(saveCourseLessonSchema.safeParse(lesson([question(['a', 'b'], 0, 'q'), question(['a', 'b'], 0)])).success).toBe(true);
  });

  it('take one answer per question, each a choice a quiz could have', () => {
    expect(submitCourseQuizSchema.safeParse({ answers: [5] }).success).toBe(true);
    expect(submitCourseQuizSchema.safeParse({ answers: [6] }).success).toBe(false);
    expect(submitCourseQuizSchema.safeParse({ answers: [] }).success).toBe(false);
  });
});

describe('futurist portraits', () => {
  it('may be left out of a draft, but once started need a photo, alt text, a credit and a licence', () => {
    expect(saveFuturistProfileSchema.safeParse(profile).success).toBe(true);
    expect(saveFuturistProfileSchema.safeParse({ ...profile, ...withPhoto }).success).toBe(true);
    expect(saveFuturistProfileSchema.safeParse({ ...profile, ...withPhoto, portraitImage: null, portraitUrl: 'https://example.test/a.jpg' }).success).toBe(true);
    expect(saveFuturistProfileSchema.safeParse({ ...profile, ...withPhoto, portraitLicense: null }).success).toBe(false);
    expect(saveFuturistProfileSchema.safeParse({ ...profile, ...withPhoto, portraitAlt: '' }).success).toBe(false);
    expect(saveFuturistProfileSchema.safeParse({ ...profile, portraitCredit: 'Photo: Bo' }).success).toBe(false);
  });

  it('are an uploaded photo or a link, never both, and the source page is optional', () => {
    const both = saveFuturistProfileSchema.safeParse({ ...profile, ...withPhoto, portraitUrl: 'https://example.test/a.jpg' });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.message).toBe('use an uploaded photo or an image link, not both');
    expect(saveFuturistProfileSchema.safeParse({ ...profile, ...withPhoto, portraitImage: 'not-a-hash' }).success).toBe(false);
    expect(saveFuturistProfileSchema.safeParse({ ...profile, ...withPhoto, portraitSourceUrl: 'https://example.test/file' }).success).toBe(true);
  });

  it('are loaded from this server when uploaded, and say what they still need', () => {
    expect(coursePortraitSrc({ portraitImage: image, portraitUrl: null })).toBe(`/v1/public/course-images/${image}`);
    expect(coursePortraitSrc({ portraitImage: null, portraitUrl: 'https://example.test/a.jpg' })).toBe('https://example.test/a.jpg');
    expect(coursePortraitSrc({ portraitImage: null, portraitUrl: null })).toBeNull();
    expect(portraitProblem(profile)).toBe('no portrait yet');
    expect(portraitProblem({ ...profile, ...withPhoto, portraitAlt: '' })).toBe('the portrait needs alt text');
    expect(portraitProblem({ ...profile, ...withPhoto, portraitCredit: null })).toBe('the portrait needs a credit and a licence');
    expect(portraitProblem({ ...profile, ...withPhoto })).toBeNull();
  });
});
