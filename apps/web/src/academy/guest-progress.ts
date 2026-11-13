import { CLAIM_LIMIT, type ClaimCourseProgressInput } from 'ustp-domain';

/**
 * A course taken without signing in (design §10.8, "Open without sign-in"): the api marks each quiz and keeps nothing,
 * so the lessons a visitor passed, with the answers that passed them, are kept here, in this browser only, one entry
 * per course. On signing in they are sent to be marked again into the account (`claim-guest-progress.ts`), which
 * issues the certificate once every lesson is passed, and forgotten here.
 */

const PREFIX = 'ustp.course-guest.';

/** What one passed lesson keeps: the answers, one per question in order, and the score they got. */
export interface GuestLesson {
  readonly answers: readonly number[];
  readonly score: number;
}

export interface GuestProgress {
  readonly courseId: string;
  /** The course's title when the lessons were passed, for the message once they are claimed. */
  readonly title: string;
  /** The published version they were marked against; only that version can be claimed. */
  readonly version: number;
  readonly passed: Readonly<Record<string, GuestLesson>>;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** localStorage, or none where the browser refuses it (a private window, storage blocked): then nothing is kept. */
function browserStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isAnswers = (value: unknown): value is number[] => Array.isArray(value) && value.length > 0 && value.every((n) => Number.isInteger(n) && n >= 0);

/** The entry as kept, if it is one: anything else (an edited or older entry) reads as nothing. */
function parse(courseId: string, text: string | null): GuestProgress | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<GuestProgress>;
    if (value.courseId !== courseId || typeof value.title !== 'string' || !Number.isInteger(value.version) || typeof value.passed !== 'object' || !value.passed) {
      return null;
    }
    const passed: Record<string, GuestLesson> = {};
    for (const [lessonId, lesson] of Object.entries(value.passed)) {
      if (isAnswers(lesson?.answers) && typeof lesson.score === 'number') passed[lessonId] = { answers: lesson.answers, score: lesson.score };
    }
    return { courseId, title: value.title, version: value.version!, passed };
  } catch {
    return null;
  }
}

/** The lessons of this course passed in this browser without signing in, if any. */
export function readGuestProgress(courseId: string, store: Store | null = browserStore()): GuestProgress | null {
  try {
    return parse(courseId, store?.getItem(PREFIX + courseId) ?? null);
  } catch {
    return null;
  }
}

/**
 * Keeps a lesson passed without signing in. Progress kept for another version of the course is dropped first, since
 * only the version the page shows can be claimed. False when the browser keeps nothing.
 */
export function keepGuestPass(
  course: { readonly courseId: string; readonly title: string; readonly version: number },
  lessonId: string,
  lesson: GuestLesson,
  store: Store | null = browserStore(),
): boolean {
  if (!store) return false;
  const kept = readGuestProgress(course.courseId, store);
  const passed = kept?.version === course.version ? kept.passed : {};
  const next: GuestProgress = { courseId: course.courseId, title: course.title, version: course.version, passed: { ...passed, [lessonId]: lesson } };
  try {
    store.setItem(PREFIX + course.courseId, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Forgets what this browser kept of the course, once claimed or no longer claimable. */
export function forgetGuestProgress(courseId: string, store: Store | null = browserStore()): void {
  try {
    store?.removeItem(PREFIX + courseId);
  } catch {
    // Nothing to forget.
  }
}

/** Every course this browser holds lessons for, each with at least one lesson passed. */
export function allGuestProgress(store: Store | null = browserStore()): GuestProgress[] {
  if (!store) return [];
  const found: GuestProgress[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const progress = parse(key.slice(PREFIX.length), store.getItem(key));
      if (progress && Object.keys(progress.passed).length) found.push(progress);
    }
  } catch {
    return found;
  }
  return found;
}

/** What `POST /v1/courses/{courseId}/claim` takes for what was kept: each lesson passed, with its answers. */
export function claimOf(progress: GuestProgress): ClaimCourseProgressInput {
  const lessons = Object.entries(progress.passed)
    .slice(0, CLAIM_LIMIT)
    .map(([lessonId, lesson]) => ({ lessonId, answers: [...lesson.answers] }));
  return { version: progress.version, lessons };
}
