import { coursePackageSchema, coursePlacementProblem, draftCoursePackage, placementOf, type CourseRecord } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { contentCourses } from './course/content-seed.js';
import { mapCourses } from './course/course-map-seed.js';
import { transhumanismCourse } from './course/transhumanism-seed.js';

const record = (courseId: string, title: string, summary: string): CourseRecord => ({
  ...mapCourses[0]!,
  courseId,
  title,
  summary,
});

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
});
