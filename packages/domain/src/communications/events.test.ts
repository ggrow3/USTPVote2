import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../ids.js';
import { isPublicLedgerEvent } from '../ledger.js';
import {
  calendarEvents,
  cancelEvent,
  checkDeleteEvent,
  createEvent,
  createEventSchema,
  eventPhase,
  eventsCalendar,
  eventsPage,
  eventWhen,
  eventWhere,
  googleCalendarUrl,
  outlookCalendarUrl,
  partnersPage,
  publicEvent,
  publishEvent,
  updateEvent,
  updateEventSchema,
  zonedInstant,
  zonedLocalTime,
  type CreateEventInput,
  type EventRecord,
} from './events.js';
import {
  addPartner,
  createPartnerSchema,
  listedPartners,
  partnerConsentSchema,
  publicPartners,
  recordPartnerConsent,
  removePartner,
  updatePartner,
  withdrawPartnerConsent,
  type PartnerRecord,
} from './partners.js';
import { eventItem, parseShareItem } from './share-counts.js';

const AT = '2026-11-12T12:00:00.000Z';
const LATER = '2026-11-13T12:00:00.000Z';

const INPUT = {
  kind: 'candidate_qa',
  title: 'Q&A with our House candidates',
  slug: 'house-candidates-qa',
  summary: 'Ask the party’s 2026 House candidates anything.',
  body: 'Bring your questions.',
  startsAt: '2026-12-03T20:00:00-05:00',
  endsAt: '2026-12-03T21:30:00-05:00',
  timeZone: 'America/New_York',
  attendance: 'online',
  joinUrl: 'https://www.youtube.com/live/abc',
  joinLabel: 'YouTube Live',
  speakers: ['Jo Smith, candidate for CA-12'],
};

const parsed = (input: Record<string, unknown> = {}): CreateEventInput => createEventSchema.parse({ ...INPUT, ...input });

function draft(input: Record<string, unknown> = {}, eventId = uuidv7()): EventRecord {
  const made = createEvent(parsed(input), eventId, false, 'comms', AT);
  if (!made.ok) throw new Error(made.reason);
  return made.value;
}

function published(input: Record<string, unknown> = {}): EventRecord {
  const done = publishEvent(draft(input), 1, 'comms', AT);
  if (!done.ok) throw new Error(done.reason);
  return done.value.event;
}

function partner(name: string, consent: boolean): PartnerRecord {
  const { partner: added } = addPartner(createPartnerSchema.parse({ name, description: `${name} does things.`, website: 'https://example.org' }), uuidv7(), 'comms', AT);
  if (!consent) return added;
  const done = recordPartnerConsent(added, { from: 'Jo, chair', note: 'by email' }, 1, 'comms', AT);
  if (!done.ok) throw new Error(done.reason);
  return done.value.partner;
}

