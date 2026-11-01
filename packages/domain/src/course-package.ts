import { z } from 'zod';
import { COURSE_MAP, courseIdSchema, courseMapOrder, courseMapSchema, coursePlacementProblem, placementOf, type CoursePosition } from './course-map.js';
import {
  COURSE_STATUSES,
  courseMetadataSchema,
  saveCourseLessonSchema,
  saveFuturistProfileSchema,
  type CourseLesson,
  type CourseRecord,
  type CourseStatus,
  type CourseVersionRecord,
  type FuturistProfile,
} from './course.js';

/**
 * Course packages (`ustp.course` v1): a course's content as one JSON file, for a Course Administrator to keep, review
 * or move elsewhere, and for anyone to build another site from. It holds the title and summary, every lesson with its
 * quiz (the correct answers and explanations included) and every futurist profile, from the draft being edited or from
 * a published version; a published version's file is public (coursePackageSrc), a draft's is not. Who edited what
 * (account IDs) stays out. Each lesson and profile is in the shape the course admin's save routes take, with its ID.
 */

export const COURSE_PACKAGE_FORMAT = 'ustp.course';

export type PackagedLesson = Omit<CourseLesson, 'courseId' | 'updatedAt' | 'updatedBy'>;
export type PackagedProfile = Omit<FuturistProfile, 'courseId' | 'updatedAt' | 'updatedBy'>;

/** What was exported: the draft as it is being edited, or a published version as learners take it. */
export type CoursePackageSource =
  | {
      readonly content: 'draft';
      readonly status: CourseStatus;
      readonly updatedAt: string;
      /** The version learners take now, if any. */
      readonly publishedVersion: number | null;
    }
  | { readonly content: 'published'; readonly courseVersion: number; readonly publishedAt: string };

export interface CoursePackage {
  readonly format: typeof COURSE_PACKAGE_FORMAT;
  readonly version: 1;
  readonly exportedAt: string;
  readonly source: CoursePackageSource;
  readonly course: { readonly courseId: string; readonly title: string; readonly summary: string };
  /** In course order. */
  readonly lessons: readonly PackagedLesson[];
  /** In page order. */
  readonly profiles: readonly PackagedProfile[];
}

const byOrder = <T extends { readonly order: number }>(id: (item: T) => string) => (a: T, b: T) =>
  a.order - b.order || id(a).localeCompare(id(b));

/** Everything but the course it belongs to and who last saved it, so a field the course gains is exported too. */
function packagedLesson({ courseId: _, updatedAt: _at, updatedBy: _by, ...lesson }: CourseLesson): PackagedLesson {
  return lesson;
}

function packagedProfile({ courseId: _, updatedAt: _at, updatedBy: _by, ...profile }: FuturistProfile): PackagedProfile {
  return profile;
}

function contentOf(lessons: readonly CourseLesson[], profiles: readonly FuturistProfile[]) {
  return {
    lessons: [...lessons].sort(byOrder((l) => l.lessonId)).map(packagedLesson),
    profiles: [...profiles].sort(byOrder((p) => p.profileId)).map(packagedProfile),
  };
}

/** The draft as a Course Administrator is editing it. */
export function draftCoursePackage(
  course: CourseRecord,
  lessons: readonly CourseLesson[],
  profiles: readonly FuturistProfile[],
  exportedAt: string,
): CoursePackage {
  return {
    format: COURSE_PACKAGE_FORMAT,
    version: 1,
    exportedAt,
    source: { content: 'draft', status: course.status, updatedAt: course.updatedAt, publishedVersion: course.publishedVersion },
    course: { courseId: course.courseId, title: course.title, summary: course.summary },
    ...contentOf(lessons, profiles),
  };
}

/** A published version, frozen as learners take it. */
export function publishedCoursePackage(version: CourseVersionRecord, exportedAt: string): CoursePackage {
  return {
    format: COURSE_PACKAGE_FORMAT,
    version: 1,
    exportedAt,
    source: { content: 'published', courseVersion: version.version, publishedAt: version.publishedAt },
    course: { courseId: version.courseId, title: version.title, summary: version.summary },
    ...contentOf(version.lessons, version.profiles),
  };
}

