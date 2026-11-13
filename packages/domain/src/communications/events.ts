import { z } from 'zod';
import { CALENDAR_PRODID, foldLine, icsText, icsUtc } from '../calendar.js';
import { refuse, type Outcome } from '../check.js';
import { isUuidV7 } from '../ids.js';
import { isTimeZone } from '../notifications/mail-days.js';
import type { LedgerEvent } from '../ledger-events.js';
import { videoSchema, type Video } from '../video.js';
import { addressSchema, basedOnSchema, changedFields, communicationsEvent, hashtagsSchema, oneLine, slugSchema, stale, text } from './common.js';
import { listedPartners, publicPartners, type PartnerRecord, type PublicPartner, type PublicPartnerRef } from './partners.js';

/**
 * The party's public events (design §10.17): candidate Q&As, debate nights, talks and meetups, some co-hosted with
 * partner groups (`partners.ts`). A Communications Admin drafts, publishes, changes and cancels them alone, as with news;
 * each publication, change of a published event and cancellation is in the audit ledger, drafts are not. The site
 * carries no one's audience: an event is attended at an outside link (a stream or a meeting), at a place, or, for
 * Active members only, in the members' room's call (§5.10). Once it is over its page shows its recording, a YouTube
 * video or an upload (§10.10).
 */

export const EVENT_KINDS = ['candidate_qa', 'debate', 'talk', 'meetup', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_NAMES: Readonly<Record<EventKind, string>> = {
  candidate_qa: 'Candidate Q&A',
  debate: 'Debate night',
  talk: 'Talk',
  meetup: 'Meetup',
  other: 'Event',
};

/** How people attend: an outside link, a place (perhaps streamed too), or the members' room's call. */
export const EVENT_ATTENDANCE = ['online', 'in_person', 'members_room'] as const;
export type EventAttendance = (typeof EVENT_ATTENDANCE)[number];

export const EVENT_ATTENDANCE_NAMES: Readonly<Record<EventAttendance, string>> = {
  online: 'Online',
  in_person: 'In person',
  members_room: 'Members’ room',
};

export const EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_LIMITS = {
  title: 140,
  summary: 300,
  body: 10_000,
  speakers: 8,
  speaker: 120,
  place: 120,
  address: 300,
  joinLabel: 60,
  partners: 5,
  /** The longest an event may run. */
  days: 14,
} as const;

/** The zones the editor offers; any IANA zone is taken. */
export const EVENT_TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
] as const;

/** The zone a new event is in, for the card and the calendars: the party's, Eastern. */
export const DEFAULT_EVENT_TIME_ZONE = 'America/New_York';

/** How long after an event a subscribed calendar still lists it. */
export const EVENTS_CALENDAR_PAST_DAYS = 90;

/** The most past events the Events page lists, newest first. */
export const PAST_EVENTS_SHOWN = 100;

/** A date and time with an offset, kept in UTC so that stored times sort as text. */
const isoDateTime = z.iso.datetime({ offset: true, message: 'a date and time' }).transform((v) => new Date(v).toISOString());

const contentShape = {
  kind: z.enum(EVENT_KINDS),
  title: oneLine(EVENT_LIMITS.title).pipe(z.string().min(1, 'enter a title')),
  /** One or two sentences: the Events list, the page's description, share buttons and calendars carry it. */
  summary: oneLine(EVENT_LIMITS.summary).default(''),
  /** Plain text, written as a news post is (`news-body.ts`). */
  body: text(EVENT_LIMITS.body),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  /** The zone the event is in: its card and calendars say its time there; pages show the viewer's own too. */
  timeZone: z.string().trim().max(64).default(DEFAULT_EVENT_TIME_ZONE).refine(isTimeZone, 'not a time zone the site knows'),
  attendance: z.enum(EVENT_ATTENDANCE),
  /** Where people watch or join: a stream or a meeting, an `https://` address; empty for none. */
  joinUrl: addressSchema(false),
  /** What that link is ("YouTube Live", "Zoom"); empty to show its site's name. */
  joinLabel: oneLine(EVENT_LIMITS.joinLabel).default(''),
  /** For an event in person: the venue's name, and its address. */
  place: oneLine(EVENT_LIMITS.place).default(''),
  address: oneLine(EVENT_LIMITS.address).default(''),
  /** Who speaks, debates or answers questions, one name (and what they are) a line. */
  speakers: z
    .array(oneLine(EVENT_LIMITS.speaker).pipe(z.string().min(1, 'enter a name, or remove the line')))
    .max(EVENT_LIMITS.speakers, `at most ${EVENT_LIMITS.speakers} speakers`)
    .default([]),
  /** The partner groups that co-host it (`partners/{partnerId}`); its page names only those listed in public. */
  partnerIds: z
    .array(z.string().refine(isUuidV7, 'not a partner'))
    .max(EVENT_LIMITS.partners, `at most ${EVENT_LIMITS.partners} co-hosts`)
    .default([])
    .transform((ids) => [...new Set(ids)]),
  hashtags: hashtagsSchema,
  /** The recording, shown once the event is over (design §10.10). */
  recording: videoSchema.nullable().default(null),
};

