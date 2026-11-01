import { z } from 'zod';
import type { CourseLink, CoursePosition } from './course-map.js';
import { videoSchema, type Video } from './video.js';

/** The first-party course catalogue is intentionally independent of party membership and voting. */
export const COURSE_STATUSES = ['draft', 'published'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const FUTURIST_CATEGORIES = [
  'democratic_transhumanist',
  'transhumanist_pioneer',
  'ethical_technology_thinker',
  'foundational_visionary',
] as const;
export type FuturistCategory = (typeof FUTURIST_CATEGORIES)[number];

export interface CourseRecord {
  readonly courseId: string;
  readonly title: string;
  readonly summary: string;
  readonly status: CourseStatus;
  /** Draft revision number; it is copied to an immutable CourseVersionRecord when published. */
  readonly version: number;
  readonly publishedVersion: number | null;
  /**
   * The courses a learner must have passed (holding their certificate) before taking this one's quizzes, and where it
   * sits on the course map, null for off it (design §10.8). Both apply at once rather than with the next published
   * version. Records from before the map have neither: read them with placementOf.
   */
  readonly prerequisites: readonly string[];
  readonly position: CoursePosition | null;
  /** Who last changed the prerequisites or position, and when; absent until someone does. */
  readonly placedAt?: string;
  readonly placedBy?: string;
  /**
   * Left off the Courses page for everyone, though it stays published, on its square and open at its address (design
   * §10.8). Off by default; records from before the switch have none and are shown.
   */
  readonly hidden: boolean;
  /** Who last hid or showed it, and when; absent until someone does. */
  readonly hiddenChangedAt?: string;
  readonly hiddenChangedBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/**
 * A lesson's quiz: one to ten questions, each with two to six choices and one correct answer. A learner passes with
 * PASS_PERCENT of the answers right, and may retry as often as they like.
 */
export const QUIZ_LIMITS = { minQuestions: 1, maxQuestions: 10, minChoices: 2, maxChoices: 6 } as const;
export const PASS_PERCENT = 80;

/**
 * Portraits a Course Administrator uploads: at least MIN_SIDE pixels on the short side, stored as a WebP at most
 * MAX_SIDE pixels on the long side, on this server, so learners never load them from another site.
 */
export const COURSE_IMAGE = { minSide: 200, maxSide: 800 } as const;

export interface CourseQuestion {
  readonly questionId: string;
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly correctIndex: number;
  readonly explanation: string;
}

export interface PublicCourseQuestion {
  readonly questionId: string;
  readonly prompt: string;
  readonly choices: readonly string[];
}

export interface CourseLesson {
  readonly courseId: string;
  readonly lessonId: string;
  readonly order: number;
  readonly title: string;
  readonly summary: string;
  /** Plain paragraphs separated by blank lines; the web app renders it without accepting HTML. */
  readonly body: string;
  /** Shown above the text (video.ts); lessons saved before videos have none. */
  readonly video?: Video | null;
  readonly estimatedMinutes: number;
  readonly questions: readonly CourseQuestion[];
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface PublicCourseLesson extends Omit<CourseLesson, 'questions' | 'updatedAt' | 'updatedBy'> {
  readonly questions: readonly PublicCourseQuestion[];
}

export interface FuturistProfile {
  readonly courseId: string;
  readonly profileId: string;
  readonly order: number;
  readonly name: string;
  readonly category: FuturistCategory;
  readonly biography: string;
  readonly ideas: readonly string[];
  readonly quote: string;
  readonly quoteSource: string;
  readonly quoteUrl: string;
  /**
   * The portrait: an uploaded photo's ID (the SHA-256 of its stored bytes, see coursePortraitSrc) or the address of a
   * public-domain or open-licence image elsewhere, never both. Neither is allowed only while a Course Administrator is
   * preparing a draft. Records saved before uploads existed have no portraitImage; read it as null.
   */
  readonly portraitImage: string | null;
  readonly portraitUrl: string | null;
  readonly portraitAlt: string;
  readonly portraitCredit: string | null;
  readonly portraitLicense: string | null;
  /** Where the picture comes from, when it has a page of its own (a Wikimedia Commons file page, say). */
  readonly portraitSourceUrl: string | null;
  readonly furtherReadingUrl: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface CourseVersionRecord {
  readonly courseId: string;
  readonly version: number;
  readonly title: string;
  readonly summary: string;
  readonly lessons: readonly CourseLesson[];
  readonly profiles: readonly FuturistProfile[];
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface CourseProgressRecord {
  readonly courseId: string;
  readonly accountId: string;
  readonly version: number;
  readonly bestScores: Readonly<Record<string, number>>;
  readonly completedLessonIds: readonly string[];
  readonly updatedAt: string;
}

export interface CourseAttemptRecord {
  readonly attemptId: string;
  readonly courseId: string;
  readonly version: number;
  readonly lessonId: string;
  readonly accountId: string;
  readonly score: number;
  readonly passed: boolean;
  readonly attemptedAt: string;
}

export interface CourseCertificateRecord {
  readonly certificateId: string;
  readonly courseId: string;
  readonly courseVersion: number;
  readonly accountId: string;
  /** Captured on issue, so later account-profile edits do not change an earned credential. */
  readonly recipientName: string;
  readonly issuedAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly revocationReason: string | null;
}

export interface CourseCatalog {
  readonly course: Pick<CourseRecord, 'courseId' | 'title' | 'summary' | 'publishedVersion'>;
  readonly lessons: readonly PublicCourseLesson[];
  readonly profiles: readonly FuturistProfile[];
  /** The courses to pass before this one's quizzes open, in the order the course lists them. */
  readonly prerequisites: readonly CourseLink[];
}

export interface LearnerCourseView extends CourseCatalog {
  readonly progress: CourseProgressRecord | null;
  readonly certificate: Pick<CourseCertificateRecord, 'certificateId' | 'issuedAt' | 'courseVersion'> | null;
  /** The prerequisites this learner has not passed yet; while any are left they can read but not take quizzes. */
  readonly missingPrerequisites: readonly CourseLink[];
  /** Whether they may write to the course's instructors now (a Course Administrator turns it on for them). */
  readonly messaging: boolean;
}

/** How one answer went, shown to the learner after they submit a quiz: right or not, and why. */
export interface CourseQuizFeedback {
  readonly questionId: string;
  readonly correct: boolean;
  readonly explanation: string;
}

export interface CertificateVerification {
  readonly valid: boolean;
  readonly courseTitle: string | null;
  readonly courseVersion: number | null;
  readonly issuedAt: string | null;
}

/**
 * Stable seam for the later LTI 1.3 adapter. No LMS identity is trusted until that adapter completes the LTI OIDC/JWT
 * verification flow; first-party progress remains keyed only by an accountId.
 */
export interface LtiLaunchContext {
  readonly issuer: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly subject: string;
  readonly contextId: string | null;
  readonly resourceLinkId: string | null;
}

export interface LtiGradeOutcome {
  readonly courseId: string;
  readonly lessonId: string;
  readonly score: number;
  readonly passed: boolean;
}

const COURSE_IMAGE_ID = /^[0-9a-f]{64}$/;

export function isCourseImageId(id: string): boolean {
  return COURSE_IMAGE_ID.test(id);
}

/** Where a browser loads a profile's portrait from: this server for an uploaded photo, else its link, or nowhere. */
export function coursePortraitSrc(profile: Pick<FuturistProfile, 'portraitImage' | 'portraitUrl'>): string | null {
  return profile.portraitImage ? `/v1/public/course-images/${profile.portraitImage}` : profile.portraitUrl;
}

/** What a portrait still needs before the course can be published with it; null when it is complete. */
export function portraitProblem(
  profile: Pick<FuturistProfile, 'portraitImage' | 'portraitUrl' | 'portraitAlt' | 'portraitCredit' | 'portraitLicense'>,
): string | null {
  if (!profile.portraitImage && !profile.portraitUrl) return 'no portrait yet';
  if (!profile.portraitAlt) return 'the portrait needs alt text';
  if (!profile.portraitCredit || !profile.portraitLicense) return 'the portrait needs a credit and a licence';
  return null;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const imageUrl = z.string().url().max(2048).nullable();

export const courseQuestionSchema = z
  .strictObject({
    /** Kept when a question is edited; the server gives a new question one. */
    questionId: z.string().trim().min(1).max(80).optional(),
    prompt: text(1000),
    choices: z.array(text(500)).min(QUIZ_LIMITS.minChoices).max(QUIZ_LIMITS.maxChoices),
    correctIndex: z.number().int().min(0),
    explanation: text(2000),
  })
  .refine((question) => question.correctIndex < question.choices.length, {
    path: ['correctIndex'],
    message: 'the correct answer must be one of the choices',
  })
  .readonly();

export const saveCourseLessonSchema = z
  .strictObject({
    lessonId: z.string().trim().min(1).max(80).optional(),
    order: z.number().int().min(1).max(1000),
    title: text(200),
    summary: text(1000),
    body: text(50_000),
    // Optional, so course packages exported before videos still read; a lesson saved without one has none.
    video: videoSchema.nullable().default(null),
    estimatedMinutes: z.number().int().min(1).max(240),
    questions: z.array(courseQuestionSchema).min(QUIZ_LIMITS.minQuestions).max(QUIZ_LIMITS.maxQuestions),
  })
  .superRefine((lesson, ctx) => {
    const ids = lesson.questions.map((question) => question.questionId).filter(Boolean);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['questions'], message: 'two questions have the same ID' });
  });
export type SaveCourseLessonInput = z.infer<typeof saveCourseLessonSchema>;

export const saveFuturistProfileSchema = z
  .strictObject({
    profileId: z.string().trim().min(1).max(80).optional(),
    order: z.number().int().min(1).max(1000),
    name: text(200),
    category: z.enum(FUTURIST_CATEGORIES),
    biography: text(5000),
    ideas: z.array(text(500)).min(1).max(8),
    quote: text(1000),
    quoteSource: text(500),
    quoteUrl: z.string().url().max(2048),
    // Required, though nullable, so an editor from before uploads gets a 400 rather than clearing an uploaded photo.
    portraitImage: z.string().regex(COURSE_IMAGE_ID, 'not an uploaded photo').nullable(),
    portraitUrl: imageUrl,
    portraitAlt: z.string().trim().max(500),
    portraitCredit: z.string().trim().max(1000).nullable(),
    portraitLicense: z.string().trim().max(500).nullable(),
    portraitSourceUrl: imageUrl,
    furtherReadingUrl: z.string().url().max(2048),
  })
  .superRefine((profile, ctx) => {
    if (profile.portraitImage && profile.portraitUrl) {
      ctx.addIssue({ code: 'custom', path: ['portraitUrl'], message: 'use an uploaded photo or an image link, not both' });
    }
    const described = [profile.portraitImage, profile.portraitUrl, profile.portraitAlt, profile.portraitCredit, profile.portraitLicense, profile.portraitSourceUrl];
    if (described.some(Boolean) && portraitProblem(profile)) {
      ctx.addIssue({ code: 'custom', path: ['portraitUrl'], message: 'a portrait needs a photo, alt text, a credit and a licence' });
    }
  });
export type SaveFuturistProfileInput = z.infer<typeof saveFuturistProfileSchema>;

export const courseMetadataSchema = z.strictObject({ title: text(200), summary: text(2000) });
export type CourseMetadataInput = z.infer<typeof courseMetadataSchema>;

/** One answer per question, in the lesson's order; the server checks the count and range against the lesson. */
export const submitCourseQuizSchema = z.strictObject({
  answers: z
    .array(z.number().int().min(0).max(QUIZ_LIMITS.maxChoices - 1))
    .min(QUIZ_LIMITS.minQuestions)
    .max(QUIZ_LIMITS.maxQuestions),
});
export type SubmitCourseQuizInput = z.infer<typeof submitCourseQuizSchema>;

