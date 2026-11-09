import type {
  MessagePeopleMatch,
  MessagePerson,
  MessageReportView,
  MessageView,
  MyNotificationsView,
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
