import { Injectable } from '@nestjs/common';
import { Collections } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * The room context's port for the others (design §3.3): whether someone has entered the members' room, read only. The
 * join funnel (§5.15) counts new members who have.
 */
@Injectable()
export class RoomEntry {
  constructor(private readonly firebase: Firebase) {}

  /** Whether the account has ever accepted the room's terms, which is how the room is entered (design §5.10). */
  async hasEntered(accountId: string): Promise<boolean> {
    const snap = await this.firebase.db.collection(Collections.roomConsents).where('accountId', '==', accountId).limit(1).get();
    return !snap.empty;
  }
}
