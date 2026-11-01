import { describe, expect, it } from 'vitest';
import type { CourseLesson, CourseRecord, CourseVersionRecord, FuturistProfile } from './course.js';
import {
  coursePackageFileName,
  coursePackageSchema,
  coursePackageSrc,
  coursesPackage,
  coursesPackageFileName,
  coursesPackageSchema,
  draftCoursePackage,
  publishedCoursePackage,
  type CourseContent,
} from './course-package.js';

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

  it('of a published version are public, the current one or an earlier one', () => {
    expect(coursePackageSrc('transhumanism')).toBe('/v1/public/courses/transhumanism/package');
    expect(coursePackageSrc('transhumanism', 2)).toBe('/v1/public/courses/transhumanism/package?version=2');
  });
});

describe('every course at once', () => {
  const published: CourseVersionRecord = {
    courseId: 'transhumanism',
    version: 2,
    title: 'Transhumanism',
    summary: 'Frozen',
    lessons: [lesson('first', 1)],
    profiles: [profile],
    publishedAt: '2026-10-20T00:00:00.000Z',
    publishedBy: '01a1-editor',
  };
  const other = (courseId: string, title: string, fields: Partial<CourseRecord> = {}): CourseContent => ({
    course: { ...course, courseId, title, status: 'draft', version: 0, publishedVersion: null, prerequisites: [], position: null, hidden: false, ...fields },
    lessons: [{ ...lesson(`${courseId}-1`, 1), courseId }],
    profiles: [],
    published: null,
  });
  const contents: CourseContent[] = [
    other('futures-lab', 'Futures Lab'),
    other('allies', 'Allies', { position: { row: 1, column: 0 }, prerequisites: ['transhumanism'] }),
    other('archive', 'Archive', { hidden: true }),
    { course: { ...course, hidden: false }, lessons: [lesson('later', 2), lesson('first', 1)], profiles: [profile], published },
  ];

  it('hold the map and every course in map order, its draft and the version learners take now, without who edited them', () => {
    const pkg = coursesPackage(contents, AT);
    expect(pkg).toMatchObject({ format: 'ustp.courses', version: 1, exportedAt: AT, map: { rows: 8, columns: 6 } });
    // Row by row, then those off the map by title, hidden ones and drafts included.
    expect(pkg.courses.map((c) => c.courseId)).toEqual(['transhumanism', 'allies', 'archive', 'futures-lab']);
    const [first, second, hidden] = pkg.courses;
    expect(first).toMatchObject({ courseId: 'transhumanism', hidden: false, prerequisites: [], position: { row: 0, column: 0 } });
    expect(first!.draft).toEqual(draftCoursePackage(course, [lesson('later', 2), lesson('first', 1)], [profile], AT));
    expect(first!.published).toEqual(publishedCoursePackage(published, AT));
    expect(second).toMatchObject({ prerequisites: ['transhumanism'], position: { row: 1, column: 0 }, published: null });
    expect(hidden).toMatchObject({ hidden: true, position: null });
    expect(JSON.stringify(pkg)).not.toContain('01a1-editor');
    expect(coursesPackageSchema.safeParse(pkg).error?.issues ?? []).toEqual([]);
  });

  it('read records from before the map and the hide switch as off it and shown', () => {
    const { prerequisites: _, position: _p, hidden: _h, ...old } = other('old', 'Old').course;
    const pkg = coursesPackage([{ ...other('old', 'Old'), course: old as CourseRecord }], AT);
    expect(pkg.courses[0]).toMatchObject({ hidden: false, prerequisites: [], position: null });
  });

  it('are named for the day', () => {
    expect(coursesPackageFileName(coursesPackage([], AT))).toBe('ustp-courses-2026-10-29.courses.json');
  });

  it('are checked as a whole: each course once, its own files, the version learners take, and a map that could be saved', () => {
    const pkg = coursesPackage(contents, AT);
    const issues = (courses: unknown[]) => coursesPackageSchema.safeParse({ ...pkg, courses }).error?.issues.map((i) => [i.path.join('.'), i.message]);
    const [first, second, hidden, last] = pkg.courses;

    expect(issues([first, first])).toContainEqual(['courses.1.courseId', 'transhumanism is used twice']);
    expect(issues([first, { ...second, draft: first!.draft }])).toContainEqual(['courses.1.draft.course.courseId', 'this is transhumanism, not allies']);
    expect(issues([{ ...first, draft: first!.published }])).toContainEqual(['courses.0.draft.source.content', 'the draft is a published version']);
    expect(issues([{ ...first, published: null }])).toEqual([['courses.0.published', 'learners take version 2']]);
    expect(issues([{ ...first, published: { ...first!.published, source: { ...first!.published!.source, courseVersion: 1 } } }])).toEqual([
      ['courses.0.published', 'learners take version 2, not 1'],
    ]);
    expect(issues([first, second, hidden, { ...last, published: first!.published }])).toContainEqual([
      'courses.3.published',
      'a course never published has no published version',
    ]);

    expect(issues([first, { ...second, position: { row: 8, column: 0 } }])).toContainEqual(['courses.1.position', 'row 9, column 1 is off the map']);
    expect(issues([first, { ...second, position: { row: 0, column: 0 } }])).toContainEqual(['courses.1', 'Transhumanism is already on the map at row 1, column 1']);
    expect(issues([second])).toEqual([['courses.0', 'there is no course "transhumanism"']]);
    expect(issues([{ ...first, prerequisites: ['allies'] }, second])).toContainEqual([
      'courses.0',
      'that makes a loop nobody could finish: Transhumanism → Allies → Transhumanism',
    ]);
    expect(issues([{ ...first, hidden: true }, second])).toEqual([
      ['courses.1', 'Transhumanism is hidden from the Courses page, so a course shown there cannot come after it: show it first'],
    ]);
  });
});
