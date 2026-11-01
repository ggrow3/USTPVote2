import { Logger } from '@nestjs/common';
import { chargeMeter, nextMonthStart, type RoomModelRates } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';
import { RoomModelBudgetSpent, type AskQuestion, type AskSource, type RoomModel } from './room-model.js';
import { RoomRepository } from './room.repository.js';

/**
 * The room's model on Vertex AI with its monthly cap (design §5.10): each call charges `room_state/model` first, and a
 * call that would take the month's estimate past the cap, or any call once Google Cloud's budget stopped the month, is
 * refused with `RoomModelBudgetSpent` before anything reaches the model.
 */
export class MeteredRoomModel implements RoomModel {
  private readonly logger = new Logger(MeteredRoomModel.name);
  readonly kind = 'self-hosted' as const;

  constructor(
    private readonly model: RoomModel,
    private readonly firebase: Firebase,
    private readonly repo: RoomRepository,
    private readonly rates: RoomModelRates,
  ) {}

  get embedder(): string {
    return this.model.embedder;
  }

  async embed(texts: readonly string[], as: 'query' | 'document', until?: number): Promise<number[][]> {
    await this.charge();
    return this.model.embed(texts, as, until);
  }

  async answer(question: AskQuestion, sources: readonly AskSource[], until?: number): Promise<string> {
    await this.charge();
    return this.model.answer(question, sources, until);
  }

  async warm(until?: number): Promise<void> {
    await this.charge();
    return this.model.warm(until);
  }

  /** Charges the meter for one call, or refuses it. */
  async charge(): Promise<void> {
    const at = new Date().toISOString();
    const charged = await this.firebase.db.runTransaction(async (tx) => {
      const result = chargeMeter(await this.repo.getModelMeter(tx), at, this.rates);
      if (result.allowed) this.repo.setModelMeter(tx, result.meter);
      return result;
    });
    if (charged.allowed) {
      if (charged.wakes) this.logger.log(`room model woken; this month's estimate is now $${charged.estimateUsd.toFixed(2)}`);
      return;
    }
    const resumes = nextMonthStart(at);
    throw new RoomModelBudgetSpent(
      charged.reason === 'stopped'
        ? `Google Cloud’s budget for the room’s model is spent for this month; it starts again on ${resumes}`
        : `the room’s model has used this month’s $${this.rates.monthlyBudgetUsd} budget; it starts again on ${resumes}, or sooner if a System Admin raises the budget`,
    );
  }
}
