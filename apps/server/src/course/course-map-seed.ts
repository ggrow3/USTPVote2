import type { CoursePosition, CourseRecord } from 'ustp-domain';

/** Marks, in `course_seeds`, that the map's courses were added, so one a Course Administrator deletes stays deleted. */
export const MAP_SEED = 'course-map-2026-10';

/** Where the first course, published before the map, sits: on its own in the top left corner, with no links. */
export const FIRST_COURSE_POSITION: CoursePosition = { row: 0, column: 0 };

const SEEDED_AT = '2026-10-31T00:00:00.000Z';

/** A map course's summary until someone writes one. */
export const DRAFT_SUMMARY = 'Lessons for this course are still being written.';

const draft = (courseId: string, title: string, prerequisites: readonly string[], row: number, column: number): CourseRecord => ({
  courseId,
  title,
  summary: DRAFT_SUMMARY,
  status: 'draft',
  version: 0,
  publishedVersion: null,
  prerequisites,
  position: { row, column },
  hidden: false,
  openToGuests: false,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  updatedBy: 'course-seed',
});

/**
 * The party's course map (design §10.8), as drawn for it: one course at the top, three after it, The Coalition beside
 * Allies, and three more after the two introductions. Each starts as a draft with a title only, for Course
 * Administrators to write and publish; until then the map shows it as coming soon.
 */
export const mapCourses: readonly CourseRecord[] = [
  draft('fundamental-questions', 'The Fundamental Questions of Transhumanism', [], 0, 2),
  draft('the-coalition', 'The Coalition', ['allies'], 1, 0),
  draft('allies', 'Allies of the Transhumanist Party', ['fundamental-questions'], 1, 1),
  draft('transhumanist-party', 'An Introduction into the Transhumanist Party', ['fundamental-questions'], 1, 2),
  draft('new-york-transhumanist-party', 'Introduction to the New York Transhumanist Party', ['fundamental-questions'], 1, 3),
  draft('figures-of-transhumanism', 'The Figures of Transhumanism', ['transhumanist-party'], 2, 1),
  draft('why-the-transhumanist-party', 'Why the Transhumanist Party?', ['transhumanist-party'], 2, 2),
  draft('why-the-new-york-transhumanist-party', 'Why the New York Transhumanist Party?', ['new-york-transhumanist-party'], 2, 3),
];
