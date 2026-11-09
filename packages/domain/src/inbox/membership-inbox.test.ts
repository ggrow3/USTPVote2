import { describe, expect, it } from 'vitest';
import { membershipMessageEmail } from '../notifications/message.js';
import { APP_NOTIFICATION_KINDS, EMAILED_ON_THEIR_OWN, nextAppNotification } from './notifications.js';
import {
  MAX_INBOX_CONVERSATION,
  MEMBER_INBOX_MESSAGES_PER_DAY,
  MEMBER_INBOX_STARTS_PER_DAY,
  TEAM_INBOX_STARTS_PER_DAY,
  checkMemberCanWrite,
  checkTeamCanWrite,
  inboxCursor,
  inboxEmailSkip,
  inboxMessage,
  parseInboxCursor,
  teamReplySchema,
  threadAfterInboxMessage,
} from './membership-inbox.js';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 8, 10, minute)).toISOString();

const message = (from: 'member' | 'team', minute: number, note = false) =>
  inboxMessage({ messageId: `m${minute}`, threadId: 't1', accountId: 'ada', from, authorId: from === 'member' ? 'ada' : 'cy', note, body: `  Hello\n  there ${minute} `, at: at(minute) });

describe('membership inbox messages', () => {
  it('waits to email what the team writes, never a member’s message or a note', () => {
    expect(message('team', 0)).toMatchObject({ email: { status: 'pending', reason: null, at: null }, emailPending: true, note: false });
    expect(message('member', 0)).toMatchObject({ email: null, emailPending: false, note: false });
    expect(message('team', 0, true)).toMatchObject({ email: null, emailPending: false, note: true });
    // A member's message is never a note, whatever was asked.
    expect(message('member', 0, true).note).toBe(false);
  });
});

describe('the conversation after a message', () => {
  it('starts as needing an answer when the member writes, answered when the team does', () => {
    const fromMember = threadAfterInboxMessage(null, { subject: '  Dues  question ' }, message('member', 0));
    expect(fromMember).toMatchObject({
      threadId: 't1',
      accountId: 'ada',
      subject: 'Dues question',
      status: 'open',
      startedBy: 'member',
      createdBy: 'ada',
      lastFrom: 'member',
      lastText: 'Hello there 0',
      messageCount: 1,
      memberUnread: 0,
      assignedTo: null,
    });
    expect(threadAfterInboxMessage(null, { subject: 'Welcome' }, message('team', 0))).toMatchObject({ status: 'answered', startedBy: 'team', memberUnread: 1 });
    expect(threadAfterInboxMessage(null, { subject: 'Welcome', close: true }, message('team', 0)).status).toBe('closed');
  });

  it('moves between needing an answer and answered, and a member reopens a closed one', () => {
    let thread = threadAfterInboxMessage(null, { subject: 'Dues' }, message('member', 0));
    thread = threadAfterInboxMessage(thread, {}, message('team', 1));
    expect(thread).toMatchObject({ status: 'answered', lastFrom: 'team', memberUnread: 1, messageCount: 2, lastMessageAt: at(1) });
    thread = threadAfterInboxMessage(thread, { close: true }, message('team', 2));
    expect(thread).toMatchObject({ status: 'closed', memberUnread: 2 });
    thread = threadAfterInboxMessage(thread, {}, message('member', 3));
    expect(thread).toMatchObject({ status: 'open', lastFrom: 'member', memberUnread: 2, messageCount: 4 });
  });

  it('a note changes neither the status nor the last message', () => {
    const before = threadAfterInboxMessage(null, { subject: 'Dues' }, message('member', 0));
    const after = threadAfterInboxMessage(before, {}, message('team', 5, true));
    expect(after).toMatchObject({ status: 'open', lastMessageAt: at(0), lastFrom: 'member', lastText: before.lastText, memberUnread: 0, messageCount: 2, updatedAt: at(5), updatedBy: 'cy' });
  });

  it('refuses a note that would close', () => {
    expect(teamReplySchema.safeParse({ body: 'x', note: true, close: true }).success).toBe(false);
    expect(teamReplySchema.safeParse({ body: 'x', close: true }).success).toBe(true);
  });
});

