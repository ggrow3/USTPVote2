import { reactive } from 'vue';
import { unreadNotifications } from './api.js';

/**
 * How many of the signed-in account's notifications are unread (design §10.13), for the bell: read when the app starts,
 * every minute while the page is in view, and after the account reads some. Shared by the bell and the pages.
 */
export const inbox = reactive({ unread: 0 });

const POLL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | undefined;

export async function refreshUnread(): Promise<void> {
  try {
    inbox.unread = (await unreadNotifications()).unread;
  } catch {
    // Offline, or signed out meanwhile: the next look tries again.
  }
}

/** Starts looking every minute while the page is in view; returns how to stop. */
export function watchUnread(): () => void {
  const tick = () => {
    if (document.visibilityState === 'visible') void refreshUnread();
  };
  void refreshUnread();
  clearInterval(timer);
  timer = setInterval(tick, POLL_MS);
  document.addEventListener('visibilitychange', tick);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', tick);
    inbox.unread = 0;
  };
}