type ContentFields = z.output<z.ZodObject<typeof contentShape>>;

/** What every event must be, whatever else it is: over after it starts, not too long, and attended somewhere. */
function checkContent(v: ContentFields, ctx: z.RefinementCtx): void {
  const start = Date.parse(v.startsAt);
  const end = Date.parse(v.endsAt);
  if (end <= start) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'it must end after it starts' });
  else if (end - start > EVENT_LIMITS.days * 86_400_000) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: `an event can run at most ${EVENT_LIMITS.days} days` });
  }
  if (v.attendance === 'online') {
    if (!v.joinUrl) ctx.addIssue({ code: 'custom', path: ['joinUrl'], message: 'give the link people watch or join at' });
    if (v.place || v.address) ctx.addIssue({ code: 'custom', path: ['place'], message: 'an online event has no place; choose “In person” for one that has' });
  }
  if (v.attendance === 'in_person' && !v.place) ctx.addIssue({ code: 'custom', path: ['place'], message: 'give the place it is held' });
  if (v.attendance === 'members_room') {
    if (v.joinUrl) ctx.addIssue({ code: 'custom', path: ['joinUrl'], message: 'the members’ room has its own call; leave the link empty' });
    if (v.place || v.address) ctx.addIssue({ code: 'custom', path: ['place'], message: 'an event in the members’ room has no place' });
  }
}

export const eventContentSchema = z.strictObject(contentShape).superRefine(checkContent);
export type EventContent = Readonly<z.output<typeof eventContentSchema>>;

/** `POST /v1/admin/communications/events`: a new draft and its address. */
export const createEventSchema = z.strictObject({ ...contentShape, slug: slugSchema }).superRefine(checkContent);
export type CreateEventInput = z.infer<typeof createEventSchema>;

/** `PUT /v1/admin/communications/events/{eventId}`: the content (and, while never published, its address). */
export const updateEventSchema = z.strictObject({ ...contentShape, slug: slugSchema, basedOn: basedOnSchema }).superRefine(checkContent);
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** `POST …/events/{eventId}/publish` and `…/cancel`: the version it was looked at. */
export const eventVersionSchema = z.strictObject({ basedOn: basedOnSchema });
export type EventVersionInput = z.infer<typeof eventVersionSchema>;

/** `events/{eventId}` */
export interface EventRecord extends EventContent {
  readonly eventId: string;
  /** Its page is `/events/{slug}`; fixed once it is first published, so links and calendars keep working. */
  readonly slug: string;
  readonly status: EventStatus;
  /** Counts saves; also the calendars' SEQUENCE, so a calendar that holds the event takes each change. */
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  /** When a published event last changed. */
  readonly editedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledBy: string | null;
}

const CONTENT = Object.keys(contentShape) as (keyof EventContent)[];
type Field = keyof EventContent | 'slug';
const FIELDS: readonly Field[] = [...CONTENT, 'slug'];

/** `event.published`, `event.changed` and `event.cancelled`. */
export interface EventLedgerPayload {
  readonly eventId: string;
  readonly slug: string;
  readonly kind: EventKind;
  readonly title: string;
  readonly startsAt: string;
  readonly version: number;
  /** `event.changed`: the fields that changed. */
  readonly fields?: readonly Field[];
}

