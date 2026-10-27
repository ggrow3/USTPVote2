import { reactive } from 'vue';
import type { NoticesView } from 'ustp-domain';
import { electionNotices } from './api.js';

/**
 * An election's notices as the editor last loaded them (design §6.8), shared by the "Email to voters" card and the
 * workflow, so both show the same counts from one request. The card reloads them while they are being sent.
 */
const views = reactive(new Map<string, NoticesView>());
const loading = new Map<string, Promise<void>>();

export function noticesOf(electionId: string): NoticesView | null {
  return views.get(electionId) ?? null;
}

/** Fetches the election's notices; a call while one is under way waits for it rather than asking again. */
export function loadNotices(electionId: string): Promise<void> {
  const running = loading.get(electionId);
  if (running) return running;
  const load = electionNotices(electionId)
    .then((view) => void views.set(electionId, view))
    .finally(() => loading.delete(electionId));
  loading.set(electionId, load);
  return load;
}
