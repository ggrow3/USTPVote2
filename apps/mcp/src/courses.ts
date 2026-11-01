import {
  coursePackageSrc,
  coursePortraitSrc,
  isCourseId,
  videoSrc,
  youtubeWatchUrl,
  type CourseMap,
  type CoursePackage,
  type CoursePosition,
} from 'ustp-domain';
import type { PublicApi } from 'ustp-verify';
import { NotPublished } from './reports.js';

/**
 * The course tools (design §3.4): the public course list, and each published course as its `ustp.course` file, which
 * is everything another site needs to show the course again. Like the election reports, built only from what the
 * public api serves; drafts are not public.
 */

/** The course ID in what the caller gave: the ID itself, or a link to its page or its file. */
export function courseIdFrom(input: string): string {
  const trimmed = input.trim();
  const id = (/\/courses?\/([a-z0-9]+(?:-[a-z0-9]+)*)/i.exec(trimmed)?.[1] ?? trimmed).toLowerCase();
  if (!isCourseId(id)) throw new NotPublished(`"${input.slice(0, 80)}" holds no course ID (such as transhumanism); list_courses gives them`);
  return id;
}

export interface CourseListing {
  readonly courseId: string;
  readonly title: string;
  /** null for a course still being written. */
  readonly summary: string | null;
  /** false: a draft on the course map, shown as coming soon with its title only, and with no file yet. */
  readonly published: boolean;
  readonly lessons: number;
  /** The courses a learner passes before this one's quizzes open. */
  readonly comesAfter: readonly string[];
  /** Its square on the course map (rows from the top, columns from the left, from 0), or null for off it. */
  readonly map: CoursePosition | null;
  readonly links: { readonly page: string | null; readonly file: string | null };
}

/** Where a picture or a video in the file plays from, absolute, so another site can show it or copy it. */
export interface CourseMedia {
  readonly kind: 'portrait' | 'video';
  /** The profile or lesson it belongs to. */
  readonly in: string;
  readonly src: string;
  /** For a portrait: its alt text, credit and licence, which a copy must keep. */
  readonly alt?: string;
  readonly credit?: string | null;
  readonly license?: string | null;
}

export class PublicCourses {
  /** `site` is the web app's origin; Firebase Hosting serves the api under it at `/v1`. */
  constructor(
    readonly api: PublicApi,
    readonly site: string = api.base,
  ) {}

  /** Every course on the Courses page, in map order: published ones, and drafts on the map as coming soon. */
  async listCourses(): Promise<CourseListing[]> {
    const { courses } = await this.api.require<CourseMap>('/v1/public/courses');
    return courses.map((course) => ({
      courseId: course.courseId,
      title: course.title,
      summary: course.summary,
      published: course.published,
      lessons: course.lessonCount,
      comesAfter: course.prerequisites,
      map: course.position,
      links: {
        page: course.published ? `${this.site}/course/${course.courseId}` : null,
        file: course.published ? `${this.site}${coursePackageSrc(course.courseId)}` : null,
      },
    }));
  }

  /**
   * A published course's `ustp.course` file, the version learners take now or an earlier one, with what it holds and
   * an absolute address for every picture and video in it. `file` is the file itself, as the api serves it.
   */
  async course(input: string, version?: number) {
    const courseId = courseIdFrom(input);
    const path = coursePackageSrc(courseId, version);
    const pkg = await this.api.get<CoursePackage>(path);
    if (!pkg || pkg.source.content !== 'published') {
      throw new NotPublished(
        version
          ? `course ${courseId} has no published version ${version}`
          : `no published course ${courseId}: a draft or a mistyped ID (list_courses gives the published ones)`,
      );
    }
    return {
      courseId,
      title: pkg.course.title,
      summary: pkg.course.summary,
      courseVersion: pkg.source.courseVersion,
      publishedAt: pkg.source.publishedAt,
      lessons: pkg.lessons.map((lesson) => ({ lessonId: lesson.lessonId, title: lesson.title, questions: lesson.questions.length })),
      profiles: pkg.profiles.map((profile) => ({ profileId: profile.profileId, name: profile.name })),
      media: this.media(pkg),
      links: {
        page: `${this.site}/course/${courseId}`,
        file: `${this.site}${coursePackageSrc(courseId, pkg.source.courseVersion)}`,
      },
      file: JSON.stringify(pkg, null, 2),
    };
  }

  private media(pkg: CoursePackage): CourseMedia[] {
    const absolute = (src: string) => (src.startsWith('/') ? `${this.site}${src}` : src);
    const portraits = pkg.profiles.flatMap((profile): CourseMedia[] => {
      const src = coursePortraitSrc(profile);
      if (!src) return [];
      return [{ kind: 'portrait', in: profile.profileId, src: absolute(src), alt: profile.portraitAlt, credit: profile.portraitCredit, license: profile.portraitLicense }];
    });
    const videos = pkg.lessons.flatMap((lesson): CourseMedia[] => {
      const video = lesson.video;
      if (!video) return [];
      return [{ kind: 'video', in: lesson.lessonId, src: video.kind === 'youtube' ? youtubeWatchUrl(video) : absolute(videoSrc(video.videoId)) }];
    });
    return [...portraits, ...videos];
  }
}
