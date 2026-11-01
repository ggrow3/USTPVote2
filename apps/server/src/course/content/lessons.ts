import type { CourseLesson, CoursePlacement, CourseQuestion } from 'ustp-domain';

export const SEED_SOURCE = 'course-seed';
export const SEEDED_AT = '2026-11-01T00:00:00.000Z';

/**
 * A course written from the party's curriculum (design §10.8): a draft on the map that it fills, or a new course with
 * where it goes on the map.
 */
export interface SeededCourse {
  readonly courseId: string;
  readonly title: string;
  readonly summary: string;
  /** Null for a course the map already has; for a new one, its square and the courses before it. */
  readonly placement: CoursePlacement | null;
  readonly lessons: readonly CourseLesson[];
}

/** A topic of a lesson: its heading, then its paragraphs. */
export type Topic = readonly [heading: string, ...paragraphs: string[]];

export const question = (questionId: string, prompt: string, choices: readonly string[], correctIndex: number, explanation: string): CourseQuestion => ({
  questionId,
  prompt,
  choices,
  correctIndex,
  explanation,
});

/**
 * A course's lessons. Lesson text is plain paragraphs, so each topic's heading is a paragraph of its own above its
 * text, as the curriculum sets them out.
 */
export const lessonsOf =
  (courseId: string) =>
  (
    lessonId: string,
    order: number,
    title: string,
    summary: string,
    estimatedMinutes: number,
    topics: readonly Topic[],
    questions: readonly CourseQuestion[],
  ): CourseLesson => ({
    courseId,
    lessonId,
    order,
    title,
    summary,
    body: topics.flat().join('\n\n'),
    estimatedMinutes,
    questions,
    updatedAt: SEEDED_AT,
    updatedBy: SEED_SOURCE,
  });