function eventEvent(type: 'event.published' | 'event.changed' | 'event.cancelled', actor: string, event: EventRecord, fields?: Field[]): LedgerEvent {
  const payload: EventLedgerPayload = {
    eventId: event.eventId,
    slug: event.slug,
    kind: event.kind,
    title: event.title,
    startsAt: event.startsAt,
    version: event.version,
    ...(fields && { fields }),
  };
  return communicationsEvent(type, actor, event.eventId, payload);
}

/** What an event needs before it is published, besides what every event needs: a summary. */
export function publishEventProblem(content: Pick<EventContent, 'summary'>): string | null {
  return content.summary ? null : 'add a summary before publishing: the Events list, share buttons and calendars carry it';
}

const taken = (slug: string) => refuse('conflict', `another event already uses the address /events/${slug}`);

/** A new draft; its address must not be another event's (checked by the caller). */
export function createEvent(input: CreateEventInput, eventId: string, slugTaken: boolean, actor: string, at: string): Outcome<EventRecord> {
  if (slugTaken) return taken(input.slug);
  const { slug, ...content } = input;
  return {
    ok: true,
    value: {
      eventId,
      slug,
      ...content,
      status: 'draft',
      version: 1,
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      updatedBy: actor,
      publishedAt: null,
      publishedBy: null,
      editedAt: null,
      cancelledAt: null,
      cancelledBy: null,
    },
  };
}

/**
 * The event with new content, from the version it was edited from. Its address changes only while it has never been
 * published. A change to an event the public can see (published or cancelled) is ledgered with the fields that changed.
 */
export function updateEvent(
  event: EventRecord | null,
  input: Omit<UpdateEventInput, 'basedOn'>,
  basedOn: number,
  slugTaken: boolean,
  actor: string,
  at: string,
): Outcome<{ event: EventRecord; ledger: LedgerEvent | null }> {
  if (!event) return refuse('not_found', 'no such event');
  if (basedOn !== event.version) return refuse('conflict', stale('event'));
  if (input.slug !== event.slug) {
    if (event.publishedAt) return refuse('conflict', 'an event keeps its address once it has been published, so links and calendars keep working');
    if (slugTaken) return taken(input.slug);
  }
  const next = { ...event, ...input };
  const fields = changedFields(FIELDS, event, next);
  if (!fields.length) return { ok: true, value: { event, ledger: null } };
  const shown = event.status !== 'draft';
  if (event.status === 'published') {
    const problem = publishEventProblem(next);
    if (problem) return refuse('conflict', problem);
  }
  const updated: EventRecord = { ...next, version: event.version + 1, updatedAt: at, updatedBy: actor, editedAt: shown ? at : event.editedAt };
  return { ok: true, value: { event: updated, ledger: shown ? eventEvent('event.changed', actor, updated, fields) : null } };
}

/** Publishes a draft, or a cancelled event again: it is public at once, and ledgered. */
export function publishEvent(event: EventRecord | null, basedOn: number, actor: string, at: string): Outcome<{ event: EventRecord; ledger: LedgerEvent }> {
  if (!event) return refuse('not_found', 'no such event');
  if (basedOn !== event.version) return refuse('conflict', stale('event'));
  if (event.status === 'published') return refuse('conflict', 'it is already published');
  const problem = publishEventProblem(event);
  if (problem) return refuse('conflict', problem);
  const published: EventRecord = {
    ...event,
    status: 'published',
    version: event.version + 1,
    updatedAt: at,
    updatedBy: actor,
    publishedAt: event.publishedAt ?? at,
    publishedBy: event.publishedBy ?? actor,
    cancelledAt: null,
    cancelledBy: null,
  };
  return { ok: true, value: { event: published, ledger: eventEvent('event.published', actor, published) } };
}

/**
 * Cancels a published event that has not ended: its page and the calendars that hold it say so. An event that took
 * place is not cancelled; it is changed, or its recording removed.
 */
export function cancelEvent(event: EventRecord | null, basedOn: number, actor: string, at: string): Outcome<{ event: EventRecord; ledger: LedgerEvent }> {
  if (!event) return refuse('not_found', 'no such event');
  if (basedOn !== event.version) return refuse('conflict', stale('event'));
  if (event.status !== 'published') return refuse('conflict', 'only a published event can be cancelled');
  if (Date.parse(event.endsAt) <= Date.parse(at)) return refuse('conflict', 'it has already taken place, so it cannot be cancelled');
  const cancelled: EventRecord = { ...event, status: 'cancelled', version: event.version + 1, updatedAt: at, updatedBy: actor, cancelledAt: at, cancelledBy: actor };
  return { ok: true, value: { event: cancelled, ledger: eventEvent('event.cancelled', actor, cancelled) } };
}

