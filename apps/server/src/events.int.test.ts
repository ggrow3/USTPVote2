import type { EventRecord, LedgerEntry, PartnerRecord, PublicEvent, PublicEventsPage, PublicPartnersPage } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, type ServerConfig } from './config.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let comms: Member;
let ada: Member;

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

/** An hour-and-a-half event `offset` days from now (or ago). */
const at = (offset: number) => {
  const start = Date.now() + offset * 86_400_000;
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 90 * 60_000).toISOString() };
};

const EVENT = {
  kind: 'candidate_qa',
  title: 'Q&A with our House candidates',
  slug: 'house-candidates-qa',
  summary: 'Ask the party’s House candidates anything.',
  body: 'Bring your questions.',
  ...at(7),
  timeZone: 'America/New_York',
  attendance: 'online',
  joinUrl: 'https://www.youtube.com/live/abc',
  joinLabel: 'YouTube Live',
  speakers: ['Jo Smith, candidate for CA-12'],
};

const ADMIN = '/v1/admin/communications';
const draft = async (body: Record<string, unknown> = {}) => (await api.call('POST', `${ADMIN}/events`, comms, { ...EVENT, ...body })).body as EventRecord;
const publish = async (event: EventRecord) => (await api.call('POST', `${ADMIN}/events/${event.eventId}/publish`, comms, { basedOn: event.version })).body as EventRecord;
const content = (event: EventRecord) => {
  const { kind, title, slug, summary, body, startsAt, endsAt, timeZone, attendance, joinUrl, joinLabel, place, address, speakers, partnerIds, hashtags, recording } = event;
  return { kind, title, slug, summary, body, startsAt, endsAt, timeZone, attendance, joinUrl, joinLabel, place, address, speakers, partnerIds, hashtags, recording };
};
const addPartner = async (name: string) =>
  (await api.call('POST', `${ADMIN}/partners`, comms, { name, description: `${name} brings people together.`, website: 'https://example.org', notes: 'Talk to Jo' }))
    .body as PartnerRecord;

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  comms = await api.member('comms@example.test');
  ada = await api.member('ada@example.test');
  await api.grant(comms.accountId, 'communications_admin', sa1);
});

describe('who keeps events and partners', () => {
  it('Communications Admins only', async () => {
    for (const path of ['events', 'partners']) {
      expect((await api.call('GET', `${ADMIN}/${path}`)).status).toBe(401);
      for (const user of [ada, sa1]) expect((await api.call('GET', `${ADMIN}/${path}`, user)).status).toBe(403);
      expect((await api.call('GET', `${ADMIN}/${path}`, comms)).status).toBe(200);
    }
    expect((await api.call('POST', `${ADMIN}/events`, ada, EVENT)).status).toBe(403);
  });

  it('an ID that is no UUIDv7 names nothing, a slash included', async () => {
    expect((await api.call('GET', `${ADMIN}/events/not-an-id`, comms)).status).toBe(404);
    expect((await api.call('PUT', `${ADMIN}/partners/a%2Fb`, comms, { name: 'x', basedOn: 1 })).status).toBe(404);
    expect((await api.call('GET', '/v1/public/events/a%2Fb')).status).toBe(404);
    expect((await api.call('GET', '/v1/public/events/Not%20A%20Slug/calendar.ics')).status).toBe(404);
  });
});

