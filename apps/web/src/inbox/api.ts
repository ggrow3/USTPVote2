import type {
  InboxPage,
  InboxStatus,
  InboxTeamMember,
  InboxThreadView,
  MessagePeopleMatch,
  MessagePerson,
  MessageReportView,
  MessageView,
  MyNotificationsView,
  MyTeamThreadSummary,
  MyTeamThreadView,
  NotificationEmailChoice,
  NotificationEmailView,
  ThreadSummary,
  ThreadView,
} from 'ustp-domain';
import { api } from '../api.js';

/** The inbox's API (design §10.13, §12): notifications, how they come by email, and messages between members. */

export function myNotifications(): Promise<MyNotificationsView> {
  return api<MyNotificationsView>('GET', '/v1/me/notifications');
}

export function unreadNotifications(): Promise<{ unread: number }> {
  return api<{ unread: number }>('GET', '/v1/me/notifications/unread');
}

export function readNotification(notificationId: string): Promise<void> {
  return api<void>('POST', `/v1/me/notifications/${encodeURIComponent(notificationId)}/read`);
}

export function readAllNotifications(): Promise<MyNotificationsView> {
  return api<MyNotificationsView>('POST', '/v1/me/notifications/read-all');
}

export function notificationEmail(): Promise<NotificationEmailView> {
  return api<NotificationEmailView>('GET', '/v1/me/notification-email');
}

export function setNotificationEmail(notificationEmail: NotificationEmailChoice): Promise<NotificationEmailView> {
  return api<NotificationEmailView>('PUT', '/v1/me/notification-email', { notificationEmail });
}

export function threads(): Promise<ThreadSummary[]> {
  return api<ThreadSummary[]>('GET', '/v1/messages');
}

export function thread(threadId: string, before?: string): Promise<ThreadView> {
  const query = before ? `?${new URLSearchParams({ before })}` : '';
  return api<ThreadView>('GET', `/v1/messages/${encodeURIComponent(threadId)}${query}`);
}

export function readThread(threadId: string): Promise<void> {
  return api<void>('POST', `/v1/messages/${encodeURIComponent(threadId)}/read`);
}

export function messagePeople(name: string): Promise<MessagePeopleMatch[]> {
  return api<MessagePeopleMatch[]>('GET', `/v1/messages/people?${new URLSearchParams({ name })}`);
}

export interface MessageTarget {
  readonly person: MessagePerson;
  readonly threadId: string;
  readonly exists: boolean;
  readonly blocking: boolean;
}

export function messagePerson(accountId: string): Promise<MessageTarget> {
  return api<MessageTarget>('GET', `/v1/messages/people/${encodeURIComponent(accountId)}`);
}

export function sendMessage(to: string, body: string): Promise<{ threadId: string; message: MessageView }> {
  return api<{ threadId: string; message: MessageView }>('POST', '/v1/messages', { to, body });
}

export function blockMember(accountId: string): Promise<void> {
  return api<void>('POST', `/v1/messages/blocks/${encodeURIComponent(accountId)}`);
}

export function unblockMember(accountId: string): Promise<void> {
  return api<void>('DELETE', `/v1/messages/blocks/${encodeURIComponent(accountId)}`);
}

export function reportMessage(messageId: string, reason: string): Promise<MessageView> {
  return api<MessageView>('POST', `/v1/messages/reports/${encodeURIComponent(messageId)}`, { reason });
}

/** Membership Admin: the reported messages. */
export function messageReports(): Promise<MessageReportView[]> {
  return api<MessageReportView[]>('GET', '/v1/admin/message-reports');
}

export function closeMessageReport(reportId: string, note: string): Promise<void> {
  return api<void>('POST', `/v1/admin/message-reports/${encodeURIComponent(reportId)}/close`, note ? { note } : {});
}

// --- The membership inbox (design §10.13) ----------------------------------------------------------------------------

/** Membership Admin: a page of the shared inbox, or one member's conversations with the team. */
export function inboxPage(query: { status?: InboxStatus | 'all'; assigned?: 'me' | 'nobody'; account?: string; after?: string }): Promise<InboxPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return api<InboxPage>('GET', `/v1/admin/inbox?${params}`);
}

export function inboxThread(threadId: string): Promise<InboxThreadView> {
  return api<InboxThreadView>('GET', `/v1/admin/inbox/${encodeURIComponent(threadId)}`);
}

/** The Membership Admins, to give a conversation to. */
export function inboxTeam(): Promise<InboxTeamMember[]> {
  return api<InboxTeamMember[]>('GET', '/v1/admin/inbox/team');
}

export function startInboxConversation(input: { accountId: string; subject: string; body: string }): Promise<InboxThreadView> {
  return api<InboxThreadView>('POST', '/v1/admin/inbox', input);
}

/** The team answers (and closes it, if asked), or adds a note only the team sees. */
export function replyInInbox(threadId: string, input: { body: string; note?: boolean; close?: boolean }): Promise<InboxThreadView> {
  return api<InboxThreadView>('POST', `/v1/admin/inbox/${encodeURIComponent(threadId)}/messages`, input);
}

export function setInboxStatus(threadId: string, status: 'open' | 'closed'): Promise<InboxThreadView> {
  return api<InboxThreadView>('POST', `/v1/admin/inbox/${encodeURIComponent(threadId)}/status`, { status });
}

export function assignInbox(threadId: string, accountId: string | null): Promise<InboxThreadView> {
  return api<InboxThreadView>('POST', `/v1/admin/inbox/${encodeURIComponent(threadId)}/assign`, { accountId });
}

/** The caller's conversations with the membership team. */
export function myTeamThreads(): Promise<MyTeamThreadSummary[]> {
  return api<MyTeamThreadSummary[]>('GET', '/v1/membership-team');
}

export function myTeamThread(threadId: string): Promise<MyTeamThreadView> {
  return api<MyTeamThreadView>('GET', `/v1/membership-team/${encodeURIComponent(threadId)}`);
}

export function writeToTeam(subject: string, body: string): Promise<MyTeamThreadView> {
  return api<MyTeamThreadView>('POST', '/v1/membership-team', { subject, body });
}

export function answerTeam(threadId: string, body: string): Promise<MyTeamThreadView> {
  return api<MyTeamThreadView>('POST', `/v1/membership-team/${encodeURIComponent(threadId)}`, { body });
}

export function readTeamThread(threadId: string): Promise<void> {
  return api<void>('POST', `/v1/membership-team/${encodeURIComponent(threadId)}/read`);
}
