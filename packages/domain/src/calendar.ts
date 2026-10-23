import type { ElectionRecord } from './elections.js';

/**
 * An election's voting window as an iCalendar event (RFC 5545, design §6.1 and §12), for "Add to calendar":
 * `GET /v1/public/elections/{id}/calendar.ics`. It holds only what the public record shows (title, description,
 * window, state), so the same file serves everyone and says nothing about who is on the roll.
 *
 * The window is frozen when the election is scheduled, and drafts are never published, so the event's times never
 * change: SEQUENCE is 0, and 1 once the election is cancelled (STATUS:CANCELLED), so that a copy fetched again replaces
 * the one a calendar already holds.
 */

export type CalendarElection = Pick<ElectionRecord, 'electionId' | 'title' | 'description' | 'state' | 'opensAt' | 'closesAt'>;

export const CALENDAR_PRODID = '-//US Transhumanist Party//USTPVote2//EN';

/** CRLF line ends, lines folded at 75 octets, UTF-8 (no byte-order mark). */
export function votingCalendar(input: {
  readonly election: CalendarElection;
  /** Where the web app is served, e.g. `https://vote.example.org`; the event links to the ballot page there. */
  readonly origin: string;
  /** When the file is made (DTSTAMP), ISO 8601. */
  readonly now: string;
}): string {
  const { election, origin, now } = input;
  if (election.state === 'draft') throw new Error('a draft has no published voting window');
  const cancelled = election.state === 'cancelled';
  const ballotUrl = `${origin}/ballot/${encodeURIComponent(election.electionId)}`;
  const description = [
    cancelled ? 'This election was cancelled. There is no vote.' : '',
    election.description.trim(),
    `Ballot: ${ballotUrl}`,
  ].filter(Boolean);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${CALENDAR_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // The election ID is a UUIDv7, the form RFC 7986 recommends for UID: stable, and globally unique on its own.
    `UID:${icsText(election.electionId)}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(election.opensAt)}`,
    `DTEND:${icsUtc(election.closesAt)}`,
    `SEQUENCE:${cancelled ? 1 : 0}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${icsText(`${cancelled ? 'Cancelled: ' : ''}USTP vote: ${election.title}`)}`,
    `DESCRIPTION:${icsText(description.join('\n\n'))}`,
    `URL:${ballotUrl}`,
    // A window of days: shown on the calendar, but not as busy time.
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map((line) => `${foldLine(line)}\r\n`).join('');
}

/**
 * A TEXT value (RFC 5545 §3.3.11): backslash, semicolon and comma escaped, every line break as `\n`, and control
 * characters other than tab dropped, since TEXT may not contain them.
 */
export function icsText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/[\\;,]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n');
}

/** A DATE-TIME in UTC (RFC 5545 §3.3.5 form 2), e.g. `20261101T170000Z`; fractions of a second are dropped. */
export function icsUtc(iso: string): string {
  // Without an offset, Date reads a date-time as local time, which would make the event depend on the machine.
  const ms = /(?:Z|[+-]\d\d:\d\d)$/i.test(iso) ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) throw new Error(`not an ISO 8601 date-time with an offset: ${iso}`);
  return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

/**
 * Folds a content line (RFC 5545 §3.1): no line longer than 75 octets of UTF-8, each continuation starting with one
 * space. It breaks only between code points, so every line is valid UTF-8 on its own.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0)!);
    if (octets + size > 75) {
      out.push(current);
      current = ' ';
      octets = 1;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join('\r\n');
}

function utf8Length(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}