/** Only a draft that was never published can be deleted; a published event is cancelled instead, and stays on record. */
export function checkDeleteEvent(event: EventRecord | null): Outcome<EventRecord> {
  if (!event) return refuse('not_found', 'no such event');
  if (event.publishedAt) return refuse('conflict', 'an event that has been published is cancelled, not deleted');
  return { ok: true, value: event };
}

/** Where an event stands at `now`: still to come, on now, or over. */
export type EventPhase = 'upcoming' | 'live' | 'past';
export function eventPhase(event: Pick<EventRecord, 'startsAt' | 'endsAt'>, now: string): EventPhase {
  if (event.endsAt <= now) return 'past';
  return event.startsAt <= now ? 'live' : 'upcoming';
}

/** An event in the Events list, a partner's list and the calendars: what the public sees, without who wrote it. */
export interface PublicEventSummary {
  readonly slug: string;
  readonly kind: EventKind;
  readonly title: string;
  readonly summary: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly attendance: EventAttendance;
  readonly place: string;
  readonly speakers: readonly string[];
  readonly status: 'published' | 'cancelled';
  /** Whether its page has a recording to play. */
  readonly recorded: boolean;
  /** Its co-hosts that are listed on the Partners page (§10.17); others are not named. */
  readonly partners: readonly PublicPartnerRef[];
}

/** `GET /v1/public/events/{slug}`: an event in full. The link to join is given only until it is over or cancelled. */
export interface PublicEvent extends PublicEventSummary {
  readonly body: string;
  readonly joinUrl: string;
  readonly joinLabel: string;
  readonly address: string;
  readonly hashtags: readonly string[];
  readonly recording: Video | null;
  readonly publishedAt: string;
  readonly editedAt: string | null;
  readonly cancelledAt: string | null;
}

/** `GET /v1/public/events`: what is coming (soonest first, those on now and those cancelled among them), and what was. */
export interface PublicEventsPage {
  readonly upcoming: readonly PublicEventSummary[];
  readonly past: readonly PublicEventSummary[];
}

type Partners = ReadonlyMap<string, PartnerRecord>;

export function eventSummary(event: EventRecord, partners: Partners): PublicEventSummary {
  return {
    slug: event.slug,
    kind: event.kind,
    title: event.title,
    summary: event.summary,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
    attendance: event.attendance,
    place: event.place,
    speakers: event.speakers,
    status: event.status === 'cancelled' ? 'cancelled' : 'published',
    recorded: !!event.recording,
    partners: listedPartners(event.partnerIds, partners),
  };
}

/** What the public sees of an event, or null while it is a draft. */
export function publicEvent(event: EventRecord, partners: Partners, now: string): PublicEvent | null {
  if (event.status === 'draft') return null;
  const joinable = event.status === 'published' && eventPhase(event, now) !== 'past';
  return {
    ...eventSummary(event, partners),
    body: event.body,
    joinUrl: joinable ? event.joinUrl : '',
    joinLabel: joinable ? event.joinLabel : '',
    address: event.address,
    hashtags: event.hashtags,
    recording: event.recording,
    publishedAt: event.publishedAt ?? event.updatedAt,
    editedAt: event.editedAt,
    cancelledAt: event.cancelledAt,
  };
}

/**
 * The Events page from every event the public may reach: what has not ended, soonest first (a cancelled one stays
 * there, marked, until its time has passed), then what took place, newest first. A cancelled event that has passed is
 * reached only at its address.
 */
export function eventsPage(events: readonly EventRecord[], partners: Partners, now: string): PublicEventsPage {
  const shown = events.filter((e) => e.status !== 'draft');
  const upcoming = shown.filter((e) => e.endsAt > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.slug.localeCompare(b.slug));
  const past = shown
    .filter((e) => e.endsAt <= now && e.status === 'published')
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || a.slug.localeCompare(b.slug))
    .slice(0, PAST_EVENTS_SHOWN);
  return { upcoming: upcoming.map((e) => eventSummary(e, partners)), past: past.map((e) => eventSummary(e, partners)) };
}

