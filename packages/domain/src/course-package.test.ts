import { describe, expect, it } from 'vitest';
import type { CourseLesson, CourseRecord, CourseVersionRecord, FuturistProfile } from './course.js';
import { coursePackageFileName, coursePackageSchema, draftCoursePackage, publishedCoursePackage } from './course-package.js';

const AT = '2026-10-29T12:00:00.000Z';
const course: CourseRecord = {
  courseId: 'transhumanism',
  title: 'Transhumanism',
  summary: 'An introduction',
  status: 'draft',
  version: 2,
  publishedVersion: 2,
  prerequisites: [],
  position: { row: 0, column: 0 },
  hidden: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
  updatedBy: '01a1-editor',
};
const question = (n: number) => ({
  questionId: `q${n}`,
  prompt: `Question ${n}?`,
  choices: ['A', 'B', 'C', 'D'],
  correctIndex: n % 4,
  explanation: `Because ${n}.`,
});
const lesson = (lessonId: string, order: number): CourseLesson => ({
  courseId: 'transhumanism',
  lessonId,
  order,
  title: `Lesson ${lessonId}`,
  summary: 'Summary',
  body: 'First paragraph.\n\nSecond paragraph.',
  estimatedMinutes: 10,
  questions: [1, 2, 3, 4, 5].map(question),
  updatedAt: AT,
  updatedBy: '01a1-editor',
});
const profile: FuturistProfile = {
  courseId: 'transhumanism',
  profileId: 'huxley',
  order: 1,
  name: 'Julian Huxley',
  category: 'foundational_visionary',
  biography: 'Biologist.',
  ideas: ['Evolutionary humanism'],
  quote: 'A quote.',
  quoteSource: 'A source',
  quoteUrl: 'https://example.org/quote',
  portraitImage: null,
  portraitUrl: 'https://example.org/huxley.jpg',
  portraitAlt: 'Portrait of Julian Huxley',
  portraitCredit: 'Someone',
  portraitLicense: 'Public domain',
  portraitSourceUrl: 'https://example.org/source',
  furtherReadingUrl: 'https://example.org/read',
  updatedAt: AT,
  updatedBy: '01a1-editor',
};

describe('course packages', () => {
  it('hold the draft in course order, answers included, without who edited it or whether it is hidden', () => {
    const pkg = draftCoursePackage(course, [lesson('later', 2), lesson('first', 1)], [profile], AT);
    expect(pkg).toMatchObject({
      format: 'ustp.course',
      version: 1,
      exportedAt: AT,
      source: { content: 'draft', status: 'draft', updatedAt: course.updatedAt, publishedVersion: 2 },
      course: { courseId: 'transhumanism', title: 'Transhumanism', summary: 'An introduction' },
    });
    expect(pkg.lessons.map((l) => l.lessonId)).toEqual(['first', 'later']);
    expect(pkg.lessons[0]!.questions[2]).toEqual({ questionId: 'q3', prompt: 'Question 3?', choices: ['A', 'B', 'C', 'D'], correctIndex: 3, explanation: 'Because 3.' });
    const text = JSON.stringify(pkg);
    expect(text).not.toContain('01a1-editor');
    expect(text).not.toContain('hidden');
    expect(pkg.lessons[0]).not.toHaveProperty('courseId');
    expect(pkg.profiles[0]).not.toHaveProperty('updatedAt');
  });

  it('hold a published version as frozen', () => {
    const version: CourseVersionRecord = {
      courseId: 'transhumanism',
      version: 2,
      title: 'Transhumanism (v2)',
      summary: 'Frozen',
      lessons: [lesson('first', 1)],
      profiles: [profile],
      publishedAt: '2026-10-20T00:00:00.000Z',
      publishedBy: '01a1-editor',
    };
    const pkg = publishedCoursePackage(version, AT);
    expect(pkg.source).toEqual({ content: 'published', courseVersion: 2, publishedAt: '2026-10-20T00:00:00.000Z' });
    expect(pkg.course.title).toBe('Transhumanism (v2)');
    expect(JSON.stringify(pkg)).not.toContain('01a1-editor');
  });

  it('are what the save routes take, each item with its ID once', () => {
    const pkg = draftCoursePackage(course, [lesson('first', 1), lesson('later', 2)], [profile], AT);
    expect(coursePackageSchema.safeParse(pkg).success).toBe(true);
    const twice = coursePackageSchema.safeParse({ ...pkg, lessons: [pkg.lessons[0], pkg.lessons[0]] });
    expect(twice.error?.issues).toEqual([expect.objectContaining({ path: ['lessons', 1, 'lessonId'], message: 'first is used twice' })]);
    const { profileId: _, ...nameless } = pkg.profiles[0]!;
    expect(coursePackageSchema.safeParse({ ...pkg, profiles: [nameless] }).error?.issues[0]?.path).toEqual(['profiles', 0, 'profileId']);
  });

  it('are named for the course, what was exported and the day', () => {
    expect(coursePackageFileName(draftCoursePackage(course, [], [], AT))).toBe('ustp-course-transhumanism-draft-2026-10-29.course.json');
    expect(coursePackageFileName({ course, exportedAt: AT, source: { content: 'published', courseVersion: 3, publishedAt: AT } })).toBe(
      'ustp-course-transhumanism-v3-2026-10-29.course.json',
    );
  });
});
