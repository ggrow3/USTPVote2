import { reactive } from 'vue';
import type { ApplicationQueueSummary } from 'ustp-domain';
import { hasRole } from '../session.js';
import { applicationQueueSummary } from './api.js';

/**
 * How many applications wait for a decision (design §5.2), for the count beside Admin in the menu and on the console's
 * Applications tab. Loaded for Membership Admins only; null for everyone else and until it has loaded. A failed load
 * (no second factor yet, offline) leaves no count rather than an error: the Applications tab says what is wrong.
 */
export const applicationQueue = reactive<{ summary: ApplicationQueueSummary | null }>({ summary: null });

export async function refreshApplicationQueue(): Promise<void> {
  if (!hasRole('membership_admin')) {
    applicationQueue.summary = null;
    return;
  }
  try {
    applicationQueue.summary = await applicationQueueSummary();
  } catch {
    applicationQueue.summary = null;
  }
}
