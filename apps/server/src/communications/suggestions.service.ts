import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  checkSuggestionLimits,
  isTrapped,
  newSuggestion,
  suggestionDay,
  suggestionsExpireBefore,
  triageSuggestion,
  uuidv7,
  type SuggestionInput,
  type SuggestionRecord,
  type SuggestionTriageInput,
} from 'ustp-domain';
import { assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { CommunicationsRepository } from './communications.repository.js';

/**
 * Suggestions from the public (design §10.7). Anyone may send one; Communications Admins read and handle them. Senders
 * are counted per UTC day under a salted hash of their address, kept only for that day, so a sender can be held to
 * the day's limit without the address being kept. Nothing is ledgered: a suggestion, and the name and email that may
 * come with it, are deleted a year after they arrive.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: CommunicationsRepository,
  ) {}

  /** Takes a suggestion from `address` (the sender's network address), within the day's limits. */
  async submit(input: SuggestionInput, address: string): Promise<void> {
    if (isTrapped(input)) return;
    const now = new Date();
    const day = suggestionDay(now);
    await this.firebase.db.runTransaction(async (tx) => {
      const limits = await this.repo.getSuggestionLimits(tx, day);
      const salt = limits?.salt ?? randomBytes(32).toString('hex');
      const sender = createHash('sha256').update(`${salt}:${address}`).digest('hex').slice(0, 32);
      assertCheck(checkSuggestionLimits(limits, sender));
      this.repo.createSuggestion(tx, newSuggestion(input, uuidv7(now.getTime()), now.toISOString()));
      this.repo.setSuggestionLimits(tx, {
        day,
        salt,
        total: (limits?.total ?? 0) + 1,
        senders: { ...limits?.senders, [sender]: (limits?.senders[sender] ?? 0) + 1 },
      });
    });
  }

  /** Every suggestion, newest first. */
  async list(): Promise<SuggestionRecord[]> {
    return (await this.repo.allSuggestions()).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async triage(actor: string, suggestionId: string, input: SuggestionTriageInput): Promise<SuggestionRecord> {
    return this.firebase.db.runTransaction(async (tx) => {
      const current = await this.repo.getSuggestion(tx, suggestionId);
      if (!current) throw new NotFoundException('no such suggestion');
      const updated = triageSuggestion(current, input, actor, new Date().toISOString());
      if (updated !== current) this.repo.setSuggestion(tx, updated);
      return updated;
    });
  }

  /** Deletes a suggestion now: spam, or a sender who asked. */
  async delete(suggestionId: string): Promise<void> {
    if (!(await this.repo.deleteSuggestion(suggestionId))) throw new NotFoundException('no such suggestion');
  }

  /** The worker's tick: suggestions a year old, and the limits (with their salts) of days before yesterday. */
  async deleteExpired(now = new Date()): Promise<number> {
    const yesterday = suggestionDay(new Date(now.getTime() - 86_400_000));
    return this.repo.deleteExpired(suggestionsExpireBefore(now), yesterday);
  }
}