/**
 * Where anyone reads a published course as this file (design §10.8): the version learners take now, or an earlier
 * one. Drafts are only for Course Administrators, at `/v1/admin/courses/{courseId}/package`.
 */
export function coursePackageSrc(courseId: string, version?: number): string {
  return `/v1/public/courses/${courseId}/package${version ? `?version=${version}` : ''}`;
}

/** `ustp-course-transhumanism-draft-2026-10-29.course.json`, `ustp-course-transhumanism-v3-2026-10-29.course.json`. */
export function coursePackageFileName(pkg: Pick<CoursePackage, 'course' | 'source' | 'exportedAt'>): string {
  const which = pkg.source.content === 'draft' ? 'draft' : `v${pkg.source.courseVersion}`;
  return `ustp-course-${pkg.course.courseId}-${which}-${pkg.exportedAt.slice(0, 10)}.course.json`;
}

/**
 * A course package as this format defines it: lessons and profiles each as the save routes take them, and each with
 * an ID used once.
 */
export const coursePackageSchema = z
  .strictObject({
    format: z.literal(COURSE_PACKAGE_FORMAT),
    version: z.literal(1),
    exportedAt: z.string().max(64),
    source: z.discriminatedUnion('content', [
      z.strictObject({
        content: z.literal('draft'),
        status: z.enum(COURSE_STATUSES),
        updatedAt: z.string().max(64),
        publishedVersion: z.number().int().min(1).nullable(),
      }),
      z.strictObject({ content: z.literal('published'), courseVersion: z.number().int().min(1), publishedAt: z.string().max(64) }),
    ]),
    course: courseMetadataSchema.extend({ courseId: z.string().trim().min(1).max(80) }),
    lessons: z.array(saveCourseLessonSchema).max(1000),
    profiles: z.array(saveFuturistProfileSchema).max(1000),
  })
  .superRefine((pkg, ctx) => {
    for (const [key, ids] of [
      ['lessons', pkg.lessons.map((l) => l.lessonId)],
      ['profiles', pkg.profiles.map((p) => p.profileId)],
    ] as const) {
      const seen = new Set<string>();
      ids.forEach((id, i) => {
        const field = key === 'lessons' ? 'lessonId' : 'profileId';
        if (!id) ctx.addIssue({ code: 'custom', path: [key, i, field], message: 'every item in a package has its ID' });
        else if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [key, i, field], message: `${id} is used twice` });
        else seen.add(id);
      });
    }
  });

/**
 * Every course at once (`ustp.courses` v1, design §10.8): one file a Course Administrator exports from the Course tab,
 * with the course map and every course on it or off it, hidden ones and those never published included. Each course
 * has its square, the courses before it (the map draws a line from each of them to it) and whether it is hidden from
 * the Courses page, and its content as whole `ustp.course` files: the draft, and the version learners take now, if
 * any. Earlier published versions are left out; each is in that course's own file. Never public, for the drafts.
 */

export const COURSES_PACKAGE_FORMAT = 'ustp.courses';

/** One course in a `ustp.courses` file. */
export interface PackagedCourse {
  readonly courseId: string;
  /** Left off the Courses page, though it stays published and open at its address. */
  readonly hidden: boolean;
  /** The courses to pass before this one's quizzes open, in the order it lists them. */
  readonly prerequisites: readonly string[];
  /** Its square on the map, or null for off it. */
  readonly position: CoursePosition | null;
  /** The draft as a Course Administrator is editing it. */
  readonly draft: CoursePackage;
  /** The version learners take now; null for a course never published. */
  readonly published: CoursePackage | null;
}

export interface CoursesPackage {
  readonly format: typeof COURSES_PACKAGE_FORMAT;
  readonly version: 1;
  readonly exportedAt: string;
  /** The map's grid, which every square is on. */
  readonly map: { readonly rows: number; readonly columns: number };
  /** In map order: row by row, left to right, then the courses off the map by title. */
  readonly courses: readonly PackagedCourse[];
}

