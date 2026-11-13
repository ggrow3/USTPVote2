import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  calendarEvents,
  cancelEvent,
  checkDeleteEvent,
  createEvent,
  eventsCalendar,
  eventsPage,
  partnersPage,
  publicEvent,
  publishEvent,
  updateEvent,
  uploadedVideoIds,
  uuidv7,
  type CreateEventInput,
  type EventRecord,
  type LedgerEvent,
  type Outcome,
  type PartnerRecord,
  type PublicEvent,
  type PublicEventsPage,
  type PublicPartnersPage,
  type UpdateEventInput,
} from 'ustp-domain';
import { HubService } from '../administration/hub.js';
import { accepted } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { VideosService } from '../videos/videos.js';
import { EventsRepository } from './events.repository.js';

/** The public pages and calendars are read by every visitor and calendar app, so each api instance keeps them this long. */
const CACHE_MS = 30_000;

/**
 * The party's public events (design §10.17): the Events and Partners pages, each event's page and calendar file, the
 * calendar to subscribe to, and Communications Admins' drafts. Each publication, change of an event the public can
 * see, and cancellation is ledgered in the transaction that makes it.
 */
@Injectable()
export class EventsService {
  private cache: { at: number; events: EventRecord[]; partners: PartnerRecord[] } | null = null;

  constructor(
    private readonly firebase: Firebase,
    private readonly repo: EventsRepository,
    private readonly ledger: LedgerService,
    private readonly hub: HubService,
    private readonly videos: VideosService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  // --- Public ------------------------------------------------------------------------------------------------------

  /** Every event the public may reach, and every partner (cached briefly). */
  private async shown(): Promise<{ events: EventRecord[]; partners: PartnerRecord[] }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const [events, partners] = await Promise.all([this.repo.publicEvents(), this.repo.allPartners()]);
    this.cache = { at: Date.now(), events, partners };
    return this.cache;
  }

  /** Forgets what this instance kept, after a change here or to a partner. */
  forget(): void {
    this.cache = null;
  }

  private origin(requestOrigin: string): string {
    return (this.config.webOrigin ?? requestOrigin).replace(/\/$/, '');
  }

  async page(): Promise<PublicEventsPage> {
    const { events, partners } = await this.shown();
    return eventsPage(events, new Map(partners.map((p) => [p.partnerId, p])), new Date().toISOString());
  }

  async partnersPage(): Promise<PublicPartnersPage> {
    const { events, partners } = await this.shown();
    return partnersPage(partners, events, new Date().toISOString());
  }

  /** A published or cancelled event, as its page shows it; 404 for anything else. */
  async event(slug: string): Promise<PublicEvent> {
    const event = await this.repo.eventBySlug(slug);
    const partners = event?.partnerIds.length ? await this.repo.partnersById(event.partnerIds) : new Map<string, PartnerRecord>();
    const shown = event && publicEvent(event, partners, new Date().toISOString());
    if (!shown) throw new NotFoundException('no such event');
    return shown;
  }

  /** One event's calendar file, for its page's "Add to calendar". */
  async calendar(slug: string, requestOrigin: string): Promise<string> {
    const event = await this.repo.eventBySlug(slug);
    if (!event || event.status === 'draft') throw new NotFoundException('no such event');
    return eventsCalendar({ events: [event], origin: this.origin(requestOrigin), now: new Date().toISOString() });
  }

  /** The calendar to subscribe to: what is coming, and the last 90 days. */
  async subscribedCalendar(requestOrigin: string): Promise<string> {
    const [{ events }, { profile }] = await Promise.all([this.shown(), this.hub.shown()]);
    const now = new Date().toISOString();
    return eventsCalendar({ events: calendarEvents(events, now), origin: this.origin(requestOrigin), now, name: `${profile.name} events` });
  }

  // --- Communications Admins ---------------------------------------------------------------------------------------

  /** Every event: drafts first, most recently changed first, then the rest by when they are, latest first. */
  async all(): Promise<EventRecord[]> {
    const events = await this.repo.allEvents();
    const rank = (e: EventRecord) => (e.status === 'draft' ? 0 : 1);
    const when = (e: EventRecord) => (e.status === 'draft' ? e.updatedAt : e.startsAt);
    return events.sort((a, b) => rank(a) - rank(b) || when(b).localeCompare(when(a)));
  }

  async detail(eventId: string): Promise<EventRecord> {
    const event = await this.repo.findEvent(eventId);
    if (!event) throw new NotFoundException('no such event');
    return event;
  }

  /** Refuses a save naming a co-host that is not on the partners list, or a recording not uploaded here. */
  private async checkLinks(tx: Transaction, input: Pick<CreateEventInput, 'partnerIds' | 'recording'>): Promise<void> {
    const found = await this.repo.partnersById(input.partnerIds, tx);
    if (input.partnerIds.some((id) => !found.has(id))) throw new BadRequestException('a co-host is not on the partners list; add the group there first');
    await this.videos.requireReady(uploadedVideoIds([input.recording]), tx);
  }

  async create(actor: string, input: CreateEventInput): Promise<EventRecord> {
    const eventId = uuidv7();
    await this.firebase.db.runTransaction(async (tx) => {
      const taken = !!(await this.repo.eventBySlug(input.slug, tx));
      await this.checkLinks(tx, input);
      this.repo.setEvent(tx, accepted(createEvent(input, eventId, taken, actor, new Date().toISOString())));
    });
    return this.detail(eventId);
  }

  async update(actor: string, eventId: string, input: UpdateEventInput): Promise<EventRecord> {
    const { basedOn, ...content } = input;
    return this.change(eventId, async (tx, event) => {
      const other = content.slug === event?.slug ? null : await this.repo.eventBySlug(content.slug, tx);
      await this.checkLinks(tx, content);
      return updateEvent(event, content, basedOn, !!other && other.eventId !== eventId, actor, new Date().toISOString());
    });
  }

  async publish(actor: string, eventId: string, basedOn: number): Promise<EventRecord> {
    return this.change(eventId, async (_tx, event) => publishEvent(event, basedOn, actor, new Date().toISOString()));
  }

  async cancel(actor: string, eventId: string, basedOn: number): Promise<EventRecord> {
    return this.change(eventId, async (_tx, event) => cancelEvent(event, basedOn, actor, new Date().toISOString()));
  }

  /** Deletes a draft that was never published. */
  async delete(eventId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const event = accepted(checkDeleteEvent(await this.repo.getEvent(tx, eventId)));
      this.repo.deleteEvent(tx, event.eventId);
    });
  }

  /** Runs a change to one event in a transaction: every read, then its ledger entry (it reads the ledger head), then the event. */
  private async change(
    eventId: string,
    act: (tx: Transaction, event: EventRecord | null) => Promise<Outcome<{ event: EventRecord; ledger: LedgerEvent | null }>>,
  ): Promise<EventRecord> {
    const saved = await this.firebase.db.runTransaction(async (tx) => {
      const { event, ledger } = accepted(await act(tx, await this.repo.getEvent(tx, eventId)));
      if (ledger) await this.ledger.record(tx, [ledger]);
      this.repo.setEvent(tx, event);
      return event;
    });
    this.forget();
    return saved;
  }
}
