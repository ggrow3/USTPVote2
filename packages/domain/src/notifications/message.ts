import type { ElectionRecord } from '../elections.js';

/**
 * The voting-open email (design §6.7), as plain text and simple HTML with the same content: real text, no images, and
 * links named for what they open. Built from the election as frozen at scheduling, the web app's address and the
 * member's name; nothing else about the member goes in. Pure, so the worker sends exactly what the tests check.
 */

export type NoticeElection = Pick<ElectionRecord, 'electionId' | 'title' | 'description' | 'opensAt' | 'closesAt'>;

export interface NoticeMessage {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
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

/** The party's colour (transhumanist-party.org), 4.9:1 on white: links and the heading rule. */
const PARTY_COLOUR = '#bd4e00';

const SUBJECT_TITLE_MAX = 150;

export function votingOpenMessage(input: {
  readonly election: NoticeElection;
  /** Where the web app is served, e.g. `https://vote.example.org`, without a trailing slash. */
  readonly origin: string;
  /** The member's preferred (or legal) name; null to greet them without one. */
  readonly name: string | null;
}): NoticeMessage {
  const { election, origin } = input;
  const title = oneLine(election.title);
  const name = input.name ? oneLine(input.name) : '';
  const id = encodeURIComponent(election.electionId);
  const links = {
    ballot: `${origin}/ballot/${id}`,
    calendar: `${origin}/v1/public/elections/${id}/calendar.ics`,
    verify: `${origin}/verify`,
    site: `${origin}/`,
  };
  const window = votingWindow(election.opensAt, election.closesAt);
  const deadline = `${window[0]!.closes} (${window[0]!.name})`;
  const description = paragraphs(election.description);

  const subject = `Voting is open: ${title.length > SUBJECT_TITLE_MAX ? `${title.slice(0, SUBJECT_TITLE_MAX - 1)}…` : title}`;

  const text = [
    name ? `Hello ${name},` : 'Hello,',
    `Voting is open in “${title}”, an election of the US Transhumanist Party, and you are on its voter roll.`,
    `Vote by ${deadline}.`,
    `Open your ballot (you will be asked to sign in): ${links.ballot}`,
    [
      'When you can vote',
      ...window.map((w) => `- ${w.name}: ${w.opens} to ${w.closes}`),
    ].join('\n'),
    `Add the voting window to your calendar (an .ics file): ${links.calendar}`,
    ...(description.length ? [['About this election', ...description].join('\n\n')] : []),
    [
      'Checking your vote afterwards',
      'When you vote, the ballot page gives you a receipt. Download it and keep it to yourself: it shows how you voted.',
      `Once voting has closed, open the Verify page, ${links.verify}, and load the receipt. Your browser checks that ` +
        'your ballot is in the published, signed record. The receipt never leaves your browser.',
    ].join('\n'),
    'You are getting this email because you are on the voter roll of this election. It is an official election ' +
      'notice, sent once for each election, so it comes whatever your newsletter and announcement choices.',
    'We never ask for your password or a sign-in code by email. If you are unsure about this message, go to ' +
      `${links.site} yourself instead of following its links.`,
    '-- \nUS Transhumanist Party',
  ].join('\n\n');

  const a = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:${PARTY_COLOUR}">${label}</a>`;
  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(subject)}</title>`,
    '</head>',
    '<body style="margin:0;padding:16px;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">',
    '<div style="max-width:640px;margin:0 auto">',
    `<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px;padding-bottom:8px;border-bottom:4px solid ${PARTY_COLOUR}">Voting is open: ${escapeHtml(title)}</h1>`,
    `<p>${name ? `Hello ${escapeHtml(name)},` : 'Hello,'}</p>`,
    `<p>Voting is open in “${escapeHtml(title)}”, an election of the US Transhumanist Party, and you are on its voter roll.</p>`,
    `<p><strong>Vote by ${escapeHtml(deadline)}.</strong></p>`,
    `<p style="font-size:18px">${a(links.ballot, `Open your ballot for “${escapeHtml(title)}”`)}</p>`,
    '<p>You will be asked to sign in.</p>',
    '<h2 style="font-size:18px;margin:24px 0 8px">When you can vote</h2>',
    '<table style="border-collapse:collapse;font-size:15px">',
    '<thead><tr>',
    ...['Time zone', 'Voting opens', 'Voting closes'].map(
      (h) => `<th scope="col" style="text-align:left;padding:4px 12px 4px 0;border-bottom:1px solid #757575">${h}</th>`,
    ),
    '</tr></thead>',
    '<tbody>',
    ...window.map(
      (w) =>
        `<tr><th scope="row" style="text-align:left;padding:4px 12px 4px 0;font-weight:normal">${escapeHtml(w.name)}</th>` +
        `<td style="padding:4px 12px 4px 0">${escapeHtml(w.opens)}</td><td style="padding:4px 0">${escapeHtml(w.closes)}</td></tr>`,
    ),
    '</tbody>',
    '</table>',
    `<p>${a(links.calendar, 'Add the voting window to your calendar')} (an .ics file).</p>`,
    ...(description.length
      ? ['<h2 style="font-size:18px;margin:24px 0 8px">About this election</h2>', ...description.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)]
      : []),
    '<h2 style="font-size:18px;margin:24px 0 8px">Checking your vote afterwards</h2>',
    '<p>When you vote, the ballot page gives you a receipt. Download it and keep it to yourself: it shows how you voted.</p>',
    `<p>Once voting has closed, ${a(links.verify, 'open the Verify page')} and load the receipt. Your browser checks that ` +
      'your ballot is in the published, signed record. The receipt never leaves your browser.</p>',
    '<hr style="border:0;border-top:1px solid #757575;margin:24px 0">',
    '<p style="font-size:14px">You are getting this email because you are on the voter roll of this election. It is an ' +
      'official election notice, sent once for each election, so it comes whatever your newsletter and announcement choices.</p>',
    '<p style="font-size:14px">We never ask for your password or a sign-in code by email. If you are unsure about this ' +
      `message, go to ${escapeHtml(links.site)} yourself instead of following its links.</p>`,
    '<p style="font-size:14px">US Transhumanist Party</p>',
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');

  return { subject, text, html };
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

/** Text for one line (a subject, a name): control characters and line breaks become spaces, runs of space one. */
export function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function paragraphs(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
