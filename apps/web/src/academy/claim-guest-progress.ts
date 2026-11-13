import { Notify } from 'quasar';
import { reactive } from 'vue';
import type { CourseCertificateRecord, CourseProgressRecord } from 'ustp-domain';
import { api, ApiError, errorMessage } from '../api.js';
import { allGuestProgress, claimOf, forgetGuestProgress } from './guest-progress.js';

/** What `POST /v1/courses/{courseId}/claim` answers. */
interface ClaimResult {
  readonly claimed: number;
  readonly progress: CourseProgressRecord;
  readonly certificate: Pick<CourseCertificateRecord, 'certificateId' | 'issuedAt' | 'courseVersion'> | null;
}

/** How many courses' progress has been claimed in this tab, for a course page to load the account's again. */
export const guestClaims = reactive({ count: 0 });

let running: Promise<void> | null = null;

/**
 * Moves the lessons this browser passed without signing in into the account just signed in to (design §10.8, "Open
 * without sign-in"), one course at a time, and says so, with a link to the course. What the api cannot take (a course
 * with a new version since, a course gone) is forgotten, saying why; what fails otherwise (offline, a second factor
 * still to set up) is kept for the next sign-in.
 */
export function claimGuestProgress(open: (path: string) => void): Promise<void> {
  running ??= claimAll(open).finally(() => (running = null));
  return running;
}

async function claimAll(open: (path: string) => void): Promise<void> {
  for (const progress of allGuestProgress()) {
    const action = { label: 'Open the course', color: 'white', handler: () => open(`/course/${progress.courseId}`) };
    try {
      const result = await api<ClaimResult>('POST', `/v1/courses/${progress.courseId}/claim`, claimOf(progress));
      forgetGuestProgress(progress.courseId);
      guestClaims.count++;
      const lessons = `${result.claimed} ${result.claimed === 1 ? 'lesson' : 'lessons'}`;
      Notify.create({
        type: 'positive',
        message: result.certificate
          ? `Your certificate for ${progress.title} is ready: the ${lessons} you passed are in your account.`
          : `The ${lessons} of ${progress.title} you passed are saved to your account.`,
        actions: [action],
        timeout: 10_000,
      });
    } catch (e) {
      if (!(e instanceof ApiError) || ![400, 404, 409].includes(e.status)) continue;
      forgetGuestProgress(progress.courseId);
      Notify.create({ type: 'warning', message: `Your answers in ${progress.title} could not be saved: ${errorMessage(e)}`, actions: [action], timeout: 10_000 });
    }
  }
}
