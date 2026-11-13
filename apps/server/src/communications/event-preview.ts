import { Injectable } from '@nestjs/common';
import { EVENT_KIND_NAMES, eventPhase, eventWhen, eventWhere, type LinkPreview } from 'ustp-domain';
import { orNone, type LinkPreviewSource } from '../link-previews/link-previews.js';
import { EventsService } from './events.service.js';

/**
 * A published or cancelled event's link preview (design §15, "Link previews"; §10.17): its title and summary, and a
 * card saying what kind of event it is, when (in its own zone), where, and who speaks or co-hosts. Once it is over the
 * card says it has a recording, if it has one; a cancelled event's card says it was cancelled.
 */
@Injectable()
export class EventPreviews implements LinkPreviewSource {
  readonly page = '/events/:slug';

  constructor(private readonly events: EventsService) {}

  async preview({ slug }: Readonly<Record<string, string>>): Promise<LinkPreview | null> {
    const event = await orNone(this.events.event(slug!));
    if (!event) return null;
    const kind = EVENT_KIND_NAMES[event.kind];
    const past = eventPhase(event, new Date().toISOString()) === 'past';
    const kicker =
      event.status === 'cancelled' ? `Cancelled · ${kind}` : past ? (event.recorded ? `Recording · ${kind}` : `Past event · ${kind}`) : `Event · ${kind}`;
    const who = event.partners.length
      ? `Co-hosted with ${event.partners.map((p) => p.name).join(', ')}`
      : event.speakers.length
        ? `With ${event.speakers.join(', ')}`
        : '';
    return {
      title: event.title,
      description: event.summary,
      card: { kicker, title: event.title, lines: [eventWhen(event), eventWhere(event), who].filter(Boolean) },
    };
  }
}
