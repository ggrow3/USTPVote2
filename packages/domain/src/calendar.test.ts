import { describe, expect, it } from 'vitest';
import { CALENDAR_PRODID, foldLine, icsText, icsUtc, votingCalendar, type CalendarElection } from './calendar.js';

const ORIGIN = 'https://vote.example.org';
const NOW = '2026-10-23T09:30:15.250Z';
const ID = '019a1b2c-3d4e-7f00-8a00-123456789abc';

const election = (over: Partial<CalendarElection> = {}): CalendarElection => ({
  electionId: ID,
  title: '2026 Officer Election',
  description: '',
  state: 'scheduled',
  opensAt: '2026-11-01T12:00:00.000Z',
  closesAt: '2026-11-08T12:00:00.000Z',
  ...over,
});

const octets = (s: string) => new TextEncoder().encode(s).length;
/** RFC 5545 §3.1: a line break followed by one space or tab is removed. */
const unfold = (text: string) => text.replace(/\r\n[ \t]/g, '');
const property = (text: string, name: string) =>
  unfold(text)
    .split('\r\n')
    .find((line) => line.startsWith(`${name}:`))
    ?.slice(name.length + 1);

describe('votingCalendar', () => {
  it('is one event for the voting window, in UTC, with CRLF line ends', () => {
    expect(votingCalendar({ election: election(), origin: ORIGIN, now: NOW })).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:${CALENDAR_PRODID}`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${ID}`,
        'DTSTAMP:20261023T093015Z',
        'DTSTART:20261101T120000Z',
        'DTEND:20261108T120000Z',
        'SEQUENCE:0',
        'STATUS:CONFIRMED',
        'SUMMARY:USTP vote: 2026 Officer Election',
        // 87 octets, so folded after the 75th.
        `DESCRIPTION:Ballot: ${ORIGIN}/ballot/019a1b2c-3d4e-7f00-8a00`,
        ' -123456789abc',
        `URL:${ORIGIN}/ballot/${ID}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('keeps the same UID and times whenever it is made, and whatever state the election is in after scheduling', () => {
    const at = (now: string, state: CalendarElection['state']) => votingCalendar({ election: election({ state }), origin: ORIGIN, now });
    const first = at(NOW, 'scheduled');
    for (const later of [at('2026-11-02T00:00:00Z', 'open'), at('2026-11-09T00:00:00Z', 'certified')]) {
      for (const name of ['UID', 'DTSTART', 'DTEND', 'SEQUENCE', 'SUMMARY']) expect(property(later, name)).toBe(property(first, name));
      expect(property(later, 'DTSTAMP')).not.toBe(property(first, 'DTSTAMP'));
    }
  });

  it('marks a cancelled election cancelled, with a higher SEQUENCE so it replaces a copy already imported', () => {
    const text = votingCalendar({ election: election({ state: 'cancelled' }), origin: ORIGIN, now: NOW });
    expect(property(text, 'STATUS')).toBe('CANCELLED');
    expect(property(text, 'SEQUENCE')).toBe('1');
    expect(property(text, 'SUMMARY')).toBe('Cancelled: USTP vote: 2026 Officer Election');
    expect(property(text, 'DESCRIPTION')).toMatch(/^This election was cancelled\. There is no vote\.\\n\\nBallot: /);
  });

  it('refuses a draft, whose window can still change', () => {
    expect(() => votingCalendar({ election: election({ state: 'draft' }), origin: ORIGIN, now: NOW })).toThrow(/draft/);
  });

  it('escapes the title and description, and puts the election description before the ballot link', () => {
    const text = votingCalendar({
      election: election({ title: 'Plank 12; bylaws, "art. 3" \\ more', description: 'Line one\r\nLine two\rLine three\n' }),
      origin: ORIGIN,
      now: NOW,
    });
    expect(property(text, 'SUMMARY')).toBe('USTP vote: Plank 12\\; bylaws\\, "art. 3" \\\\ more');
    expect(property(text, 'DESCRIPTION')).toBe(`Line one\\nLine two\\nLine three\\n\\nBallot: ${ORIGIN}/ballot/${ID}`);
  });

  it('percent-encodes the election ID in the ballot URL', () => {
    const text = votingCalendar({ election: election({ electionId: 'a b/c' }), origin: ORIGIN, now: NOW });
    expect(property(text, 'URL')).toBe(`${ORIGIN}/ballot/a%20b%2Fc`);
    expect(property(text, 'UID')).toBe('a b/c');
  });

  it('folds long lines at 75 octets without splitting a character, and unfolds to the original', () => {
    const title = `Élection des délégués 2026 — 選挙 🗳️ ${'x'.repeat(40)} ${'ü'.repeat(60)}`;
    const text = votingCalendar({ election: election({ title, description: 'é'.repeat(200) }), origin: ORIGIN, now: NOW });
    const physical = text.split('\r\n');
    expect(physical.at(-1)).toBe('');
    for (const line of physical) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(physical.filter((l) => l.startsWith(' ')).length).toBeGreaterThan(3);
    // Each physical line is valid UTF-8 by itself: no lone surrogate from a split astral character.
    for (const line of physical) expect(line).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect(property(text, 'SUMMARY')).toBe(`USTP vote: ${title}`);
    expect(property(text, 'DESCRIPTION')).toBe(`${'é'.repeat(200)}\\n\\nBallot: ${ORIGIN}/ballot/${ID}`);
  });
});

describe('icsText', () => {
  it('escapes backslash, semicolon and comma, and writes every line break as \\n', () => {
    expect(icsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(icsText('one\r\ntwo\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour');
    expect(icsText('colon: and "quotes" stay')).toBe('colon: and "quotes" stay');
  });

  it('drops control characters other than tab', () => {
    expect(icsText('a\u0000b\u0007c\u001bd\u007fe\tf')).toBe('abcde\tf');
  });
});

describe('icsUtc', () => {
  it('writes UTC in basic form, converting offsets and dropping fractions of a second', () => {
    expect(icsUtc('2026-11-01T12:00:00.000Z')).toBe('20261101T120000Z');
    expect(icsUtc('2026-11-01T12:00:00.999Z')).toBe('20261101T120000Z');
    expect(icsUtc('2026-11-01T19:30:00-05:00')).toBe('20261102T003000Z');
    expect(icsUtc('2026-11-01T01:15:00+02:00')).toBe('20261031T231500Z');
  });

  it('refuses a date-time without an offset, or no date at all', () => {
    expect(() => icsUtc('2026-11-01T12:00:00')).toThrow(/offset/);
    expect(() => icsUtc('soon')).toThrow(/offset/);
    expect(() => icsUtc('2026-13-45T99:00:00Z')).toThrow(/offset/);
  });
});

describe('foldLine', () => {
  it('leaves a line of 75 octets alone and folds the 76th onto a line starting with a space', () => {
    expect(foldLine('a'.repeat(75))).toBe('a'.repeat(75));
    expect(foldLine('a'.repeat(76))).toBe(`${'a'.repeat(75)}\r\n a`);
    // Continuation lines count their leading space: 74 octets of content each.
    expect(foldLine('a'.repeat(75 + 74 + 1))).toBe(`${'a'.repeat(75)}\r\n ${'a'.repeat(74)}\r\n a`);
  });

  it('counts octets, not characters, and moves a character that does not fit to the next line', () => {
    // 74 ASCII + a 2-octet é = 76 octets: the é goes whole to the next line.
    expect(foldLine(`${'a'.repeat(74)}é`)).toBe(`${'a'.repeat(74)}\r\n é`);
    // A 4-octet emoji after 72 octets fits only on the next line (72 + 4 = 76).
    expect(foldLine(`${'a'.repeat(72)}😀`)).toBe(`${'a'.repeat(72)}\r\n 😀`);
    expect(foldLine(`${'a'.repeat(71)}😀`)).toBe(`${'a'.repeat(71)}😀`);
  });
});