describe('an event as written', () => {
  it('is kept in UTC, with its own zone', () => {
    const input = parsed();
    expect(input).toMatchObject({ startsAt: '2026-12-04T01:00:00.000Z', endsAt: '2026-12-04T02:30:00.000Z', timeZone: 'America/New_York' });
    expect(parsed({ timeZone: undefined }).timeZone).toBe('America/New_York');
    expect(createEventSchema.safeParse({ ...INPUT, timeZone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('ends after it starts, and runs at most two weeks', () => {
    const bad = (input: Record<string, unknown>) => createEventSchema.safeParse({ ...INPUT, ...input }).error?.issues.map((i) => [i.path.join('.'), i.message]);
    expect(bad({ endsAt: INPUT.startsAt })).toEqual([['endsAt', 'it must end after it starts']]);
    expect(bad({ endsAt: '2026-12-20T20:00:00-05:00' })).toEqual([['endsAt', 'an event can run at most 14 days']]);
    expect(bad({ startsAt: 'next Tuesday' })?.[0]?.[0]).toBe('startsAt');
  });

  it('is attended at a link, at a place, or in the members’ room', () => {
    const problems = (input: Record<string, unknown>) =>
      createEventSchema.safeParse({ ...INPUT, ...input }).error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(problems({ joinUrl: '' })).toEqual(['joinUrl']);
    expect(problems({ joinUrl: 'http://example.org' })).toEqual(['joinUrl']);
    expect(problems({ place: 'The Hall' })).toEqual(['place']);
    expect(problems({ attendance: 'in_person', joinUrl: '' })).toEqual(['place']);
    expect(problems({ attendance: 'in_person', place: 'The Hall', address: '1 Main St' })).toEqual([]);
    expect(problems({ attendance: 'members_room' })).toEqual(['joinUrl']);
    expect(problems({ attendance: 'members_room', joinUrl: '' })).toEqual([]);
  });

  it('names at most five co-hosts, once each, and eight speakers', () => {
    const id = uuidv7();
    expect(parsed({ partnerIds: [id, id] }).partnerIds).toEqual([id]);
    expect(createEventSchema.safeParse({ ...INPUT, partnerIds: ['nope'] }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...INPUT, partnerIds: Array.from({ length: 6 }, () => uuidv7()) }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...INPUT, speakers: Array.from({ length: 9 }, (_, i) => `Speaker ${i}`) }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...INPUT, speakers: ['  '] }).success).toBe(false);
  });
});

describe('publishing, changing and cancelling an event', () => {
  it('a draft is refused at an address already used, and private until published', () => {
    expect(createEvent(parsed(), uuidv7(), true, 'comms', AT)).toMatchObject({ ok: false, refusal: 'conflict' });
    const event = draft();
    expect(event).toMatchObject({ status: 'draft', version: 1, publishedAt: null });
    expect(publicEvent(event, new Map(), AT)).toBeNull();
    expect(eventsPage([event], new Map(), AT)).toEqual({ upcoming: [], past: [] });
  });

  it('publishing needs a summary and is ledgered', () => {
    expect(publishEvent(draft({ summary: '' }), 1, 'comms', AT)).toMatchObject({ ok: false });
    const done = publishEvent(draft(), 1, 'comms', AT);
    expect(done).toMatchObject({ ok: true, value: { event: { status: 'published', version: 2, publishedAt: AT }, ledger: { type: 'event.published', actor: 'comms' } } });
    expect(publishEvent(draft(), 2, 'comms', AT)).toMatchObject({ ok: false, refusal: 'conflict' });
  });

  it('a draft’s changes are not ledgered; a published event’s are, with its fields, and its address stays', () => {
    const event = draft();
    const edit = updateEvent(event, { ...parsed({ title: 'New title' }) }, 1, false, 'comms', AT);
    expect(edit).toMatchObject({ ok: true, value: { event: { title: 'New title', version: 2 }, ledger: null } });
    const shown = published();
    const moved = updateEvent(shown, parsed({ startsAt: '2026-12-03T19:00:00-05:00' }), shown.version, false, 'comms', LATER);
    expect(moved).toMatchObject({ ok: true, value: { event: { editedAt: LATER, version: 3 }, ledger: { type: 'event.changed', payload: { fields: ['startsAt'] } } } });
    expect(updateEvent(shown, parsed({ slug: 'elsewhere' }), shown.version, false, 'comms', AT)).toMatchObject({ ok: false });
    expect(updateEvent(shown, parsed({ summary: '' }), shown.version, false, 'comms', AT)).toMatchObject({ ok: false });
    expect(updateEvent(shown, parsed(), shown.version, false, 'comms', AT)).toMatchObject({ ok: true, value: { event: shown, ledger: null } });
    expect(updateEvent(shown, parsed({ title: 'x' }), 1, false, 'comms', AT)).toMatchObject({ ok: false, refusal: 'conflict' });
  });

  it('is cancelled only while it has not ended, and can be published again', () => {
    const shown = published();
    const cancelled = cancelEvent(shown, shown.version, 'comms', AT);
    expect(cancelled).toMatchObject({ ok: true, value: { event: { status: 'cancelled', cancelledAt: AT }, ledger: { type: 'event.cancelled' } } });
    expect(cancelEvent(shown, shown.version, 'comms', '2026-12-04T03:00:00.000Z')).toMatchObject({ ok: false });
    expect(cancelEvent(draft(), 1, 'comms', AT)).toMatchObject({ ok: false });
    if (!cancelled.ok) throw new Error();
    const again = publishEvent(cancelled.value.event, cancelled.value.event.version, 'comms', LATER);
    expect(again).toMatchObject({ ok: true, value: { event: { status: 'published', cancelledAt: null, publishedAt: AT } } });
  });

  it('only a draft never published is deleted', () => {
    expect(checkDeleteEvent(draft())).toMatchObject({ ok: true });
    expect(checkDeleteEvent(published())).toMatchObject({ ok: false });
    expect(checkDeleteEvent(null)).toMatchObject({ ok: false, refusal: 'not_found' });
  });

  it('makes ledger entries Auditors read, none of them public', () => {
    for (const type of ['event.published', 'event.changed', 'event.cancelled', 'partner.changed'] as const) expect(isPublicLedgerEvent(type)).toBe(false);
  });
});

describe('what the public sees of events', () => {
  it('upcoming soonest first, then what took place, newest first; cancelled ones until their time passes', () => {
    const soon = published({ slug: 'soon', startsAt: '2026-11-20T18:00:00Z', endsAt: '2026-11-20T19:00:00Z' });
    const later = published({ slug: 'later', startsAt: '2026-12-20T18:00:00Z', endsAt: '2026-12-20T19:00:00Z' });
    const live = published({ slug: 'live', startsAt: '2026-11-12T11:00:00Z', endsAt: '2026-11-12T13:00:00Z' });
    const old = published({ slug: 'old', startsAt: '2026-10-01T18:00:00Z', endsAt: '2026-10-01T19:00:00Z' });
    const older = published({ slug: 'older', startsAt: '2026-09-01T18:00:00Z', endsAt: '2026-09-01T19:00:00Z' });
    const cancelled = { ...published({ slug: 'off', startsAt: '2026-11-25T18:00:00Z', endsAt: '2026-11-25T19:00:00Z' }), status: 'cancelled' as const };
    const page = eventsPage([older, later, cancelled, old, soon, live], new Map(), AT);
    expect(page.upcoming.map((e) => [e.slug, e.status])).toEqual([
      ['live', 'published'],
      ['soon', 'published'],
      ['off', 'cancelled'],
      ['later', 'published'],
    ]);
    expect(page.past.map((e) => e.slug)).toEqual(['old', 'older']);
    expect(eventsPage([cancelled], new Map(), '2026-11-26T00:00:00Z')).toEqual({ upcoming: [], past: [] });
    expect([eventPhase(soon, AT), eventPhase(live, AT), eventPhase(old, AT)]).toEqual(['upcoming', 'live', 'past']);
  });

  it('gives the link to join only until the event is over or cancelled, and never who wrote it', () => {
    const shown = published({ recording: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', start: 0 } });
    const before = publicEvent(shown, new Map(), AT)!;
    expect(before).toMatchObject({ joinUrl: INPUT.joinUrl, joinLabel: 'YouTube Live', recorded: true, status: 'published' });
    expect(before).not.toHaveProperty('createdBy');
    expect(before).not.toHaveProperty('partnerIds');
    expect(publicEvent(shown, new Map(), '2026-12-05T00:00:00Z')).toMatchObject({ joinUrl: '', joinLabel: '' });
    expect(publicEvent({ ...shown, status: 'cancelled' }, new Map(), AT)).toMatchObject({ joinUrl: '', status: 'cancelled' });
  });

  it('names only the co-hosts listed with their consent', () => {
    const listed = partner('Longevity Club', true);
    const unlisted = partner('Quiet Group', false);
    const partners = new Map([listed, unlisted].map((p) => [p.partnerId, p]));
    const shown = published({ partnerIds: [unlisted.partnerId, listed.partnerId, uuidv7()] });
    expect(publicEvent(shown, partners, AT)?.partners).toEqual([{ partnerId: listed.partnerId, name: 'Longevity Club', website: 'https://example.org' }]);
    const page = partnersPage([unlisted, listed], [shown, draft({ slug: 'private', partnerIds: [listed.partnerId] })], AT);
    expect(page.partners.map((p) => [p.name, p.upcoming.map((e) => e.slug), p.past.length])).toEqual([['Longevity Club', ['house-candidates-qa'], 0]]);
  });

  it('says when and where in a few words', () => {
    const event = parsed();
    expect(eventWhen(event)).toMatch(/^Thursday, December 3, 2026, 8:00 – 9:30 PM EST$/);
    expect(eventWhen({ ...event, endsAt: '2026-12-04T06:00:00Z' })).toMatch(/December 3, 2026.*8:00 PM.*–.*December 4, 2026.*1:00 AM EST/);
    expect(eventWhere(event)).toBe('Online · YouTube Live');
    expect(eventWhere({ ...event, joinLabel: '' })).toBe('Online · youtube.com');
    expect(eventWhere({ ...event, joinLabel: '', joinUrl: '' })).toBe('Online');
    expect(eventWhere({ ...event, attendance: 'in_person', place: 'The Hall' })).toBe('The Hall · also online');
    expect(eventWhere({ ...event, attendance: 'members_room', joinUrl: '' })).toBe('Members’ room, for Active members');
  });
});

describe('calendars', () => {
  it('writes one event as iCalendar, with its sequence, place and page', () => {
    const shown = published({ attendance: 'in_person', place: 'The Hall', address: '1 Main St, Austin, TX' });
    const ics = eventsCalendar({ events: [shown], origin: 'https://vote.example.org/', now: AT });
    expect(ics).toContain(`UID:${shown.eventId}\r\n`);
    expect(ics).toContain('DTSTART:20261204T010000Z\r\nDTEND:20261204T023000Z\r\nSEQUENCE:2\r\nSTATUS:CONFIRMED\r\n');
    expect(ics).toContain('LOCATION:The Hall\\, 1 Main St\\, Austin\\, TX\r\n');
    expect(ics).toContain('URL:https://vote.example.org/events/house-candidates-qa\r\n');
    expect(ics).not.toContain('X-WR-CALNAME');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it('marks a cancelled event, names a subscribed calendar, and leaves drafts out', () => {
    const cancelled = { ...published(), status: 'cancelled' as const, version: 3 };
    const ics = eventsCalendar({ events: [cancelled, draft({ slug: 'secret' })], origin: 'https://vote.example.org', now: AT, name: 'USTP events' });
    expect(ics).toContain('SEQUENCE:3\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled: Q&A with our House candidates\r\n');
    expect(ics).toContain('X-WR-CALNAME:USTP events\r\n');
    expect(ics).not.toContain('secret');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('a subscribed calendar holds what is coming and the last 90 days', () => {
    const recent = published({ slug: 'recent', startsAt: '2026-10-01T18:00:00Z', endsAt: '2026-10-01T19:00:00Z' });
    const old = published({ slug: 'old', startsAt: '2026-06-01T18:00:00Z', endsAt: '2026-06-01T19:00:00Z' });
    const coming = published();
    expect(calendarEvents([coming, old, recent, draft({ slug: 'dd' })], AT).map((e) => e.slug)).toEqual(['recent', 'house-candidates-qa']);
  });

  it('fills in Google’s and Outlook’s own forms', () => {
    const shown = published();
    const google = new URL(googleCalendarUrl(shown, 'https://vote.example.org'));
    expect(google.host).toBe('calendar.google.com');
    expect(Object.fromEntries(google.searchParams)).toMatchObject({
      action: 'TEMPLATE',
      text: INPUT.title,
      dates: '20261204T010000Z/20261204T023000Z',
      location: INPUT.joinUrl,
      ctz: 'America/New_York',
    });
    expect(google.searchParams.get('details')).toContain('https://vote.example.org/events/house-candidates-qa');
    const outlook = new URL(outlookCalendarUrl(shown, 'https://vote.example.org'));
    expect(outlook.searchParams.get('startdt')).toBe('2026-12-04T01:00:00.000Z');
  });
});

describe('share buttons on events', () => {
  it('are counted against the event’s address', () => {
    expect(parseShareItem(eventItem('house-candidates-qa'))).toEqual({ kind: 'event', slug: 'house-candidates-qa' });
    expect(parseShareItem('event-Not A Slug')).toBeNull();
  });
});

describe('partners', () => {
  it('are listed only once their consent is recorded, and leave the list when it is withdrawn', () => {
    const added = partner('Longevity Club', false);
    expect(publicPartners([added])).toEqual([]);
    const consented = recordPartnerConsent(added, { from: 'Jo Smith, chair', note: 'email of 10 November' }, 1, 'comms', LATER);
    expect(consented).toMatchObject({
      ok: true,
      value: { partner: { consent: { from: 'Jo Smith, chair', recordedAt: LATER, recordedBy: 'comms' } }, event: { type: 'partner.changed', payload: { change: 'consent_recorded', listed: true } } },
    });
    if (!consented.ok) throw new Error();
    const listed = consented.value.partner;
    expect(publicPartners([listed])).toEqual([{ partnerId: listed.partnerId, name: 'Longevity Club', website: 'https://example.org', description: 'Longevity Club does things.', since: LATER }]);
    expect(publicPartners([listed])[0]).not.toHaveProperty('notes');
    expect(recordPartnerConsent(listed, { from: 'x', note: '' }, listed.version, 'comms', LATER)).toMatchObject({ ok: false });
    const withdrawn = withdrawPartnerConsent(listed, listed.version, 'comms', LATER);
    expect(withdrawn).toMatchObject({ ok: true, value: { partner: { consent: null }, event: { payload: { change: 'consent_withdrawn', listed: false } } } });
    expect(withdrawPartnerConsent(added, 1, 'comms', AT)).toMatchObject({ ok: false });
    expect(partnerConsentSchema.safeParse({ basedOn: 1, from: ' ', note: '' }).success).toBe(false);
  });

  it('ledger their changes, but not the team’s notes alone', () => {
    const added = partner('Longevity Club', false);
    const content = { name: added.name, description: added.description, website: added.website, notes: added.notes };
    expect(updatePartner(added, { ...content, notes: 'Call Jo in December' }, 1, 'comms', AT)).toMatchObject({ ok: true, value: { partner: { version: 2 }, event: null } });
    expect(updatePartner(added, { ...content, name: 'Longevity Society' }, 1, 'comms', AT)).toMatchObject({
      ok: true,
      value: { event: { payload: { change: 'updated', fields: ['name'] } } },
    });
    expect(updatePartner(added, content, 1, 'comms', AT)).toMatchObject({ ok: true, value: { partner: added, event: null } });
    expect(updatePartner(added, content, 2, 'comms', AT)).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(removePartner(added, 'comms')).toMatchObject({ ok: true, value: { payload: { change: 'removed', listed: false } } });
    expect(createPartnerSchema.safeParse({ name: 'x', website: 'http://insecure.example' }).success).toBe(false);
  });

  it('as co-hosts, in the event’s order, listed ones only', () => {
    const a = partner('A', true);
    const b = partner('B', false);
    const c = partner('C', true);
    const map = new Map([a, b, c].map((p) => [p.partnerId, p]));
    expect(listedPartners([c.partnerId, b.partnerId, a.partnerId], map).map((p) => p.name)).toEqual(['C', 'A']);
  });
});

describe('update schema', () => {
  it('takes the version edited', () => {
    expect(updateEventSchema.safeParse({ ...INPUT }).success).toBe(false);
    expect(updateEventSchema.safeParse({ ...INPUT, basedOn: 2 }).success).toBe(true);
  });
});

describe('times in the event’s own zone', () => {
  it('turn a wall-clock time there into an instant and back', () => {
    expect(zonedInstant('2026-12-03T20:00', 'America/New_York')).toBe('2026-12-04T01:00:00.000Z');
    expect(zonedInstant('2026-07-03T20:00', 'America/New_York')).toBe('2026-07-04T00:00:00.000Z');
    expect(zonedInstant('2026-12-03T20:00', 'UTC')).toBe('2026-12-03T20:00:00.000Z');
    expect(zonedInstant('2026-12-03T20:00', 'Pacific/Honolulu')).toBe('2026-12-04T06:00:00.000Z');
    expect(zonedLocalTime('2026-12-04T01:00:00.000Z', 'America/New_York')).toBe('2026-12-03T20:00');
    expect(zonedLocalTime('2026-12-04T01:00:00.000Z', 'Europe/Berlin')).toBe('2026-12-04T02:00');
    expect(zonedInstant('not a time', 'UTC')).toBe('');
  });

  it('read a time the clocks skip as the hour after, and one they repeat as the first', () => {
    // 2027-03-14 02:30 does not happen in New York; 2026-11-01 01:30 happens twice.
    expect(zonedInstant('2027-03-14T02:30', 'America/New_York')).toBe('2027-03-14T07:30:00.000Z');
    expect(zonedLocalTime(zonedInstant('2027-03-14T02:30', 'America/New_York'), 'America/New_York')).toBe('2027-03-14T03:30');
    expect(zonedInstant('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    for (const local of ['2026-03-01T09:15', '2026-06-30T23:59', '2026-10-31T12:00']) {
      expect(zonedLocalTime(zonedInstant(local, 'America/Los_Angeles'), 'America/Los_Angeles')).toBe(local);
    }
  });
});
