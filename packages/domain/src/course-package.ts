import { z } from 'zod';
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
 * or move elsewhere. It holds the title and summary, every lesson with its quiz (the correct answers and explanations
 * included, so it is not for learners) and every futurist profile, from the draft being edited or from a published
 * version. Who edited what (account IDs) stays out. Each lesson and profile is in the shape the course admin's save
 * routes take, with its ID.
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
