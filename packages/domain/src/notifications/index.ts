/** The notifications context (design §6.8): official election notices by email, recorded per recipient. */
export {
  NOTICE_KINDS,
  REMINDER_HOURS_BEFORE_CLOSE,
  RECIPIENT_STATUSES,
  NOTICE_OUTCOMES,
  MAX_SEND_ATTEMPTS,
  NOTICE_CLAIM_MINUTES,
  noticeId,
  isNoticeKind,
  noticeSummary,
  noticeDelivery,
  isClaimable,
  isStaleClaim,
  isVotingOpen,
  reminderTime,
  hasReminder,
  isReminderDue,
  checkNoticeResend,
} from './notices.js';
export type {
  NoticeKind,
  NoticeDelivery,
  RecipientStatus,
  NoticeOutcome,
  NoticeRecord,
  NoticeRecipientRecord,
  OutboxMessageRecord,
  RecipientCounts,
  NoticeSummary,
  NoticesView,
  NoticeSentPayload,
  NoticeResendPayload,
} from './notices.js';
export {
  NOTICE_TIME_ZONES,
  NOTICE_CONTACT_PLACEHOLDER,
  noticeMessage,
  votingOpenMessage,
  closingSoonMessage,
  votingWindow,
  zoneTime,
  timeLeft,
} from './message.js';
export type { NoticeElection, NoticeMessage, NoticeMessageInput } from './message.js';
export { noticeSteps, emailStepStatus } from './notice-steps.js';
export type { NoticeStep } from './notice-steps.js';
