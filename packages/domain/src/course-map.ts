import { z } from 'zod';
import type { CourseRecord } from './course.js';

/**
 * Many courses (design §10.8): a map of where each sits and which courses come before it, how each learner stands in
 * a course, and the messages between a learner and the course's instructors (the Course Administrators).
 */

/** The map is a grid; a course may need up to `maxPrerequisites` others passed before its quizzes open. */
export const COURSE_MAP = { rows: 8, columns: 6, maxPrerequisites: 5 } as const;

export interface CoursePosition {
  readonly row: number;
  readonly column: number;
}

/** Lower-case letters, digits and single hyphens: safe in an address and in a Firestore document ID. */
const COURSE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COURSE_ID_MAX = 64;

export function isCourseId(id: string): boolean {
  return id.length <= COURSE_ID_MAX && COURSE_ID.test(id);
}

/** A new course's ID from its title: its words in lower case joined by hyphens, accents dropped. */
export function courseIdFromTitle(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let id = '';
  for (const word of words) {
    const next = id ? `${id}-${word}` : word;
    if (next.length > COURSE_ID_MAX) break;
    id = next;
  }
  return id || 'course';
}

/** Where a course sits on the map and what comes before it, as saved on its record (absent on records from before). */
export interface CoursePlacement {
  readonly prerequisites: readonly string[];
  /** Null keeps the course off the map; it is still listed once published. */
  readonly position: CoursePosition | null;
}

/** A course record with its placement, reading records saved before the map as standing alone off it. */
export function placementOf(course: Partial<CoursePlacement>): CoursePlacement {
  return { prerequisites: course.prerequisites ?? [], position: course.position ?? null };
}

export const courseIdSchema = z.string().refine(isCourseId, 'not a course ID');

/** `PUT /v1/admin/courses/{courseId}/map`: applies at once, not with the next published version. */
export const courseMapSchema = z.strictObject({
  prerequisites: z
    .array(courseIdSchema)
    .max(COURSE_MAP.maxPrerequisites)
    .refine((ids) => new Set(ids).size === ids.length, 'a course is named twice'),
  position: z
    .strictObject({
      row: z.number().int().min(0).max(COURSE_MAP.rows - 1),
      column: z.number().int().min(0).max(COURSE_MAP.columns - 1),
    })
    .nullable(),
});
export type CourseMapInput = z.infer<typeof courseMapSchema>;

type Placed = Pick<CourseRecord, 'courseId' | 'title'> & CoursePlacement;

/**
 * What stops a course being placed as asked, in words, or null: a prerequisite that is not a course, the course
 * itself, a loop (A before B before A, which nobody could ever finish), or another course on the same square.
 */
export function coursePlacementProblem(courses: readonly Placed[], courseId: string, input: CoursePlacement): string | null {
  const byId = new Map(courses.map((course) => [course.courseId, course]));
  const title = (id: string) => byId.get(id)?.title ?? id;
  for (const id of input.prerequisites) {
    if (id === courseId) return 'a course cannot come before itself';
    if (!byId.has(id)) return `there is no course "${id}"`;
  }
  const loop = loopThrough(byId, courseId, input.prerequisites);
  if (loop) return `that makes a loop nobody could finish: ${loop.map(title).join(' → ')}`;
  if (input.position) {
    const { row, column } = input.position;
    const other = courses.find((course) => course.courseId !== courseId && course.position?.row === row && course.position.column === column);
    if (other) return `${other.title} is already on the map at row ${row + 1}, column ${column + 1}`;
  }
  return null;
}

/**
 * A loop through the course with the prerequisites it would have, in the order they would have to be passed (the
 * course, the courses after it, and the course again), or null.
 */
function loopThrough(byId: ReadonlyMap<string, Placed>, courseId: string, prerequisites: readonly string[]): string[] | null {
  const before = (id: string) => (id === courseId ? prerequisites : byId.get(id)?.prerequisites ?? []);
  const seen = new Set<string>();
  // `path` runs from the course back through prerequisites: each one must be passed before the one ahead of it.
  const walk = (path: readonly string[]): string[] | null => {
    for (const next of before(path[path.length - 1]!)) {
      if (next === courseId) return [courseId, ...[...path].reverse()];
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk([...path, next]);
      if (found) return found;
    }
    return null;
  };
  return walk([courseId]);
}

/** The prerequisites a learner has still to pass, in the order the course lists them. */
export function missingPrerequisites(prerequisites: readonly string[], passed: ReadonlySet<string>): string[] {
  return prerequisites.filter((id) => !passed.has(id));
}

/** A course named in a link: on the map, or as a prerequisite. */
export interface CourseLink {
  readonly courseId: string;
  readonly title: string;
}