describe('events', () => {
  it('a draft is private until published; publishing is ledgered and public at once', async () => {
    const event = await draft();
    expect(event).toMatchObject({ status: 'draft', slug: EVENT.slug, createdBy: comms.accountId, version: 1 });
    expect((await api.call('GET', `/v1/public/events/${EVENT.slug}`)).status).toBe(404);
    expect((await api.call('GET', `/v1/public/events/${EVENT.slug}/calendar.ics`)).status).toBe(404);
    expect((await api.call('GET', '/v1/public/events')).body).toEqual({ upcoming: [], past: [] });

    const published = await publish(event);
    expect(published).toMatchObject({ status: 'published', version: 2, publishedBy: comms.accountId });
    expect((await entries('event.published')).map((e) => [e.actor, e.subject, e.payload.slug])).toEqual([[comms.accountId, event.eventId, EVENT.slug]]);

    const page = await api.call('GET', `/v1/public/events/${EVENT.slug}`);
    expect(page).toMatchObject({ status: 200, body: { title: EVENT.title, joinUrl: EVENT.joinUrl, speakers: EVENT.speakers, status: 'published', recorded: false } });
    expect(page.body).not.toHaveProperty('createdBy');
    expect(page.body).not.toHaveProperty('eventId');
    expect(((await api.call('GET', '/v1/public/events')).body as PublicEventsPage).upcoming.map((e) => e.slug)).toEqual([EVENT.slug]);
  });

  it('refuses a second event at an address, a stale edit, and a new address once published; ledgers published changes', async () => {
    const event = await draft();
    expect((await api.call('POST', `${ADMIN}/events`, comms, EVENT)).status).toBe(409);
    const edit = (body: Record<string, unknown>, basedOn: number) => api.call('PUT', `${ADMIN}/events/${event.eventId}`, comms, { ...content(event), ...body, basedOn });
    expect((await edit({ title: 'Changed' }, 1)).body).toMatchObject({ title: 'Changed', version: 2 });
    expect((await edit({ title: 'Again' }, 1)).status).toBe(409);
    expect(await entries('event.changed')).toEqual([]);

    const shown = await publish((await api.call('GET', `${ADMIN}/events/${event.eventId}`, comms)).body as EventRecord);
    const later = at(8);
    const moved = await api.call('PUT', `${ADMIN}/events/${event.eventId}`, comms, { ...content(shown), ...later, basedOn: shown.version });
    expect(moved.body).toMatchObject({ startsAt: later.startsAt, version: shown.version + 1 });
    expect((await entries('event.changed')).map((e) => e.payload.fields)).toEqual([['startsAt', 'endsAt']]);
    const renamed = await api.call('PUT', `${ADMIN}/events/${event.eventId}`, comms, { ...content(shown), ...later, slug: 'elsewhere', basedOn: shown.version + 1 });
    expect(renamed.status).toBe(409);
  });

  it('checks what an event must be, field by field', async () => {
    const res = await api.call('POST', `${ADMIN}/events`, comms, { ...EVENT, endsAt: EVENT.startsAt, joinUrl: '' });
    expect(res.status).toBe(400);
    expect((res.body as { errors: { path: string }[] }).errors.map((e) => e.path).sort()).toEqual(['endsAt', 'joinUrl']);
    expect((await api.call('POST', `${ADMIN}/events`, comms, { ...EVENT, attendance: 'in_person', joinUrl: '', place: 'The Hall' })).status).toBe(201);
  });

  it('is cancelled, ledgered, and said so on its page and in calendars; only a draft is deleted', async () => {
    const shown = await publish(await draft());
    expect((await api.call('DELETE', `${ADMIN}/events/${shown.eventId}`, comms)).status).toBe(409);
    const cancelled = await api.call('POST', `${ADMIN}/events/${shown.eventId}/cancel`, comms, { basedOn: shown.version });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelledBy: comms.accountId });
    expect((await entries('event.cancelled')).map((e) => e.subject)).toEqual([shown.eventId]);
    expect((await api.call('GET', `/v1/public/events/${EVENT.slug}`)).body).toMatchObject({ status: 'cancelled', joinUrl: '' });
    const ics = await api.app.inject({ method: 'GET', url: `/v1/public/events/${EVENT.slug}/calendar.ics` });
    expect(ics.body).toContain('STATUS:CANCELLED');
    expect(((await api.call('GET', '/v1/public/events')).body as PublicEventsPage).upcoming.map((e) => e.status)).toEqual(['cancelled']);

    const other = await draft({ slug: 'other-event' });
    expect((await api.call('DELETE', `${ADMIN}/events/${other.eventId}`, comms)).status).toBe(204);
    expect((await api.call('GET', `${ADMIN}/events/${other.eventId}`, comms)).status).toBe(404);
  });

  it('lists past events newest first, without their link, with their recording', async () => {
    const past = await draft({ slug: 'debate-night', kind: 'debate', ...at(-3), recording: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', start: 0 } });
    await publish(past);
    const older = await draft({ slug: 'older-talk', kind: 'talk', ...at(-30) });
    await publish(older);
    const page = (await api.call('GET', '/v1/public/events')).body as PublicEventsPage;
    expect(page.past.map((e) => [e.slug, e.recorded])).toEqual([
      ['debate-night', true],
      ['older-talk', false],
    ]);
    const shown = (await api.call('GET', '/v1/public/events/debate-night')).body as PublicEvent;
    expect(shown).toMatchObject({ joinUrl: '', recording: { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ' } });
    // A past event cannot be cancelled.
    const record = (await api.call('GET', `${ADMIN}/events/${past.eventId}`, comms)).body as EventRecord;
    expect((await api.call('POST', `${ADMIN}/events/${past.eventId}/cancel`, comms, { basedOn: record.version })).status).toBe(409);
  });

  it('takes a recording only if it was uploaded here and finished', async () => {
    const res = await api.call('POST', `${ADMIN}/events`, comms, { ...EVENT, recording: { kind: 'upload', videoId: '019a0000-0000-7000-8000-000000000000' } });
    expect(res.status).toBe(400);
  });
});

describe('calendars', () => {
  it('serves an event’s file and the calendar to subscribe to, at the site’s own address', async () => {
    const shown = await publish(await draft());
    await draft({ slug: 'secret-plan' });
    const one = await api.app.inject({ method: 'GET', url: `/v1/public/events/${EVENT.slug}/calendar.ics`, headers: { 'x-forwarded-host': 'vote.example.org', 'x-forwarded-proto': 'https' } });
    expect(one.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(one.headers['content-disposition']).toBe(`inline; filename="${EVENT.slug}.ics"`);
    expect(one.body).toContain(`UID:${shown.eventId}\r\n`);
    // Each event links to its page at the site's own address (WEB_ORIGIN), else where the request came.
    const origin = api.app.get<ServerConfig>(CONFIG).webOrigin ?? 'https://vote.example.org';
    expect(one.body).toContain(`URL:${origin}/events/${EVENT.slug}\r\n`);

    const all = await api.app.inject({ method: 'GET', url: '/v1/public/events/calendar.ics' });
    expect(all.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(all.body).toMatch(/X-WR-CALNAME:.+ events\r\n/);
    expect(all.body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(all.body).not.toContain('secret-plan');
  });
});

describe('partners', () => {
  it('are kept by the team, named in public only with recorded consent, every change ledgered but notes', async () => {
    const partner = await addPartner('Longevity Club');
    expect(partner).toMatchObject({ consent: null, notes: 'Talk to Jo', version: 1 });
    expect(((await api.call('GET', '/v1/public/partners')).body as PublicPartnersPage).partners).toEqual([]);

    const event = await publish(await draft({ kind: 'talk', partnerIds: [partner.partnerId] }));
    expect(((await api.call('GET', `/v1/public/events/${EVENT.slug}`)).body as PublicEvent).partners).toEqual([]);

    const consented = await api.call('POST', `${ADMIN}/partners/${partner.partnerId}/consent`, comms, { basedOn: 1, from: 'Jo Smith, chair', note: 'by email' });
    expect(consented.body).toMatchObject({ consent: { from: 'Jo Smith, chair', recordedBy: comms.accountId }, version: 2 });
    const page = (await api.call('GET', '/v1/public/partners')).body as PublicPartnersPage;
    expect(page.partners).toMatchObject([{ name: 'Longevity Club', website: 'https://example.org', upcoming: [{ slug: EVENT.slug }], past: [] }]);
    expect(page.partners[0]).not.toHaveProperty('notes');
    expect(page.partners[0]).not.toHaveProperty('consent');
    expect(((await api.call('GET', `/v1/public/events/${event.slug}`)).body as PublicEvent).partners).toEqual([
      { partnerId: partner.partnerId, name: 'Longevity Club', website: 'https://example.org' },
    ]);

    const notes = await api.call('PUT', `${ADMIN}/partners/${partner.partnerId}`, comms, { name: 'Longevity Club', description: partner.description, website: partner.website, notes: 'Call in December', basedOn: 2 });
    expect(notes.body).toMatchObject({ notes: 'Call in December', version: 3 });
    const withdrawn = await api.call('POST', `${ADMIN}/partners/${partner.partnerId}/withdraw-consent`, comms, { basedOn: 3 });
    expect(withdrawn.body).toMatchObject({ consent: null });
    expect(((await api.call('GET', '/v1/public/partners')).body as PublicPartnersPage).partners).toEqual([]);
    expect((await api.call('DELETE', `${ADMIN}/partners/${partner.partnerId}`, comms)).status).toBe(204);
    expect((await entries('partner.changed')).map((e) => e.payload.change)).toEqual(['added', 'consent_recorded', 'consent_withdrawn', 'removed']);
  });

  it('an event names only groups on the list as co-hosts', async () => {
    const res = await api.call('POST', `${ADMIN}/events`, comms, { ...EVENT, partnerIds: ['019a0000-0000-7000-8000-000000000000'] });
    expect(res.status).toBe(400);
  });
});

describe('share buttons on events', () => {
  it('count presses on a published event only', async () => {
    const event = await draft();
    const click = () => api.app.inject({ method: 'POST', url: '/v1/share/clicks', payload: { item: `event-${EVENT.slug}`, target: 'x' } });
    expect((await click()).statusCode).toBe(404);
    await publish(event);
    expect((await click()).statusCode).toBe(204);
    const counts = await api.call('GET', `${ADMIN}/share-counts`, comms);
    expect(counts.body).toMatchObject([{ item: `event-${EVENT.slug}`, total: 1, targets: { x: 1 } }]);
  });
});

