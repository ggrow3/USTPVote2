import type { ElectionRecord } from '../elections.js';
import { UNSUBSCRIBE_PATH } from './mail-preferences.js';
import { DEFAULT_NOTICE_TEXT, fillNoticeText, type NoticePlaceholder } from './notice-settings.js';
import type { NoticeKind } from './notices.js';
import { TEST_SUBJECT_PREFIX } from './receipts.js';
import { SET_PASSWORD_PATH } from './welcome.js';

/**
 * The election notices' emails (design §6.8), as plain text and simple HTML with the same content: real text, no
 * images, and links named for what they open. Built from the election as frozen at scheduling, the web app's address,
 * the member's name and where to ask questions; nothing else about the member goes in. Pure, so the worker sends
 * exactly what the tests check and the editor previews.
 */

export type NoticeElection = Pick<ElectionRecord, 'electionId' | 'title' | 'description' | 'opensAt' | 'closesAt'>;

export interface NoticeMessage {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface NoticeMessageInput {
  readonly election: NoticeElection;
  /** Where the web app is served, e.g. `https://vote.example.org`, without a trailing slash. */
  readonly origin: string;
  /** The member's preferred (or legal) name; null to greet them without one. */
  readonly name: string | null;
  /** Where members ask about the election (an address or a web page); null until the party names one. */
  readonly contact: string | null;
  /** When the message is made: the reminder says how long is left. */
  readonly now: Date;
  /** A System Admin's subject and opening (design §6.8); null or absent for the built-in wording. */
  readonly text?: { readonly subject: string | null; readonly intro: string | null } | null;
  /** A test email to the Election Admin who asked for it: "[TEST]" leads the subject, and a note opens the message. */
  readonly test?: boolean;
  /** For a vote confirmation, when the ballot was cast; `now` when absent (a test). */
  readonly castAt?: string;
  /** The member's own unsubscribe link (design §10.12); absent in a preview, or a rehearsal's message to nobody. */
  readonly unsubscribe?: string | null;
}

/** The time zones the window is given in: the US zones members live in, then UTC. Eastern leads. */
export const NOTICE_TIME_ZONES = [
  { zone: 'America/New_York', name: 'Eastern Time' },
  { zone: 'America/Chicago', name: 'Central Time' },
  { zone: 'America/Denver', name: 'Mountain Time' },
  { zone: 'America/Los_Angeles', name: 'Pacific Time' },
  { zone: 'America/Anchorage', name: 'Alaska Time' },
  { zone: 'Pacific/Honolulu', name: 'Hawaii Time' },
  { zone: 'UTC', name: 'UTC' },
] as const;

/** Stands in for the contact until the party names one (`NOTICE_CONTACT`); real mail is never sent with it. */
export const NOTICE_CONTACT_PLACEHOLDER = '[contact for election questions, to be confirmed]';

/** The party's colour (transhumanist-party.org), 4.9:1 on white: links and the heading rule. */
const PARTY_COLOUR = '#bd4e00';

const SUBJECT_TITLE_MAX = 150;
/** However the subject is worded, mail clients show about this much. */
const SUBJECT_MAX = 200;

const capped = (s: string) => (s.length > SUBJECT_MAX ? `${s.slice(0, SUBJECT_MAX - 1)}…` : s);

/** Opens a test email, so nobody takes it for the real notice. */
export const TEST_NOTE =
  'TEST EMAIL. This was sent only to you, because you asked for a test from the election editor. Voters on the roll ' +
  'get the same email without this note, when it is due.';

export function noticeMessage(kind: NoticeKind, input: NoticeMessageInput): NoticeMessage {
  return kind === 'closing_soon' ? closingSoonMessage(input) : kind === 'voted' ? votedMessage(input) : votingOpenMessage(input);
}

/** "Voting is open": to everyone on the roll, when the election opens. */
export function votingOpenMessage(input: NoticeMessageInput): NoticeMessage {
  const { election } = input;
  const title = oneLine(election.title);
  const links = linksOf(input);
  const window = votingWindow(election.opensAt, election.closesAt);
  const description = paragraphs(election.description);
  const words = wording('voting_open', input, window[0]!.closes);
  return render(input, words.subject, words.heading, [
    greeting(input.name),
    ...words.intro.map((p) => ({ p })),
    { strong: `Vote by ${window[0]!.closes} (${window[0]!.name}).` },
    { ballot: links.ballot, title },
    { h2: 'When you can vote' },
    { window },
    { link: links.calendar, label: 'Add the voting window to your calendar', after: ' (an .ics file).' },
    ...(description.length ? [{ h2: 'About this election' }, ...description.map((p) => ({ p }))] : []),
    ...checking(links.verify),
    { hr: true },
    {
      small:
        'You are getting this email because you are on the voter roll of this election. It is an official election ' +
        'notice, sent once for each election, so it comes whatever your newsletter and announcement choices, unless you ' +
        'unsubscribe from all email from the party below.',
    },
    ...footer(input.contact, links.site, input),
  ]);
}

/** "Voting closes soon": before the close (by default a day), to those on the roll who have not voted. */
export function closingSoonMessage(input: NoticeMessageInput): NoticeMessage {
  const { election } = input;
  const title = oneLine(election.title);
  const links = linksOf(input);
  const window = votingWindow(election.opensAt, election.closesAt);
  const words = wording('closing_soon', input, window[0]!.closes);
  return render(input, words.subject, words.heading, [
    greeting(input.name),
    ...words.intro.map((p) => ({ p })),
    { p: 'If you have voted since this was sent, thank you: there is nothing more to do.' },
    { strong: `Vote by ${window[0]!.closes} (${window[0]!.name}).` },
    { ballot: links.ballot, title },
    { h2: 'When voting closes' },
    { closes: window },
    ...checking(links.verify),
    { hr: true },
    {
      small:
        'You are getting this reminder because you are on the voter roll of this election and had not voted when it ' +
        'was sent. It is sent once. Only whether you had voted was used to send it, never how anyone votes.',
    },
    ...footer(input.contact, links.site, input),
  ]);
}

/**
 * "Your vote was recorded": to each voter soon after their ballot was cast (design §6.8), so that someone who did not
 * vote learns at once that a ballot went in with their account. When it was cast, never how: no choice, commitment or
 * receipt goes in it.
 */
export function votedMessage(input: NoticeMessageInput): NoticeMessage {
  const { election } = input;
  const title = oneLine(election.title);
  const links = linksOf(input);
  const window = votingWindow(election.opensAt, election.closesAt);
  const words = wording('voted', input, window[0]!.closes);
  const cast = zoneTime(input.castAt ?? input.now.toISOString(), NOTICE_TIME_ZONES[0].zone);
  return render(input, words.subject, words.heading, [
    greeting(input.name),
    ...words.intro.map((p) => ({ p })),
    { strong: `Your ballot was recorded ${cast} (Eastern Time).` },
    {
      p:
        'If you did not vote, someone may have signed in as you: change your password on your Account page, and tell ' +
        'the party at once (below). A ballot cannot be taken back, but the party can look into it.',
    },
    ...checking(links.verify),
    { hr: true },
    {
      small:
        'You are getting this email because a ballot was cast with your account in this election. It is sent once, and ' +
        'says only when, never how you voted.',
    },
    ...footer(input.contact, links.site, input),
  ]);
}

/**
 * The welcome email to a member a Membership Admin added (design §5.13), sent where the deployment sends mail. It
 * leads to the page where they set their password, which first emails them a sign-in link to prove the address is
 * theirs; this email carries no link that signs anyone in.
 */
export function welcomeMessage(input: {
  readonly origin: string;
  readonly name: string | null;
  readonly contact: string | null;
  readonly unsubscribe?: string | null;
}): NoticeMessage {
  const site = `${input.origin}/`;
  const subject = 'Welcome to the US Transhumanist Party: set your password';
  const blocks: Block[] = [
    greeting(input.name),
    {
      p:
        'A Membership Admin has added you as a member of the US Transhumanist Party. To vote in party elections and take ' +
        "part on the party's site, set your password the first time you come.",
    },
    { link: `${input.origin}${SET_PASSWORD_PATH}`, label: 'Set your password', after: '.' },
    {
      p:
        'Enter the address this email came to. We will email you a sign-in link, which shows the address is yours; open ' +
        'it, then choose your password. Nobody at the party sets it or can see it.',
    },
    { hr: true },
    { small: 'You are getting this email because a Membership Admin added this address to the party’s member list.' },
    ...footer(input.contact, site, input, 'your membership'),
  ];
  return { subject, text: blocks.map(asText).join('\n\n'), html: asHtml(subject, subject, blocks) };
}

/**
 * The test email a member asks for on their Account page (design §10.12), to see that email from the party reaches
 * them. Nothing in it but where to look if it went to spam.
 */
export function memberTestMessage(input: {
  readonly origin: string;
  readonly name: string | null;
  readonly contact: string | null;
  readonly unsubscribe?: string | null;
}): NoticeMessage {
  const site = `${input.origin}/`;
  const subject = 'Your test email from the US Transhumanist Party';
  const blocks: Block[] = [
    greeting(input.name),
    { p: 'You asked for this test email on your Account page. It reached you, so election email from the party should too.' },
    { p: 'If it was in your spam or junk folder, mark it as not spam, so the next emails from the party land in your inbox.' },
    { link: `${input.origin}/account`, label: 'Open your Account page', after: ' to see what became of each email the party sent you.' },
    { hr: true },
    { small: 'You are getting this email because you asked for it.' },
    ...footer(input.contact, site, input),
  ];
  return { subject, text: blocks.map(asText).join('\n\n'), html: asHtml(subject, subject, blocks) };
}

/**
 * The test email a System Admin asks for in Admin › Email (design §10.12), to see that email from the site reaches a
 * System Admin, or a member, before it is switched on for everyone. It goes only to the one chosen, whether or not all
 * email is on. A member who is not a System or Site Admin cannot open that page, so theirs only says what it is.
 */
export function adminTestMessage(input: {
  readonly origin: string;
  readonly name: string | null;
  readonly contact: string | null;
  readonly unsubscribe?: string | null;
  /** Whether it goes to a System or Site Admin; true unless said otherwise. */
  readonly toSystemAdmin?: boolean;
}): NoticeMessage {
  const site = `${input.origin}/`;
  const subject = 'Test email from the US Transhumanist Party site';
  const about: Block[] =
    input.toSystemAdmin === false
      ? [
          { p: 'An administrator of the site sent you this test email, to check that the site’s email reaches members. You do not need to do anything.' },
          { p: 'If it was in your spam or junk folder, please mark it as not spam, so that the party’s emails reach you.' },
        ]
      : [
          { p: 'This test email was asked for in Admin › Email. It reached you, so the site can send email.' },
          { p: 'It went only to you. Whether the site emails members depends on the “Send email” switch on that page.' },
          { p: 'If it was in your spam or junk folder, mark it as not spam, and check how the sending domain is set up.' },
          { link: `${input.origin}/admin?tab=email`, label: 'Open Admin › Email', after: ' to see what became of it.' },
        ];
  const blocks: Block[] = [
    greeting(input.name),
    ...about,
    { hr: true },
    { small: 'You are getting this email because an administrator of the site asked for it to be sent to you.' },
    ...footer(input.contact, site, input, 'the site'),
  ];
  return { subject, text: blocks.map(asText).join('\n\n'), html: asHtml(subject, subject, blocks) };
}

/**
 * An email an admin wrote to members (design §10.12): their words, as plain text that the HTML escapes, between the
 * greeting and the usual end, which says why the member gets it and carries their unsubscribe link.
 */
export function broadcastMessage(input: {
  readonly origin: string;
  readonly name: string | null;
  readonly contact: string | null;
  readonly subject: string;
  readonly body: string;
  readonly unsubscribe?: string | null;
}): NoticeMessage {
  const site = `${input.origin}/`;
  const subject = capped(oneLine(input.subject));
  const blocks: Block[] = [
    greeting(input.name),
    ...paragraphs(input.body).map((p) => ({ p })),
    { hr: true },
    { small: 'You are getting this email because you chose to get news and announcements from the party. It came from a party administrator, not a member.' },
    ...footer(input.contact, site, input, 'this email'),
  ];
  return { subject, text: blocks.map(asText).join('\n\n'), html: asHtml(subject, subject, blocks) };
}

/**
 * The membership team's message to a member (design §10.13): its words, as plain text that the HTML escapes, signed by
 * the team rather than the admin who wrote it, with a link to the conversation on the site, where the member answers.
 * It goes as membership business, whether or not the member chose to get news and announcements, and says so.
 */
export function membershipMessageEmail(input: {
  readonly origin: string;
  readonly name: string | null;
  readonly contact: string | null;
  /** The conversation's subject; "Re: " leads it after the first message. */
  readonly subject: string;
  readonly reply: boolean;
  readonly body: string;
  /** The conversation's path in the app, e.g. `/messages/team/{threadId}`. */
  readonly link: string;
  readonly unsubscribe?: string | null;
}): NoticeMessage {
  const site = `${input.origin}/`;
  const subject = capped(`${input.reply ? 'Re: ' : ''}${oneLine(input.subject)}`);
  const blocks: Block[] = [
    greeting(input.name),
    ...paragraphs(input.body).map((p) => ({ p })),
    { p: 'The membership team' },
    { link: `${input.origin}${input.link}`, label: 'Answer on the site', after: ' (you will be asked to sign in), where the whole conversation is.' },
    { hr: true },
    {
      small:
        'You are getting this email because the party’s membership team wrote to you about your membership. Such emails go to ' +
        'members whether or not they chose to get news and announcements.',
    },
    ...footer(input.contact, site, input, 'anything else'),
  ];
  return { subject, text: blocks.map(asText).join('\n\n'), html: asHtml(subject, subject, blocks) };
}

/** How often a member has their in-app notifications by email (§10.13). */
export type NotificationEmailPeriod = 'each' | 'daily' | 'weekly';

/**
 * A member's in-app notifications by email (design §10.13): one as it came, or a digest of those unread. Each names what
 * happened and links to it on the site; a message's words are never in it, only who wrote. It says why they get it and
 * where to change that.
 */
export function notificationEmailMessage(input: {
  readonly origin: string;
  readonly name: string | null;
  readonly contact: string | null;
  readonly unsubscribe?: string | null;
  readonly period: NotificationEmailPeriod;
  /** Newest first: each one's line and its path in the app. */
  readonly items: readonly { readonly title: string; readonly link: string }[];
  /** How many more unread there are than the items listed. */
  readonly more?: number;
  /**
   * For one about the member's own application to join (design §5.2), which goes whatever they chose: more to say,
   * as paragraphs separated by blank lines, and the email says it comes because they applied.
   */
  readonly application?: { readonly detail: string | null };
}): NoticeMessage {
  const site = `${input.origin}/`;
  const first = input.items[0];
  const subject =
    input.period === 'each' && first
      ? capped(oneLine(first.title))
      : `Your ${input.period === 'daily' ? 'daily' : 'weekly'} notifications from the US Transhumanist Party`;
  const how = { each: 'as each comes', daily: 'once a day', weekly: 'once a week' }[input.period];
  const listed: Block[] =
    input.period === 'each' && first
      ? [
          { p: `${oneLine(first.title)}.` },
          ...(input.application?.detail ?? '')
            .split(/\n\s*\n/)
            .map((paragraph) => oneLine(paragraph))
            .filter(Boolean)
            .map((paragraph): Block => ({ p: paragraph })),
          { link: `${input.origin}${first.link}`, label: 'Open it on the site', after: ' (you will be asked to sign in).' },
        ]
      : [
          { p: input.items.length === 1 ? 'You have one notification you have not read:' : `You have ${input.items.length + (input.more ?? 0)} notifications you have not read:` },
          ...input.items.map((item): Block => ({ link: `${input.origin}${item.link}`, label: oneLine(item.title), after: '' })),
          ...(input.more ? [{ link: `${input.origin}/notifications`, label: `And ${input.more} more`, after: '.' } satisfies Block] : []),
        ];
  const blocks: Block[] = [
    greeting(input.name),
    ...listed,
    ...(input.application
      ? ([{ hr: true }, { small: 'You are getting this email because you applied to join the US Transhumanist Party.' }] satisfies Block[])
      : ([
          { p: 'What a member wrote is never in these emails: read it on the site.' },
          { hr: true },
          { small: `You are getting this email because you chose, on your Account page, to have your notifications by email ${how}.` },
          { link: `${input.origin}/account`, label: 'Change that on your Account page', after: '.' },
        ] satisfies Block[])),
    ...footer(input.contact, site, input, input.application ? 'your application' : 'your notifications'),
  ];
  return { subject, text: blocks.map(asText).join('\n\n'), html: asHtml(subject, subject, blocks) };
}

/** One row per time zone: the zone's name and when voting opens and closes there, each with its abbreviation. */
export function votingWindow(opensAt: string, closesAt: string): { name: string; opens: string; closes: string }[] {
  return NOTICE_TIME_ZONES.map(({ zone, name }) => ({ name, opens: zoneTime(opensAt, zone), closes: zoneTime(closesAt, zone) }));
}

/**
 * A moment in a time zone, e.g. `Monday, November 2, 2026, 9:00 AM EST` (`14:00 UTC` in UTC). Assembled from its
 * parts, so the wording does not change between ICU versions, which differ in separators and spaces.
 */
export function zoneTime(iso: string, zone: string): string {
  const utc = zone === 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: utc ? 'h23' : 'h12',
    timeZoneName: 'short',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = utc ? part('hour').padStart(2, '0') : part('hour');
  const time = `${hour}:${part('minute')}${utc ? '' : ` ${part('dayPeriod').toUpperCase()}`}`;
  return `${part('weekday')}, ${part('month')} ${part('day')}, ${part('year')}, ${time} ${part('timeZoneName')}`;
}

/** "about 23 hours", "about an hour", "less than an hour". */
export function timeLeft(closesAt: string, now: Date): string {
  const hours = Math.round((Date.parse(closesAt) - now.getTime()) / 3_600_000);
  return hours >= 2 ? `about ${hours} hours` : hours === 1 ? 'about an hour' : 'less than an hour';
}

/** Text for one line (a subject, a name): control characters and line breaks become spaces, runs of space one. */
export function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// --- composing ------------------------------------------------------------------------------------------------------

type Row = { name: string; opens: string; closes: string };

/** The parts of a message, each rendered both as text and as HTML, so the two always say the same. */
type Block =
  | { p: string }
  | { strong: string }
  | { ballot: string; title: string }
  | { link: string; label: string; before?: string; after: string }
  | { h2: string }
  | { window: Row[] }
  | { closes: Row[] }
  | { hr: true }
  | { small: string }
  | { contact: string | null; about?: string }
  | { test: string };

function linksOf({ election, origin }: NoticeMessageInput) {
  const id = encodeURIComponent(election.electionId);
  return {
    ballot: `${origin}/ballot/${id}`,
    calendar: `${origin}/v1/public/elections/${id}/calendar.ics`,
    verify: `${origin}/verify`,
    site: `${origin}/`,
  };
}

function subjectTitle(title: string): string {
  return title.length > SUBJECT_TITLE_MAX ? `${title.slice(0, SUBJECT_TITLE_MAX - 1)}…` : title;
}

/**
 * The subject, the heading (the subject with the whole title) and the opening paragraphs, from a System Admin's
 * wording or the built-in one, with the election's details filled in. The text is plain: the HTML escapes it.
 */
function wording(kind: NoticeKind, input: NoticeMessageInput, closes: string) {
  const title = oneLine(input.election.title);
  const values = (t: string): Record<NoticePlaceholder, string> => ({
    title: t,
    closes: `${closes} (Eastern Time)`,
    time_left: timeLeft(input.election.closesAt, input.now),
  });
  const subject = input.text?.subject ?? DEFAULT_NOTICE_TEXT[kind].subject;
  const intro = input.text?.intro ?? DEFAULT_NOTICE_TEXT[kind].intro;
  return {
    subject: capped(oneLine(fillNoticeText(subject, values(subjectTitle(title))))),
    heading: oneLine(fillNoticeText(subject, values(title))),
    intro: paragraphs(fillNoticeText(intro, values(title))),
  };
}

function greeting(name: string | null): Block {
  const clean = name ? oneLine(name) : '';
  return { p: clean ? `Hello ${clean},` : 'Hello,' };
}

function checking(verify: string): Block[] {
  return [
    { h2: 'Checking your vote afterwards' },
    { p: 'When you vote, the ballot page gives you a receipt. Download it and keep it to yourself: it shows how you voted.' },
    {
      link: verify,
      before: 'Once voting has closed, ',
      label: 'open the Verify page',
      after: ' and load the receipt. Your browser checks that your ballot is in the published, signed record. The receipt never leaves your browser.',
    },
  ];
}

/**
 * The end of every email: where to ask, how to stop all of it, and what the party never asks for. Without the member's
 * own link (a preview), the link leads to the page that says how to unsubscribe.
 */
function footer(
  contact: string | null,
  site: string,
  link: { readonly origin: string; readonly unsubscribe?: string | null },
  about?: string,
): Block[] {
  return [
    { contact, ...(about && { about }) },
    { link: link.unsubscribe ?? `${link.origin}${UNSUBSCRIBE_PATH}`, label: 'Unsubscribe', after: ' from all email from the party.' },
    {
      small:
        'We never ask for your password or a sign-in code by email. If you are unsure about this message, go to ' +
        `${site} yourself instead of following its links.`,
    },
    { small: 'US Transhumanist Party' },
  ];
}

function render(input: NoticeMessageInput, subject: string, heading: string, blocks: readonly Block[]): NoticeMessage {
  if (input.test) {
    subject = capped(`${TEST_SUBJECT_PREFIX}${subject}`);
    blocks = [{ test: TEST_NOTE }, ...blocks];
  }
  return { subject, text: blocks.map(asText).join('\n\n'), html: asHtml(subject, heading, blocks) };
}

function asText(block: Block): string {
  if ('p' in block) return block.p;
  if ('strong' in block) return block.strong;
  if ('ballot' in block) return `Open your ballot (you will be asked to sign in): ${block.ballot}`;
  if ('link' in block) {
    // "Once voting has closed, open the Verify page, https://…/verify, and load …" or "Add …: https://…".
    return block.before
      ? `${block.before}${block.label}, ${block.link},${block.after}`
      : `${block.label}${block.after.replace(/\.$/, '')}: ${block.link}`;
  }
  if ('h2' in block) return block.h2;
  if ('window' in block) return block.window.map((w) => `- ${w.name}: ${w.opens} to ${w.closes}`).join('\n');
  if ('closes' in block) return block.closes.map((w) => `- ${w.name}: ${w.closes}`).join('\n');
  if ('hr' in block) return '--';
  if ('test' in block) return block.test;
  if ('contact' in block) {
    return `Questions about ${block.about ?? 'this election'}? Replies to this email are not read; write to ${block.contact ? oneLine(block.contact) : NOTICE_CONTACT_PLACEHOLDER}.`;
  }
  return block.small;
}

function asHtml(subject: string, heading: string, blocks: readonly Block[]): string {
  const a = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:${PARTY_COLOUR}">${label}</a>`;
  const cell = 'padding:4px 12px 4px 0';
  const th = (label: string) => `<th scope="col" style="text-align:left;${cell};border-bottom:1px solid #757575">${label}</th>`;
  const rowHead = (name: string) => `<th scope="row" style="text-align:left;${cell};font-weight:normal">${escapeHtml(name)}</th>`;
  const table = (heads: string[], rows: string[]) =>
    [
      '<table style="border-collapse:collapse;font-size:15px">',
      `<thead><tr>${heads.map(th).join('')}</tr></thead>`,
      '<tbody>',
      ...rows,
      '</tbody>',
      '</table>',
    ].join('\n');
  const body = blocks.map((block): string => {
    if ('p' in block) return `<p>${escapeHtml(block.p).replace(/\n/g, '<br>')}</p>`;
    if ('strong' in block) return `<p><strong>${escapeHtml(block.strong)}</strong></p>`;
    if ('ballot' in block) {
      return `<p style="font-size:18px">${a(block.ballot, `Open your ballot for “${escapeHtml(block.title)}”`)}</p>\n<p>You will be asked to sign in.</p>`;
    }
    if ('link' in block) return `<p>${escapeHtml(block.before ?? '')}${a(block.link, escapeHtml(block.label))}${escapeHtml(block.after)}</p>`;
    if ('h2' in block) return `<h2 style="font-size:18px;margin:24px 0 8px">${escapeHtml(block.h2)}</h2>`;
    if ('window' in block) {
      return table(
        ['Time zone', 'Voting opens', 'Voting closes'],
        block.window.map(
          (w) => `<tr>${rowHead(w.name)}<td style="${cell}">${escapeHtml(w.opens)}</td><td style="padding:4px 0">${escapeHtml(w.closes)}</td></tr>`,
        ),
      );
    }
    if ('closes' in block) {
      return table(
        ['Time zone', 'Voting closes'],
        block.closes.map((w) => `<tr>${rowHead(w.name)}<td style="padding:4px 0">${escapeHtml(w.closes)}</td></tr>`),
      );
    }
    if ('hr' in block) return '<hr style="border:0;border-top:1px solid #757575;margin:24px 0">';
    if ('test' in block) return `<p style="padding:8px 12px;border:2px solid #000000"><strong>${escapeHtml(block.test)}</strong></p>`;
    if ('contact' in block) {
      const contact = block.contact ? oneLine(block.contact) : null;
      const where = !contact
        ? escapeHtml(NOTICE_CONTACT_PLACEHOLDER)
        : /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(contact)
          ? a(`mailto:${contact}`, escapeHtml(contact))
          : /^https:\/\/[^\s<>"]+$/.test(contact)
            ? a(contact, escapeHtml(contact))
            : escapeHtml(contact);
      return `<p style="font-size:14px">Questions about ${escapeHtml(block.about ?? 'this election')}? Replies to this email are not read; write to ${where}.</p>`;
    }
    return `<p style="font-size:14px">${escapeHtml(block.small)}</p>`;
  });
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(subject)}</title>`,
    '</head>',
    '<body style="margin:0;padding:16px;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">',
    '<div style="max-width:640px;margin:0 auto">',
    `<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px;padding-bottom:8px;border-bottom:4px solid ${PARTY_COLOUR}">${escapeHtml(heading)}</h1>`,
    ...body,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
}

function paragraphs(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