/** What a link to join an event is called: its label, else its site ("youtube.com"). */
export function joinLinkName(event: Partial<Pick<EventRecord, 'joinUrl' | 'joinLabel'>>): string {
  if (event.joinLabel) return event.joinLabel;
  try {
    return new URL(event.joinUrl ?? '').host.replace(/^www\./, '');
  } catch {
    return 'the link';
  }
}

/** Where an event is, in a few words: its place, its link's name, or the members' room. */
export function eventWhere(event: Pick<EventRecord, 'attendance' | 'place'> & Partial<Pick<EventRecord, 'joinUrl' | 'joinLabel'>>): string {
  if (event.attendance === 'in_person') return event.joinUrl ? `${event.place} · also online` : event.place;
  if (event.attendance === 'members_room') return 'Members’ room, for Active members';
  // The public see the link only until the event is over.
  return event.joinUrl || event.joinLabel ? `Online · ${joinLinkName(event)}` : 'Online';
}

/**
 * When an event is, in its own zone and in US English: "Thursday, December 3, 2026, 8:00 – 9:30 PM EST", or both
 * dates when it runs past midnight there.
 */
export function eventWhen(event: Pick<EventRecord, 'startsAt' | 'endsAt' | 'timeZone'>, locale = 'en-US'): string {
  const format = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: event.timeZone,
    timeZoneName: 'short',
  });
  return format.formatRange(new Date(event.startsAt), new Date(event.endsAt)).replace(/\s+/g, ' ');
}

/** An event's page, as an absolute address. */
export const eventPageUrl = (origin: string, slug: string) => `${origin.replace(/\/$/, '')}/events/${encodeURIComponent(slug)}`;

/** Where its calendar file is, from the site's origin. */
export const eventCalendarPath = (slug: string) => `/v1/public/events/${encodeURIComponent(slug)}/calendar.ics`;
export const EVENTS_CALENDAR_PATH = '/v1/public/events/calendar.ics';

type CalendarEvent = Pick<
  EventRecord,
  'eventId' | 'slug' | 'title' | 'summary' | 'startsAt' | 'endsAt' | 'attendance' | 'joinUrl' | 'joinLabel' | 'place' | 'address' | 'status' | 'version'
>;

/** Where an event is, for a calendar's LOCATION: the place and address, the link, or the room's page. */
function calendarLocation(event: CalendarEvent, origin: string): string {
  if (event.attendance === 'in_person') return [event.place, event.address].filter(Boolean).join(', ');
  if (event.attendance === 'members_room') return `Members’ room (Active members): ${origin}/room`;
  return event.joinUrl;
}

function calendarDescription(event: CalendarEvent, origin: string): string {
  const cancelled = event.status === 'cancelled';
  const join =
    event.attendance === 'members_room'
      ? `For Active members, in the members’ room: ${origin}/room`
      : event.joinUrl
        ? `${event.attendance === 'in_person' ? 'Also online' : 'Join'} (${joinLinkName(event)}): ${event.joinUrl}`
        : '';
  return [cancelled ? 'This event was cancelled.' : '', event.summary, cancelled ? '' : join, `Details: ${eventPageUrl(origin, event.slug)}`]
    .filter(Boolean)
    .join('\n\n');
}

