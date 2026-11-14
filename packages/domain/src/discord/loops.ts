import { z } from 'zod';
import { DIGEST_LIST_MAX, type DigestContent } from '../notifications/digest.js';
import { discordPlain } from './commands.js';
import { discordTime, type DiscordLoop } from './discord.js';

/**
 * The bot's weekly posts and its Start here message (design §10.18, "Loops"). Each weekly post has a switch of its
 * own and goes to the `community` channel on its day: the week's digest on Monday, a question as a Discord poll on
 * Wednesday, and what members did on Friday.
 */

/** The weekday (UTC; 1 is Monday) and the hour (UTC) from which each weekly post goes, until that day ends. */
export const DISCORD_LOOP_DAY: Readonly<Record<DiscordLoop, number>> = { digest: 1, question: 3, members: 5 };
export const DISCORD_LOOP_HOUR_UTC = 16;

export const DISCORD_LOOP_LABELS: Readonly<Record<DiscordLoop, string>> = {
  digest: 'The week on the site, on Mondays',
  question: 'Question of the week, on Wednesdays',
  members: 'What members did, on Fridays',
};

const DAY_MS = 86_400_000;

/** The Monday (UTC) of the week `now` is in, as `YYYY-MM-DD`: the week's name. */
export function discordWeekOf(now: Date): string {
  const day = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The week a loop's post is due for at `now`, or null when it is not its time. A post is made on its own day only: one
 * missed (the bot was off, Discord was down all day) is not made late.
 */
export function discordLoopDue(loop: DiscordLoop, now: Date): string | null {
  if (now.getUTCDay() !== DISCORD_LOOP_DAY[loop] || now.getUTCHours() < DISCORD_LOOP_HOUR_UTC) return null;
  return discordWeekOf(now);
}

/** The ref of a loop's post for a week (`digest:2026-11-16`): one is made per week, ever. */
export const discordLoopRef = (loop: DiscordLoop, week: string): string => `${loop}:${week}`;

// --- The week on the site ----------------------------------------------------------------------------------------------

/**
 * The Monday post's text: what the weekly digest email says (§10.14), as links. Votes open now, and the news posts and
 * courses published in the last seven days; all of it on the public pages already.
 */
export function discordDigestText(content: DigestContent, origin: string): string {
  const page = (path: string) => `${origin}${path}?utm_source=discord`;
  const link = (title: string, path: string) => `[${discordPlain(title)}](${page(path)})`;
  const listed = <T>(items: readonly T[], line: (item: T) => string) => [
    ...items.slice(0, DIGEST_LIST_MAX).map((item) => `• ${line(item)}`),
    ...(items.length > DIGEST_LIST_MAX ? [`…and ${items.length - DIGEST_LIST_MAX} more on the site.`] : []),
  ];
  const parts: string[] = [];
  if (content.elections.length) {
    parts.push(
      [`**${content.elections.length === 1 ? 'A vote is open' : 'Votes are open'}** ([your ballots](${page('/ballot')}))`, ...listed(content.elections, (e) => `${discordPlain(e.title)}: closes ${discordTime(e.closesAt, 'R')}`)].join('\n'),
    );
  }
  if (content.news.length) parts.push(['**News**', ...listed(content.news, (n) => link(n.title, `/news/${n.slug}`))].join('\n'));
  if (content.courses.length) parts.push(['**Courses published or updated**', ...listed(content.courses, (c) => link(c.title, `/course/${c.courseId}`))].join('\n'));
  return parts.join('\n\n');
}

// --- Question of the week ----------------------------------------------------------------------------------------------

/** Discord's own limits on a poll. */
export const DISCORD_POLL_QUESTION_LIMIT = 300;
export const DISCORD_POLL_ANSWER_LIMIT = 55;
export const DISCORD_POLL_MAX_ANSWERS = 10;
/** How long the poll stays open on Discord: until the next one. */
export const DISCORD_POLL_HOURS = 168;
/** Questions waiting at most. */
export const DISCORD_QUESTION_QUEUE_LIMIT = 52;

const line = (max: number) => z.string().trim().min(1).max(max);

/** `POST /v1/admin/discord/questions`: a question for a coming week, with the answers people choose from. */
export const discordQuestionSchema = z.strictObject({
  question: line(DISCORD_POLL_QUESTION_LIMIT),
  answers: z
    .array(line(DISCORD_POLL_ANSWER_LIMIT))
    .min(2, 'a question needs at least two answers to choose from')
    .max(DISCORD_POLL_MAX_ANSWERS)
    .refine((answers) => new Set(answers.map((a) => a.toLowerCase())).size === answers.length, 'two answers are the same'),
});
export type DiscordQuestionInput = z.infer<typeof discordQuestionSchema>;

/** `discord_questions/{questionId}`: a question of the week. The oldest waiting one is posted each Wednesday. */
export interface DiscordQuestionRecord {
  readonly questionId: string;
  readonly question: string;
  readonly answers: readonly string[];
  readonly status: 'waiting' | 'posted' | 'failed';
  readonly createdAt: string;
  readonly createdBy: string;
  /** The week it was posted for. */
  readonly week: string | null;
  readonly postedAt: string | null;
  readonly messageId: string | null;
  readonly problem: string | null;
}

/**
 * The question as a Discord poll, which people answer in Discord itself: the site never learns who chose what. A poll
 * is plain text to Discord, so nothing in it can mention anyone.
 */
export function discordPollMessage(question: Pick<DiscordQuestionRecord, 'question' | 'answers'>): Record<string, unknown> {
  return {
    poll: {
      question: { text: question.question },
      answers: question.answers.map((text) => ({ poll_media: { text } })),
      duration: DISCORD_POLL_HOURS,
      allow_multiselect: false,
    },
    allowed_mentions: { parse: [] },
  };
}

// --- What members did --------------------------------------------------------------------------------------------------

/** How many names one line of the weekly post lists at most; the rest are counted. */
export const DISCORD_CELEBRATE_NAMES = 20;

/**
 * A week of what members did, as the Friday post says it: totals, and the Discord accounts of those who ticked
 * "Celebrate my milestones on Discord". Nothing about votes: who voted is never said, and turnout is on the results.
 */
export interface DiscordMembersWeek {
  readonly week: string;
  /** People whose membership was approved this week. */
  readonly joined: number;
  /** Courses finished this week (one person finishing two counts twice). */
  readonly coursesFinished: number;
  /** Discord user IDs of new members who chose to be named. */
  readonly welcome: readonly string[];
  /** Discord user IDs of members who finished a course and chose to be named, with the course. */
  readonly finishers: readonly { readonly discordUserId: string; readonly course: string }[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whether the week has anything to say; a week with nothing gets no post. */
export const discordMembersWeekHasNews = (week: DiscordMembersWeek): boolean => week.joined > 0 || week.coursesFinished > 0;

/**
 * The Friday post's text. A named member appears as a Discord mention, which shows the name they use on the server;
 * the message is sent so that it notifies nobody.
 */
export function discordMembersWeekText(week: DiscordMembersWeek): string {
  const lines: string[] = [];
  const names = (ids: readonly string[]) => {
    const shown = ids.slice(0, DISCORD_CELEBRATE_NAMES).map((id) => `<@${id}>`);
    return ids.length > shown.length ? `${shown.join(', ')} and ${ids.length - shown.length} more` : shown.join(', ');
  };
  if (week.joined > 0) {
    lines.push(`**${plural(week.joined, 'new member', 'new members')}** joined the party.${week.welcome.length ? ` Welcome, ${names(week.welcome)}!` : ''}`);
  }
  if (week.coursesFinished > 0) {
    lines.push(`**${plural(week.coursesFinished, 'course', 'courses')}** finished.`);
    const byCourse = new Map<string, string[]>();
    for (const f of week.finishers) byCourse.set(f.course, [...(byCourse.get(f.course) ?? []), f.discordUserId]);
    for (const [course, ids] of byCourse) lines.push(`• ${discordPlain(course)}: ${names(ids)}`);
  }
  lines.push('Members are named here only if they chose to be, on their Account page.');
  return lines.join('\n');
}

// --- Start here --------------------------------------------------------------------------------------------------------

/** `discord_state/start_here`: the pinned Start here message, and a Communications Admin's request to post it or bring it up to date. */
export interface DiscordStartHereRecord {
  readonly status: 'waiting' | 'posted' | 'failed';
  readonly channelId: string;
  /** The message, once posted; a later request changes it in place rather than posting another. */
  readonly messageId: string | null;
  /** The channel the message is in; a request for another channel posts it there anew. */
  readonly postedIn: string | null;
  readonly pinned: boolean;
  readonly problem: string | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly doneAt: string | null;
}

/** The Start here message: how to join, how to link an account, and what is open now. */
export function discordStartHereMessage(origin: string): Record<string, unknown> {
  const page = (path: string) => `${origin}${path}?utm_source=discord`;
  return {
    embeds: [
      {
        title: 'Start here',
        url: page('/'),
        description: [
          `**[Join the party](${page('/register')})**: register on the site. Once your application is approved you can vote in party elections, take the courses and join teams.`,
          `**[Link your account](${page('/account')})**: members who connect Discord on their Account page get the Member role here, and its channels.`,
          `**[What's open now](${page('/ballot')})**: the votes open on the site. In any channel, \`/vote\` lists them, and \`/help\` shows what else the bot answers.`,
        ].join('\n\n'),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
