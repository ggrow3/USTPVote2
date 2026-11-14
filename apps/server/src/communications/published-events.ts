import { Injectable } from '@nestjs/common';
import { Collections, type EventRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * The communications context's port for the others (design §3.3): the published events that start within a span of
 * time, read only. The Discord bot (§10.18) says when one is a day away.
 */
@Injectable()
export class PublishedEvents {
  constructor(private readonly firebase: Firebase) {}

  /** Published events that start after `after` and at or before `until`, soonest first. */
  async startingBetween(after: string, until: string): Promise<Pick<EventRecord, 'eventId' | 'slug' | 'title' | 'startsAt'>[]> {
    const snap = await this.firebase.db.collection(Collections.events).where('startsAt', '>', after).where('startsAt', '<=', until).get();
    return snap.docs
      .map((d) => d.data() as EventRecord)
      .filter((event) => event.status === 'published')
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(({ eventId, slug, title, startsAt }) => ({ eventId, slug, title, startsAt }));
  }
}