function vevent(event: CalendarEvent, origin: string, now: string): string[] {
  const cancelled = event.status === 'cancelled';
  const location = calendarLocation(event, origin);
  return [
    'BEGIN:VEVENT',
    // The event's ID is a UUIDv7, which RFC 7986 recommends for UID: stable, and unique on its own.
    `UID:${icsText(event.eventId)}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(event.startsAt)}`,
    `DTEND:${icsUtc(event.endsAt)}`,
    `SEQUENCE:${event.version}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${icsText(`${cancelled ? 'Cancelled: ' : ''}${event.title}`)}`,
    `DESCRIPTION:${icsText(calendarDescription(event, origin))}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    `URL:${eventPageUrl(origin, event.slug)}`,
    'END:VEVENT',
  ];
}

/**
 * Events as an iCalendar file (RFC 5545): one event for its page's "Add to calendar", or the calendar to subscribe to,
 * with its name. Only what the public pages show is in it; drafts never are.
 */
export function eventsCalendar(input: {
  readonly events: readonly CalendarEvent[];
  /** Where the web app is served; each event links to its page there. */
  readonly origin: string;
  /** When the file is made (DTSTAMP), ISO 8601. */
  readonly now: string;
  /** The subscribed calendar's name; none for one event's file. */
  readonly name?: string;
}): string {
  const origin = input.origin.replace(/\/$/, '');
  const shown = input.events.filter((e) => e.status !== 'draft');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${CALENDAR_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(input.name ? [`NAME:${icsText(input.name)}`, `X-WR-CALNAME:${icsText(input.name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'] : []),
    ...shown.flatMap((e) => vevent(e, origin, input.now)),
    'END:VCALENDAR',
  ];
  return lines.map((line) => `${foldLine(line)}\r\n`).join('');
}

/** The events a subscribed calendar holds: those not yet over, and those over in the last `EVENTS_CALENDAR_PAST_DAYS`. */
export function calendarEvents<T extends Pick<EventRecord, 'status' | 'endsAt' | 'startsAt'>>(events: readonly T[], now: string): T[] {
  const since = new Date(Date.parse(now) - EVENTS_CALENDAR_PAST_DAYS * 86_400_000).toISOString();
  return events.filter((e) => e.status !== 'draft' && e.endsAt >= since).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

type LinkedEvent = Pick<EventRecord, 'title' | 'summary' | 'startsAt' | 'endsAt' | 'timeZone' | 'slug'> & Parameters<typeof calendarLocation>[0];

/**
 * "Add to Google Calendar": a plain link to Google's own form with the event filled in, as share buttons are (§10.9):
 * nothing of Google's loads here, and nothing is saved until the person saves it there.
 */
export function googleCalendarUrl(event: LinkedEvent, origin: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${icsUtc(event.startsAt)}/${icsUtc(event.endsAt)}`,
    details: calendarDescription(event, origin.replace(/\/$/, '')),
    location: calendarLocation(event, origin.replace(/\/$/, '')),
    ctz: event.timeZone,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** "Add to Outlook": Outlook.com's own form, filled in the same way. */
export function outlookCalendarUrl(event: LinkedEvent, origin: string): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: event.startsAt,
    enddt: event.endsAt,
    body: calendarDescription(event, origin.replace(/\/$/, '')),
    location: calendarLocation(event, origin.replace(/\/$/, '')),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}

/** A listed partner on the Partners page, with the events it co-hosts that the Events page shows. */
export interface PartnerWithEvents extends PublicPartner {
  readonly upcoming: readonly PublicEventSummary[];
  readonly past: readonly PublicEventSummary[];
}

/** `GET /v1/public/partners`: the listed groups, by name, each with its co-hosted events. */
export interface PublicPartnersPage {
  readonly partners: readonly PartnerWithEvents[];
}

export function partnersPage(partners: readonly PartnerRecord[], events: readonly EventRecord[], now: string): PublicPartnersPage {
  const byId = new Map(partners.map((p) => [p.partnerId, p]));
  const page = eventsPage(events, byId, now);
  const cohosted = (list: readonly PublicEventSummary[], partnerId: string) => list.filter((e) => e.partners.some((p) => p.partnerId === partnerId));
  return {
    partners: publicPartners(partners).map((p) => ({ ...p, upcoming: cohosted(page.upcoming, p.partnerId), past: cohosted(page.past, p.partnerId) })),
  };
}

/** The wall-clock time an instant is in `zone`, as a `YYYY-MM-DDTHH:mm` for a datetime input. */
export function zonedLocalTime(iso: string, zone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * The instant a wall-clock time (`YYYY-MM-DDTHH:mm`) is in `zone`, as ISO 8601 in UTC; empty for no such time. A time
 * skipped when the clocks go forward is read as the hour after; one that happens twice, as the first.
 */
export function zonedInstant(local: string, zone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return '';
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const offset = (at: number) => {
    const shown = zonedLocalTime(new Date(at).toISOString(), zone);
    const [, y, mo, d, h, mi] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(shown)!;
    return Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!) - at;
  };
  // The zone's offset near that time, then at the instant that gives, which differs only across a change of clocks.
  const first = wall - offset(wall);
  const second = wall - offset(first);
  // `second` shows that wall-clock time unless the time falls where the clocks skip; then `first`, the hour after.
  return new Date(offset(second) === wall - second ? second : first).toISOString();
}
