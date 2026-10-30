import { Injectable } from '@nestjs/common';
import { RoomAssistant } from './room-assistant.js';
import { RoomRepository } from './room.repository.js';

/** At most this many of each kind of record go per tick; a backlog clears over the next ticks. */
const PER_TICK = 300;

/**
 * The room's retention (design §5.10, spec rules 4 and 9), a step of the worker's tick: messages 90 days old, action
 * items 90 days after they were done, finished questions a day old and the call's handshakes 5 minutes old are
 * deleted, questions the assistant has not answered in `ROOM_LIMITS.jobMinutes` are given up on with a reply saying
 * so, and anyone whose page went quiet is dropped from the call.
 */
@Injectable()
export class RoomRetention {
  constructor(
    private readonly repo: RoomRepository,
    private readonly assistant: RoomAssistant,
  ) {}

  async run(): Promise<number> {
    const now = new Date().toISOString();
    const failed = await this.assistant.failStale();
    const dropped = await this.repo.sweepVoice(now);
    return failed + dropped + (await this.repo.deleteExpired(now, PER_TICK));
  }
}
