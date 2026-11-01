import {
  coursePackageSchema,
  coursePlacementProblem,
  coursesPackage,
  coursesPackageSchema,
  draftCoursePackage,
  placementOf,
  type CourseRecord,
  type CourseVersionRecord,
} from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { CONTENT_SEEDS, partyCourses } from './course/content-seed.js';
import { combinedCourses } from './course/course-combine-seed.js';
import { mapCourses } from './course/course-map-seed.js';
import { transhumanismCourse, transhumanismLessons, transhumanismProfiles } from './course/transhumanism-seed.js';

const record = (courseId: string, title: string, summary: string): CourseRecord => ({
  ...mapCourses[0]!,
  courseId,
  title,
  summary,
});

/** Every written course, the curriculum's and those from the party's own sources. */
const contentCourses = CONTENT_SEEDS.flatMap((batch) => batch.courses);

describe("The party's curriculum as courses (design §10.8)", () => {
  it('passes the rules a Course Administrator saving each lesson would meet, as a ustp.course package', () => {
    for (const seed of contentCourses) {
      const pkg = draftCoursePackage(record(seed.courseId, seed.title, seed.summary), seed.lessons, [], '2026-11-01T00:00:00.000Z');
      const parsed = coursePackageSchema.safeParse(pkg);
      expect(parsed.success, `${seed.courseId}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(seed.lessons.map((lesson) => lesson.order)).toEqual(seed.lessons.map((_, i) => i + 1));
      for (const lesson of seed.lessons) {
        expect(lesson.courseId).toBe(seed.courseId);
        expect(lesson.questions, lesson.lessonId).toHaveLength(5);
        // A learner cannot pass by always picking the same place.
        expect(new Set(lesson.questions.map((question) => question.correctIndex)).size, lesson.lessonId).toBeGreaterThan(1);
      }
    }
  });

  it('keeps the text clean of what the PDF it came from left behind', () => {
    for (const seed of contentCourses) {
      for (const lesson of seed.lessons) {
        const paragraphs = lesson.body.split('\n\n');
        expect(paragraphs.every((paragraph) => paragraph.trim() === paragraph && paragraph.length > 0), lesson.lessonId).toBe(true);
        const text = [lesson.title, lesson.summary, ...paragraphs, ...lesson.questions.flatMap((q) => [q.prompt, ...q.choices, q.explanation])];
        // Line breaks only between paragraphs, no doubled spaces, and none of the PDF's backtick quotes or lost characters.
        for (const part of text) expect(part, lesson.lessonId).not.toMatch(/[`\n�]| {2}/);
      }
    }
  });

  it("fills only the map's own courses, and puts the new ones on free squares after courses on the map", () => {
    const mapIds = new Set(mapCourses.map((course) => course.courseId));
    const placed: Pick<CourseRecord, 'courseId' | 'title' | 'prerequisites' | 'position'>[] = [transhumanismCourse, ...mapCourses].map((course) => ({
      ...course,
      ...placementOf(course),
    }));
    for (const seed of contentCourses) {
      if (!seed.placement) {
        expect(mapIds.has(seed.courseId), seed.courseId).toBe(true);
        expect(seed.title).toBe(mapCourses.find((course) => course.courseId === seed.courseId)!.title);
        continue;
      }
      expect(mapIds.has(seed.courseId), seed.courseId).toBe(false);
      expect(coursePlacementProblem(placed, seed.courseId, seed.placement)).toBeNull();
      placed.push({ courseId: seed.courseId, title: seed.title, ...seed.placement });
    }
    expect(contentCourses.filter((seed) => seed.placement).map((seed) => seed.courseId)).toEqual([
      'introduction-to-left-transhumanism',
      'historical-applied-projects',
    ]);
  });

  it('writes every course on the map once, so no draft is left without lessons', () => {
    const ids = contentCourses.map((seed) => seed.courseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(mapCourses.map((course) => course.courseId).filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("ends each lesson written from the party's own sources with the sources it rests on, as addresses", () => {
    for (const seed of partyCourses) {
      for (const lesson of seed.lessons) {
        const paragraphs = lesson.body.split('\n\n');
        const sources = paragraphs.slice(paragraphs.lastIndexOf('Sources') + 1);
        expect(paragraphs.lastIndexOf('Sources'), lesson.lessonId).toBeGreaterThan(0);
        expect(sources.length, lesson.lessonId).toBeGreaterThan(0);
        for (const source of sources) expect(source, lesson.lessonId).toMatch(/: https:\/\/\S+$/);
      }
    }
  });

  it('makes, as first seeded, one ustp.courses file of every course and the map, before any is combined', () => {
    const published: CourseVersionRecord = {
      ...transhumanismCourse,
      version: 1,
      lessons: transhumanismLessons,
      profiles: transhumanismProfiles,
      publishedAt: transhumanismCourse.createdAt,
      publishedBy: 'course-seed',
    };
    const seeds = new Map(contentCourses.map((seed) => [seed.courseId, seed]));
    const placed = contentCourses.filter((seed) => seed.placement).map((seed) => ({ ...record(seed.courseId, seed.title, seed.summary), ...seed.placement! }));
    const pkg = coursesPackage(
      [
        { course: transhumanismCourse, lessons: transhumanismLessons, profiles: transhumanismProfiles, published },
        ...[...mapCourses, ...placed].map((course) => ({ course, lessons: seeds.get(course.courseId)?.lessons ?? [], profiles: [], published: null })),
      ],
      '2026-11-01T00:00:00.000Z',
    );
    expect(coursesPackageSchema.safeParse(pkg).error?.issues ?? []).toEqual([]);
    expect(pkg.courses[0]).toMatchObject({ courseId: 'transhumanism', position: { row: 0, column: 0 }, published: { source: { courseVersion: 1 } } });
    expect(pkg.courses.filter((course) => course.published)).toHaveLength(1);
    expect(pkg.courses.every((course) => course.draft.lessons.length > 0)).toBe(true);
  });

  it('combines written courses only, each once, into courses that keep them in order with no two lessons alike', () => {
    const seeds = new Map(contentCourses.map((seed) => [seed.courseId, seed]));
    const combined = combinedCourses.flatMap(({ into, from }) => [into, ...from]);
    expect(new Set(combined).size).toBe(combined.length);
    for (const { into, from, seeded, summary } of combinedCourses) {
      expect(seeds.get(into)?.summary).toBe(seeded);
      const lessonIds = [into, ...from].flatMap((id) => seeds.get(id)!.lessons.map((lesson) => lesson.lessonId));
      expect(new Set(lessonIds).size).toBe(lessonIds.length);
      expect(summary.length).toBeLessThanOrEqual(2000);
    }
  });
});
