import { PASS_PERCENT } from './course.js';
import type { CourseMap } from './course-map.js';
import type { CoursePackage } from './course-package.js';
import { youtubeEmbedSrc, youtubeWatchUrl } from './video.js';

/**
 * The course embed (design §10.17, "The course embed"): a page of its own for each published course, and one listing
 * them, that other sites may frame. The Partners page offers allied groups the `<iframe>` snippet. The page is no part
 * of the web app: it runs no sign-in and reads no one's data, only the course as the public course api gives it
 * (§10.8), so another site's frame can show nothing that is not already public. Quizzes are checked in the page from
 * the course file's answers; certificates stay on the course's own page here, which the embed links to.
 */

export const EMBED_ROUTES = { courses: '/embed/courses', course: '/embed/course/:courseId' } as const;

/** Where a course's embed is, or the list's with no course. */
export function courseEmbedPath(courseId: string | null): string {
  return courseId ? `/embed/course/${encodeURIComponent(courseId)}` : EMBED_ROUTES.courses;
}

/** The snippet's height in pixels: the page scrolls inside it. */
export const EMBED_HEIGHT = 720;

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const attribute = (text: string) => text.replace(/[&<>"']/g, (c) => ATTRIBUTE_ESCAPES[c]!);

/**
 * The `<iframe>` a partner pastes into its own page: a course (or the list of courses) from `origin`. It asks for
 * nothing but fullscreen and autoplay, for the videos played from YouTube once a viewer presses play.
 */
export function courseEmbedSnippet(origin: string, course: { readonly courseId: string; readonly title: string } | null, party = 'the U.S. Transhumanist Party'): string {
  const src = `${origin.replace(/\/$/, '')}${courseEmbedPath(course?.courseId ?? null)}`;
  const title = course ? `${course.title}: a course from ${party}` : `Courses from ${party}`;
  return (
    `<iframe src="${attribute(src)}" title="${attribute(title)}" width="100%" height="${EMBED_HEIGHT}" ` +
    `style="border:0;max-width:100%" loading="lazy" allow="fullscreen; autoplay; encrypted-media; picture-in-picture" ` +
    `referrerpolicy="strict-origin-when-cross-origin"></iframe>`
  );
}

/** An address the page may link to: http or https only, never a script. */
export function embedLink(address: string | null | undefined): string | null {
  if (!address) return null;
  try {
    const url = new URL(address);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export interface EmbedSite {
  /** Where the course site is, e.g. `https://vote.example.org`: every link is made absolute against it. */
  readonly origin: string;
  /** Its name, from the hub ("U.S. Transhumanist Party"). */
  readonly name: string;
}

export type EmbedVideo =
  | { readonly kind: 'youtube'; readonly embedSrc: string; readonly watchUrl: string }
  | { readonly kind: 'upload'; readonly src: string };

export interface EmbedQuestion {
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly correctIndex: number;
  readonly explanation: string;
}

export interface EmbedLesson {
  readonly title: string;
  readonly summary: string;
  readonly minutes: number;
  /** The text, a paragraph a string. */
  readonly paragraphs: readonly string[];
  readonly video: EmbedVideo | null;
  readonly questions: readonly EmbedQuestion[];
}

export interface EmbedProfile {
  readonly name: string;
  readonly biography: string;
  readonly ideas: readonly string[];
  readonly quote: string;
  readonly quoteSource: string;
  readonly quoteUrl: string | null;
  readonly furtherReadingUrl: string | null;
  /** The picture, uploaded here or an open-licence image elsewhere (https only), as the course page shows it, and its source page. */
  readonly portrait: {
    readonly src: string | null;
    readonly link: string | null;
    readonly alt: string;
    /** Its credit and licence, which every copy keeps. */
    readonly credit: string;
  } | null;
}

/** What a course's embed shows. */
export interface CourseEmbed {
  readonly view: 'course';
  readonly site: EmbedSite;
  readonly course: { readonly courseId: string; readonly title: string; readonly summary: string; readonly version: number; readonly publishedAt: string };
  /** The course's own page on the site, where its certificate is earned. */
  readonly pageUrl: string;
  /** Back to the list, when the embed was opened from it. */
  readonly listPath: string;
  readonly passPercent: number;
  readonly lessons: readonly EmbedLesson[];
  readonly profiles: readonly EmbedProfile[];
}

/** What the list's embed shows: each published course on the map, in map order. */
export interface CoursesEmbed {
  readonly view: 'courses';
  readonly site: EmbedSite;
  readonly pageUrl: string;
  readonly courses: readonly { readonly courseId: string; readonly title: string; readonly summary: string; readonly lessonCount: number; readonly embedPath: string }[];
}

export type Embed = CourseEmbed | CoursesEmbed;

/** A published course's embed from its `ustp.course` file. */
export function courseEmbed(pkg: CoursePackage, site: EmbedSite): CourseEmbed {
  if (pkg.source.content !== 'published') throw new Error('only a published course is embedded');
  const origin = site.origin.replace(/\/$/, '');
  return {
    view: 'course',
    site: { origin, name: site.name },
    course: { courseId: pkg.course.courseId, title: pkg.course.title, summary: pkg.course.summary, version: pkg.source.courseVersion, publishedAt: pkg.source.publishedAt },
    pageUrl: `${origin}/course/${encodeURIComponent(pkg.course.courseId)}`,
    listPath: EMBED_ROUTES.courses,
    passPercent: PASS_PERCENT,
    lessons: pkg.lessons.map((lesson) => ({
      title: lesson.title,
      summary: lesson.summary,
      minutes: lesson.estimatedMinutes,
      paragraphs: lesson.body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean),
      video: !lesson.video
        ? null
        : lesson.video.kind === 'youtube'
          ? { kind: 'youtube', embedSrc: youtubeEmbedSrc(lesson.video), watchUrl: youtubeWatchUrl(lesson.video) }
          : { kind: 'upload', src: `/v1/public/videos/${encodeURIComponent(lesson.video.videoId)}` },
      questions: lesson.questions.map((q) => ({ prompt: q.prompt, choices: q.choices, correctIndex: q.correctIndex, explanation: q.explanation })),
    })),
    profiles: pkg.profiles.map((p) => {
      const credit = [p.portraitCredit, p.portraitLicense].filter(Boolean).join(' · ');
      const elsewhere = embedLink(p.portraitUrl);
      const src = p.portraitImage
        ? `/v1/public/course-images/${encodeURIComponent(p.portraitImage)}`
        : elsewhere?.startsWith('https:')
          ? elsewhere
          : null;
      const link = embedLink(p.portraitSourceUrl) ?? (src ? null : elsewhere);
      return {
        name: p.name,
        biography: p.biography,
        ideas: p.ideas,
        quote: p.quote,
        quoteSource: p.quoteSource,
        quoteUrl: embedLink(p.quoteUrl),
        furtherReadingUrl: embedLink(p.furtherReadingUrl),
        portrait: src || link ? { src, link, alt: p.portraitAlt, credit } : null,
      };
    }),
  };
}

/** The list's embed from the public course map: the published courses only, each opening in the frame. */
export function coursesEmbed(map: CourseMap, site: EmbedSite): CoursesEmbed {
  const origin = site.origin.replace(/\/$/, '');
  return {
    view: 'courses',
    site: { origin, name: site.name },
    pageUrl: `${origin}/courses`,
    courses: map.courses
      .filter((c) => c.published)
      .map((c) => ({ courseId: c.courseId, title: c.title, summary: c.summary ?? '', lessonCount: c.lessonCount, embedPath: courseEmbedPath(c.courseId) })),
  };
}