describe('who may write', () => {
  const member = { status: 'active' as const, sentToday: 0, newConversation: true, startedToday: 0, messageCount: 0 };

  it('lets anyone with a member record write to the team, whatever its status', () => {
    expect(checkMemberCanWrite(member).ok).toBe(true);
    expect(checkMemberCanWrite({ ...member, status: 'lapsed' }).ok).toBe(true);
    expect(checkMemberCanWrite({ ...member, status: 'applicant' }).ok).toBe(true);
    expect(checkMemberCanWrite({ ...member, status: null })).toMatchObject({ ok: false, refusal: 'forbidden' });
  });

  it('keeps members to the day’s limits and a conversation to its length', () => {
    expect(checkMemberCanWrite({ ...member, sentToday: MEMBER_INBOX_MESSAGES_PER_DAY })).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkMemberCanWrite({ ...member, startedToday: MEMBER_INBOX_STARTS_PER_DAY })).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkMemberCanWrite({ ...member, newConversation: false, startedToday: MEMBER_INBOX_STARTS_PER_DAY }).ok).toBe(true);
    expect(checkMemberCanWrite({ ...member, newConversation: false, messageCount: MAX_INBOX_CONVERSATION })).toMatchObject({ ok: false, refusal: 'conflict' });
  });

  it('lets the team write to a member, not to themselves, and not to many in a day', () => {
    const team = { memberStatus: 'active' as const, newConversation: true, startedToday: 0, messageCount: 0, self: false };
    expect(checkTeamCanWrite(team).ok).toBe(true);
    expect(checkTeamCanWrite({ ...team, self: true }).ok).toBe(false);
    expect(checkTeamCanWrite({ ...team, memberStatus: null })).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(checkTeamCanWrite({ ...team, newConversation: false, memberStatus: null }).ok).toBe(true);
    const many = checkTeamCanWrite({ ...team, startedToday: TEAM_INBOX_STARTS_PER_DAY });
    expect(many).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(many.ok ? '' : many.reason).toContain('Email members');
  });
});

describe('the inbox list cursor', () => {
  it('round-trips, and refuses what is not one', () => {
    const cursor = inboxCursor({ lastMessageAt: at(3), threadId: 'abc' });
    expect(parseInboxCursor(cursor)).toEqual({ lastMessageAt: at(3), threadId: 'abc' });
    expect(parseInboxCursor('nonsense')).toBeNull();
    expect(parseInboxCursor('not-a-date|abc')).toBeNull();
    expect(parseInboxCursor(`${at(3)}|`)).toBeNull();
  });
});

describe('whether the team’s email reaches the member', () => {
  it('says why not', () => {
    expect(inboxEmailSkip('ok', true)).toBeNull();
    expect(inboxEmailSkip('ok', false)).toBe('email_off');
    expect(inboxEmailSkip('bounced', true)).toBe('undeliverable');
    expect(inboxEmailSkip('complained', true)).toBe('undeliverable');
    expect(inboxEmailSkip('unsubscribed', true)).toBe('unsubscribed');
    expect(inboxEmailSkip('email_stopped', true)).toBe('email_stopped');
    expect(inboxEmailSkip('unverified', true)).toBe('unverified');
    expect(inboxEmailSkip('no_address', true)).toBe('no_address');
  });

  it('sends no email-as-it-comes for a team message, which is emailed itself', () => {
    expect(EMAILED_ON_THEIR_OWN.every((k) => APP_NOTIFICATION_KINDS.includes(k))).toBe(true);
    const input = { accountId: 'ada', ref: 't1', title: 'The membership team wrote to you', link: '/messages/team/t1', at: at(0) };
    expect(nextAppNotification(null, { ...input, kind: 'membership_message' }).emailPending).toBe(false);
    expect(nextAppNotification(null, { ...input, kind: 'membership_inbox' }).emailPending).toBe(true);
  });
});

describe('the membership team’s email', () => {
  const email = membershipMessageEmail({
    origin: 'https://vote.example.org',
    name: 'Ada',
    contact: 'members@example.org',
    subject: 'Your  dues',
    reply: false,
    body: 'Your dues are paid.\n\nThank you.',
    link: '/messages/team/t1',
    unsubscribe: 'https://vote.example.org/unsubscribe?token=x',
  });

  it('carries the words, signed by the team, with a link to answer on the site', () => {
    expect(email.subject).toBe('Your dues');
    expect(email.text).toContain('Hello Ada,');
    expect(email.text).toContain('Your dues are paid.');
    expect(email.text).toContain('Thank you.');
    expect(email.text).toContain('The membership team');
    expect(email.text).toContain('https://vote.example.org/messages/team/t1');
    expect(email.text).toContain('whether or not they chose to get news and announcements');
    expect(email.text).toContain('https://vote.example.org/unsubscribe?token=x');
  });

  it('marks an answer as one, and escapes the words in HTML', () => {
    const reply = membershipMessageEmail({ origin: 'https://vote.example.org', name: null, contact: null, subject: 'Dues', reply: true, body: '<b>hi</b>', link: '/messages/team/t1' });
    expect(reply.subject).toBe('Re: Dues');
    expect(reply.html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(reply.html).not.toContain('<b>hi</b>');
  });
});