/** A course as it is kept: its record, its draft lessons and profiles, and the version learners take now, if any. */
export interface CourseContent {
  readonly course: CourseRecord;
  readonly lessons: readonly CourseLesson[];
  readonly profiles: readonly FuturistProfile[];
  readonly published: CourseVersionRecord | null;
}

/** Every course with the map; records saved before the map or the hide switch read as off it and shown. */
export function coursesPackage(courses: readonly CourseContent[], exportedAt: string): CoursesPackage {
  return {
    format: COURSES_PACKAGE_FORMAT,
    version: 1,
    exportedAt,
    map: { rows: COURSE_MAP.rows, columns: COURSE_MAP.columns },
    courses: courses
      .map((content) => ({ ...content, course: { ...content.course, ...placementOf(content.course), hidden: content.course.hidden === true } }))
      .sort((a, b) => courseMapOrder(a.course, b.course))
      .map(({ course, lessons, profiles, published }) => ({
        courseId: course.courseId,
        hidden: course.hidden,
        prerequisites: course.prerequisites,
        position: course.position,
        draft: draftCoursePackage(course, lessons, profiles, exportedAt),
        published: published && publishedCoursePackage(published, exportedAt),
      })),
  };
}

/** `ustp-courses-2026-11-01.courses.json`. */
export function coursesPackageFileName(pkg: Pick<CoursesPackage, 'exportedAt'>): string {
  return `ustp-courses-${pkg.exportedAt.slice(0, 10)}.courses.json`;
}

const gridSide = z.number().int().min(1).max(100);

/**
 * A `ustp.courses` file as this format defines it: each course once, its draft and published version whole course
 * packages of that course, the published one the version its draft says learners take, and a map Course
 * Administrators could have saved (every square on the grid and taken once, every prerequisite a course in the file,
 * no loops, no hidden course before one shown).
 */
export const coursesPackageSchema = z
  .strictObject({
    format: z.literal(COURSES_PACKAGE_FORMAT),
    version: z.literal(1),
    exportedAt: z.string().max(64),
    map: z.strictObject({ rows: gridSide, columns: gridSide }),
    courses: z
      .array(
        z.strictObject({
          courseId: courseIdSchema,
          hidden: z.boolean(),
          prerequisites: courseMapSchema.shape.prerequisites,
          position: z.strictObject({ row: z.number().int().min(0), column: z.number().int().min(0) }).nullable(),
          draft: coursePackageSchema,
          published: coursePackageSchema.nullable(),
        }),
      )
      .max(1000),
  })
  .superRefine((pkg, ctx) => {
    const seen = new Set<string>();
    pkg.courses.forEach((course, i) => {
      const issue = (path: readonly (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: ['courses', i, ...path], message });
      if (seen.has(course.courseId)) issue(['courseId'], `${course.courseId} is used twice`);
      seen.add(course.courseId);
      const { draft, published } = course;
      if (draft.source.content !== 'draft') issue(['draft', 'source', 'content'], 'the draft is a published version');
      if (published && published.source.content !== 'published') issue(['published', 'source', 'content'], 'the published version is a draft');
      for (const [key, of] of [['draft', draft], ['published', published]] as const) {
        if (of && of.course.courseId !== course.courseId) issue([key, 'course', 'courseId'], `this is ${of.course.courseId}, not ${course.courseId}`);
      }
      const taken = draft.source.content === 'draft' ? draft.source.publishedVersion : null;
      const given = published?.source.content === 'published' ? published.source.courseVersion : null;
      if (taken !== given) {
        issue(['published'], taken === null ? 'a course never published has no published version' : `learners take version ${taken}${given ? `, not ${given}` : ''}`);
      }
      if (course.position && (course.position.row >= pkg.map.rows || course.position.column >= pkg.map.columns)) {
        issue(['position'], `row ${course.position.row + 1}, column ${course.position.column + 1} is off the map`);
      }
    });
    const placed = pkg.courses.map((course) => ({ ...course, title: course.draft.course.title }));
    pkg.courses.forEach((course, i) => {
      const problem = coursePlacementProblem(placed, course.courseId, course);
      if (problem) ctx.addIssue({ code: 'custom', path: ['courses', i], message: problem });
    });
  });
