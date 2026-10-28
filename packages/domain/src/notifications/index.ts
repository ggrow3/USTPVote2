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
  NOTICE_TEST_STATUSES,
  MAX_NOTICE_TESTS_PER_DAY,
  TEST_SUBJECT_PREFIX,
  noticeReceipt,
  noticeReceiptTotals,
  isTestInFlight,
  noticeTestSummary,
  checkNoticeTest,
  noticeTestRecord,
  testNoticeTag,
} from './receipts.js';
export type {
  NoticeReceiptRecord,
  SendResult,
  NoticeTestStatus,
  NoticeTestRecord,
  NoticeSendTotals,
  NoticeReceiptTotals,
  NoticeTestSummary,
  ReceiptCounts,
} from './receipts.js';
export {
  NOTICE_TIME_ZONES,
  NOTICE_CONTACT_PLACEHOLDER,
  TEST_NOTE,
  noticeMessage,
  votingOpenMessage,
  closingSoonMessage,
  votingWindow,
  zoneTime,
  timeLeft,
} from './message.js';
export type { NoticeElection, NoticeMessage, NoticeMessageInput } from './message.js';
export { noticeSteps, emailStepStatus } from './notice-steps.js';
export type { NoticeStep, NoticeAbsence } from './notice-steps.js';
export {
  NOTICE_PLACEHOLDERS,
  DEFAULT_NOTICE_TEXT,
  DEFAULT_NOTICE_SETTINGS,
  MAX_NOTICE_SUBJECT,
  MAX_NOTICE_INTRO,
  MAX_NOTICE_CONTACT,
  MIN_REMINDER_HOURS,
  MAX_REMINDER_HOURS,
  resolveNoticeSettings,
  noticeTemplateProblems,
  fillNoticeText,
  noticeSettingsSchema,
  noticeSettingsChanges,
} from './notice-settings.js';
export type {
  NoticePlaceholder,
  NoticeKindSettings,
  NoticeSettings,
  NoticeSettingsRecord,
  NoticeSettingsInput,
  NoticeSettingsChange,
  NoticeSettingsChangedPayload,
} from './notice-settings.js';
