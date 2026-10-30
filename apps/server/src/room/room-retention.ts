import { Injectable } from '@nestjs/common';
import { RoomAssistant } from './room-assistant.js';
import { RoomRepository } from './room.repository.js';

/** At most this many of each kind of record go per tick; a backlog clears over the next ticks. */
const PER_TICK = 300;

/**
 * The room's retention (design §5.10, spec rules 4 and 9), a step of the worker's tick: messages 90 days old, action
 * items 90 days after they were done and finished questions a day old are deleted, and questions the assistant has
 * not answered in `ROOM_LIMITS.jobMinutes` are given up on with a reply saying so.
 */
@Injectable()
export class RoomRetention {
  constructor(
    private readonly repo: RoomRepository,
    private readonly assistant: RoomAssistant,
  ) {}

  async run(): Promise<number> {
    const failed = await this.assistant.failStale();
    return failed + (await this.repo.deleteExpired(new Date().toISOString(), PER_TICK));
  }
}
