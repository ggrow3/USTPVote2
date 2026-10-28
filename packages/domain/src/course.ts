import { z } from 'zod';

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
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

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
  /** A public-domain or open-licence image.  Null is allowed only while a Course Administrator is preparing a draft. */
  readonly portraitUrl: string | null;
  readonly portraitAlt: string;
  readonly portraitCredit: string | null;
  readonly portraitLicense: string | null;
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
}

export interface LearnerCourseView extends CourseCatalog {
  readonly progress: CourseProgressRecord | null;
  readonly certificate: Pick<CourseCertificateRecord, 'certificateId' | 'issuedAt' | 'courseVersion'> | null;
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

const text = (max: number) => z.string().trim().min(1).max(max);
const imageUrl = z.string().url().max(2048).nullable();

export const courseQuestionSchema = z
  .strictObject({
    questionId: z.string().trim().min(1).max(80),
    prompt: text(1000),
    choices: z.array(text(500)).length(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: text(2000),
  })
  .readonly();

export const saveCourseLessonSchema = z.strictObject({
  lessonId: z.string().trim().min(1).max(80).optional(),
  order: z.number().int().min(1).max(1000),
  title: text(200),
  summary: text(1000),
  body: text(50_000),
  estimatedMinutes: z.number().int().min(1).max(240),
  questions: z.array(courseQuestionSchema).length(5),
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
    portraitUrl: imageUrl,
    portraitAlt: z.string().trim().max(500),
    portraitCredit: z.string().trim().max(1000).nullable(),
    portraitLicense: z.string().trim().max(500).nullable(),
    portraitSourceUrl: imageUrl,
    furtherReadingUrl: z.string().url().max(2048),
  })
  .superRefine((profile, ctx) => {
    const imageFields = [profile.portraitUrl, profile.portraitCredit, profile.portraitLicense, profile.portraitSourceUrl];
    if (imageFields.some(Boolean) && imageFields.some((field) => !field)) {
      ctx.addIssue({ code: 'custom', path: ['portraitUrl'], message: 'a portrait needs a URL, credit, licence and source link' });
    }
  });
export type SaveFuturistProfileInput = z.infer<typeof saveFuturistProfileSchema>;

export const courseMetadataSchema = z.strictObject({ title: text(200), summary: text(2000) });
export type CourseMetadataInput = z.infer<typeof courseMetadataSchema>;

export const submitCourseQuizSchema = z.strictObject({
  answers: z.array(z.number().int().min(0).max(3)).length(5),
});
export type SubmitCourseQuizInput = z.infer<typeof submitCourseQuizSchema>;

