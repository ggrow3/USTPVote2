/** The notifications context (design §6.7): official election notices by email, recorded per recipient. */
export {
  NOTICE_KINDS,
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
export { NOTICE_TIME_ZONES, votingOpenMessage, votingWindow, zoneTime } from './message.js';
export type { NoticeElection, NoticeMessage } from './message.js';