/**
 * One course on the map and in the course list (`GET /v1/public/courses`). A published course shows its published
 * title and summary; one placed on the map but not yet published shows only its title, as coming soon. A course that
 * is neither is not listed.
 */
export interface CourseMapEntry {
  readonly courseId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly published: boolean;
  readonly lessonCount: number;
  readonly prerequisites: readonly string[];
  readonly position: CoursePosition | null;
}

export const LEARNER_COURSE_STATES = ['not_started', 'in_progress', 'passed', 'locked'] as const;
export type LearnerCourseState = (typeof LEARNER_COURSE_STATES)[number];

/** How a signed-in learner stands in one course (`GET /v1/courses`). Locked: a prerequisite is not passed yet. */
export interface LearnerCourseStatus {
  readonly courseId: string;
  readonly state: LearnerCourseState;
  readonly lessonsPassed: number;
  readonly lessonCount: number;
  readonly missing: readonly string[];
}

export interface CourseMap {
  readonly courses: readonly CourseMapEntry[];
  /** For a signed-in learner, how they stand in each listed course; absent for visitors. */
  readonly status?: readonly LearnerCourseStatus[];
}

/**
 * A learner's state in a course: passed with a certificate, else locked while a prerequisite is missing (they can
 * read but not take quizzes), else started once they have passed a lesson or tried a quiz.
 */
export function learnerCourseState(input: { readonly passed: boolean; readonly missing: readonly string[]; readonly started: boolean }): LearnerCourseState {
  if (input.passed) return 'passed';
  if (input.missing.length) return 'locked';
  return input.started ? 'in_progress' : 'not_started';
}

/** One lesson of the version a learner is taking, as Course Administrators see their result. */
export interface CourseLearnerLesson {
  readonly lessonId: string;
  readonly title: string;
  readonly bestScore: number | null;
  readonly passed: boolean;
}

/**
 * One learner of a course as its Course Administrators see them (`GET /v1/admin/courses/{courseId}/learners`): their
 * name but not their email, the version they are taking, each lesson's best score, their attempts, when they last
 * worked on it, their certificate, and the switch for messages with the instructor. A learner is listed once they
 * have tried a quiz in the course, or a Course Administrator has switched their messages.
 */
export interface CourseLearnerRow {
  readonly accountId: string;
  readonly name: string;
  readonly version: number | null;
  readonly lessons: readonly CourseLearnerLesson[];
  readonly lessonsPassed: number;
  readonly attempts: number;
  readonly lastActivityAt: string | null;
  readonly certificate: { readonly issuedAt: string; readonly revokedAt: string | null } | null;
  readonly messaging: boolean;
  /** The learner has written since an instructor last read the conversation. */
  readonly unread: boolean;
}

/**
 * `course_threads/{courseId}_{accountId}`: one learner's conversation with a course's instructors. Messaging is off
 * until a Course Administrator turns it on for the learner; while it is off nobody can write, and the history stays.
 */
export interface CourseThreadRecord {
  readonly threadId: string;
  readonly courseId: string;
  readonly accountId: string;
  readonly messaging: boolean;
  readonly switchedAt: string;
  readonly switchedBy: string;
  readonly lastLearnerMessageAt: string | null;
  readonly lastInstructorMessageAt: string | null;
  readonly learnerReadAt: string | null;
  readonly instructorReadAt: string | null;
}

export const COURSE_MESSAGE_SENDERS = ['learner', 'instructor'] as const;
export type CourseMessageSender = (typeof COURSE_MESSAGE_SENDERS)[number];

/** `course_messages/{messageId}`; `authorId` stays on the server, so a learner never sees an instructor's account. */
export interface CourseMessageRecord {
  readonly messageId: string;
  readonly threadId: string;
  readonly courseId: string;
  readonly accountId: string;
  readonly from: CourseMessageSender;
  readonly authorId: string;
  readonly authorName: string;
  readonly body: string;
  readonly sentAt: string;
}

export type CourseMessage = Pick<CourseMessageRecord, 'messageId' | 'from' | 'authorName' | 'body' | 'sentAt'>;

/** A conversation as either side reads it; reading it marks the other side's messages read. */
export interface CourseConversation {
  readonly messaging: boolean;
  readonly messages: readonly CourseMessage[];
}

/** The most messages a conversation shows, newest kept. */
export const COURSE_CONVERSATION_LIMIT = 200;

export const sendCourseMessageSchema = z.strictObject({ body: z.string().trim().min(1).max(4000) });
export type SendCourseMessageInput = z.infer<typeof sendCourseMessageSchema>;

export const courseMessagingSchema = z.strictObject({ messaging: z.boolean() });
export type CourseMessagingInput = z.infer<typeof courseMessagingSchema>;

export const courseThreadId = (courseId: string, accountId: string) => `${courseId}_${accountId}`;
