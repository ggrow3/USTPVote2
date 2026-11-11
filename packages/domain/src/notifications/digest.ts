import { nextDigestAt } from '../inbox/notifications.js';
import { MAX_BROADCAST_SUBJECT } from './broadcasts.js';

/**
 * The weekly digest (design §10.14): one email a week to the Active members who opted in to party email, saying what is
 * new on the site since the last one, so that members who do not open the site still hear of a vote, a news post or a
 * course. It is written by the worker and sent as an email to members is (§10.12), with the same gate, the same record
 * and, where System Admins have switched approval on, the same wait for one of them. A week with nothing new sends
 * nothing. Off until a System Admin switches it on.
 */

/** At most this many of each kind are listed; the rest are on the site. */
export const DIGEST_LIST_MAX = 8;

export interface DigestContent {
  /** Votes open now, soonest to close first. Never a rehearsal. */
  readonly elections: readonly { readonly title: string; readonly closesAt: string }[];
  /** News posts published since the last digest, newest first. */
  readonly news: readonly { readonly title: string; readonly slug: string }[];
  /** Courses published, or published again with changes, since the last digest. */
  readonly courses: readonly { readonly title: string; readonly courseId: string }[];
}

export function digestIsEmpty(content: DigestContent): boolean {
  return !content.elections.length && !content.news.length && !content.courses.length;
}

/** `mail_digest/weekly`: when the next digest is due, and when the last one was looked at (what the next one covers from). */
export interface DigestStateRecord {
  readonly dueAt: string;
  readonly lastAt: string;
}

/** Mondays at 13:00 UTC, as the members' own weekly notification digests (§10.13). */
export function nextWeeklyDigestAt(now: Date): string {
  return nextDigestAt('weekly', now)!;
}

const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The digest as an email to members: a subject and plain text, which that email escapes; blank lines make paragraphs.
 * Each item is a line with its address, since the text carries no markup.
 */
export function digestMessage(input: { readonly origin: string; readonly content: DigestContent }): { subject: string; body: string } {
  const { origin, content } = input;
  const parts: string[] = [];
  const heads: string[] = [];
  const listed = <T>(items: readonly T[], line: (item: T) => string, more: string) => [
    ...items.slice(0, DIGEST_LIST_MAX).map(line),
    ...(items.length > DIGEST_LIST_MAX ? [`And ${items.length - DIGEST_LIST_MAX} more: ${more}`] : []),
  ];
  if (content.elections.length) {
    heads.push(count(content.elections.length, 'vote open', 'votes open'));
    parts.push(
      [
        content.elections.length === 1 ? 'A vote is open:' : 'Votes are open:',
        ...listed(content.elections, (e) => `- ${oneLine(e.title)} (closes ${DAY.format(new Date(e.closesAt))}, UTC)`, `${origin}/ballot`),
        `Your ballots: ${origin}/ballot`,
      ].join('\n'),
    );
  }
  if (content.news.length) {
    heads.push(count(content.news.length, 'news post', 'news posts'));
    parts.push(['New on the News page:', ...listed(content.news, (n) => `- ${oneLine(n.title)}: ${origin}/news/${n.slug}`, `${origin}/news`)].join('\n'));
  }
  if (content.courses.length) {
    heads.push(count(content.courses.length, 'course', 'courses'));
    parts.push(
      ['Courses published or updated:', ...listed(content.courses, (c) => `- ${oneLine(c.title)}: ${origin}/course/${c.courseId}`, `${origin}/courses`)].join('\n'),
    );
  }
  const subject = `This week at the US Transhumanist Party: ${heads.join(', ')}`.slice(0, MAX_BROADCAST_SUBJECT);
  const body = ['Here is what is new on the party’s site since the last weekly digest.', ...parts, 'This digest goes once a week, and only in a week with something new.'].join('\n\n');
  return { subject, body };
}
