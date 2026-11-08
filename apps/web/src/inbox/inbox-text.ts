import type { AppNotificationKind, NotificationEmailChoice, NotificationEmailView } from 'ustp-domain';

/** Wording for notifications and messages (design §10.13). */

/** The bell's name for screen readers, with how many are unread. */
export function bellLabel(unread: number): string {
  if (unread === 0) return 'Notifications, none unread';
  return `Notifications, ${unread > 99 ? 'more than 99' : unread} unread`;
}

/** Each kind's icon, beside its words. */
export const NOTIFICATION_ICONS: Readonly<Record<AppNotificationKind, string>> = {
  message: 'mail',
  message_report: 'flag',
  broadcast_approval: 'mark_email_unread',
  broadcast_decided: 'outgoing_mail',
};

/** The badge on the bell: the count, capped so it fits. */
export function badgeText(unread: number): string {
  return unread > 99 ? '99+' : String(unread);
}

/** A notification's line, with how many times it happened while unread. */
export function notificationLine(n: { readonly title: string; readonly count: number; readonly kind: string }): string {
  if (n.count <= 1) return n.title;
  if (n.kind === 'message') return `${n.title} (${n.count} new)`;
  return `${n.title} (${n.count} times)`;
}

/** When, in a few words: "just now", "5 min ago", "3 h ago", else the date. */
export function whenText(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export const EMAIL_CHOICE_LABELS: Readonly<Record<NotificationEmailChoice, { label: string; caption: string }>> = {
  off: { label: 'Not by email', caption: 'You see them on the site, under the bell at the top of each page.' },
  each: { label: 'As each comes', caption: 'One email for each new thing, and no more about it until you have read it.' },
  daily: { label: 'Once a day', caption: 'A morning email (8 or 9 a.m. Eastern Time) listing what you have not read, if anything.' },
  weekly: { label: 'Once a week', caption: 'A Monday morning email listing what you have not read, if anything.' },
};

/** Why notifications by email would not reach the member just now; null when they would (or none are asked for). */
export function emailCaveat(view: Pick<NotificationEmailView, 'notificationEmail' | 'mail' | 'sending'>): string | null {
  if (view.notificationEmail === 'off') return null;
  if (view.mail === 'unsubscribed') return 'You have unsubscribed from all email from the party, so none of these will come until you turn email back on above.';
  if (view.mail === 'email_stopped') return 'An administrator has stopped email to you, so none of these will come.';
  if (view.mail === 'no_address') return 'Your account has no email address, so none of these can come.';
  if (view.mail === 'unverified') return 'Your email address is not confirmed yet, so none of these will come until it is.';
  if (view.mail === 'bounced' || view.mail === 'complained') return 'Email to your address is stopped (it bounced or was marked as spam); try it again above.';
  if (!view.sending) return 'The party has these emails switched off for now, so none will come until a System Admin switches them on.';
  return null;
}
