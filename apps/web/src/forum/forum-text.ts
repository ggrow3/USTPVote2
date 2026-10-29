import type {
  ElectionState,
  ForumBallotView,
  ForumCommentSort,
  ForumFeed,
  ForumPostKind,
  ForumReportReason,
  ForumSort,
  ForumState,
} from 'ustp-domain';

/** Wording for the forum (design §5.8). */

export const SORT_LABELS: Readonly<Record<ForumSort, string>> = { hot: 'Hot', new: 'New', top: 'Top' };
export const SORT_ICONS: Readonly<Record<ForumSort, string>> = { hot: 'local_fire_department', new: 'schedule', top: 'trending_up' };

export const FEED_LABELS: Readonly<Record<ForumFeed, string>> = {
  all: 'Everything',
  discussion: 'Discussions',
  proposal: 'Proposals',
  removed: 'Removed',
};

export const COMMENT_SORT_LABELS: Readonly<Record<ForumCommentSort, string>> = { best: 'Best', top: 'Top', new: 'Newest', old: 'Oldest' };

export const KIND_LABELS: Readonly<Record<ForumPostKind, string>> = { discussion: 'Discussion', proposal: 'Proposal' };
export const KIND_CAPTIONS: Readonly<Record<ForumPostKind, string>> = {
  discussion: 'A question, idea or topic to talk over.',
  proposal: 'Something the party should adopt: a plank, a bylaws change, a resolution. An Election Admin may put it on a ballot.',
};

export const REPORT_REASON_LABELS: Readonly<Record<ForumReportReason, string>> = {
  spam: 'Spam or advertising',
  harassment: 'Harassment or abuse',
  off_topic: 'Not party business',
  misleading: 'Misleading',
  other: 'Something else',
};

/** What a member who cannot see a post or comment reads in its place. */
export function goneText(state: ForumState): string {
  return state === 'removed' ? '[removed by a Membership Admin]' : state === 'deleted' ? '[deleted by its author]' : '';
}

const ELECTION_STATES: Readonly<Record<ElectionState | 'deleted', string>> = {
  draft: 'being prepared',
  scheduled: 'scheduled',
  open: 'voting now',
  closed: 'voting closed',
  certified: 'certified',
  cancelled: 'cancelled',
  deleted: 'no longer exists',
};

/** "On the ballot of 2027 Platform Vote (voting now)". */
export function ballotLine(b: ForumBallotView): string {
  return `On the ballot of ${b.electionTitle} (${ELECTION_STATES[b.state]})`;
}

/** Where a member can follow an election a proposal is on: the ballot while voting, then the results. */
export function ballotLink(b: ForumBallotView): string | null {
  if (b.state === 'scheduled' || b.state === 'open') return `/ballot/${encodeURIComponent(b.electionId)}`;
  if (b.state === 'closed' || b.state === 'certified') return `/results/${encodeURIComponent(b.electionId)}`;
  return null;
}

/** "3 points", "1 point", "−2 points". */
export function pointsLine(score: number): string {
  return `${score < 0 ? `−${-score}` : score} ${Math.abs(score) === 1 ? 'point' : 'points'}`;
}

export function commentsLine(n: number): string {
  return n === 0 ? 'No comments' : n === 1 ? '1 comment' : `${n} comments`;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", then the date. */
export function ago(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86_400) return relative.format(-Math.floor(seconds / 3600), 'hour');
  if (seconds < 30 * 86_400) return relative.format(-Math.floor(seconds / 86_400), 'day');
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A run of text, or a link in it. */
export type TextPart = { readonly text: string; readonly href?: string };

const URL = /\bhttps?:\/\/[^\s<>"']+/g;
/** Punctuation that usually ends a sentence after a link rather than belonging to it. */
const TRAILING = /[.,;:!?)\]]+$/;

/**
 * Splits plain text into runs and `http(s)://` links, so a page can show links without reading the text as HTML. A
 * closing bracket stays in a link only if the link opened one.
 */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(URL)) {
    let href = match[0];
    const trail = href.match(TRAILING)?.[0] ?? '';
    if (trail) {
      const keep = trail.startsWith(')') && href.includes('(') ? 1 : 0;
      href = href.slice(0, href.length - trail.length + keep);
    }
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ text: href, href });
    at = match.index + href.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** The text in paragraphs (split on blank lines), each as runs and links. */
export function paragraphs(text: string): TextPart[][] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(linkParts);
}
