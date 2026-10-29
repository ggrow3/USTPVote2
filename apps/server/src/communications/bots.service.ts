import { Injectable } from '@nestjs/common';
import {
  addBot,
  BOT_SITES,
  checkBot,
  removeBot,
  updateBot,
  uuidv7,
  type BotRecord,
  type CreateBotInput,
  type LedgerEvent,
  type Outcome,
  type UpdateBotInput,
} from 'ustp-domain';
import { accepted } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CommunicationsRepository } from './communications.repository.js';

/** The registry of the party's bots (design §10.9). Every change is ledgered; no bot's token or password is kept. */
@Injectable()
export class BotsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly repo: CommunicationsRepository,
    private readonly ledger: LedgerService,
  ) {}

  /** Every bot, retired last, by site then name. */
  async all(): Promise<BotRecord[]> {
    const retired = (b: BotRecord) => Number(b.status === 'retired');
    return (await this.repo.allBots()).sort(
      (a, b) => retired(a) - retired(b) || BOT_SITES.indexOf(a.site) - BOT_SITES.indexOf(b.site) || a.name.localeCompare(b.name),
    );
  }

  async add(actor: string, input: CreateBotInput): Promise<BotRecord> {
    const { bot, event } = addBot(input, uuidv7(), actor, new Date().toISOString());
    await this.firebase.db.runTransaction(async (tx) => {
      await this.ledger.record(tx, [event]);
      this.repo.setBot(tx, bot);
    });
    return bot;
  }

  async update(actor: string, botId: string, input: UpdateBotInput): Promise<BotRecord> {
    const { basedOn, ...content } = input;
    return this.change(botId, (bot) => updateBot(bot, content, basedOn, actor, new Date().toISOString()));
  }

  /** Someone on the team checked the bot still does what it says. */
  async checked(actor: string, botId: string, basedOn: number): Promise<BotRecord> {
    return this.change(botId, (bot) => checkBot(bot, basedOn, actor, new Date().toISOString()));
  }

  async remove(actor: string, botId: string): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const event = accepted(removeBot(await this.repo.getBot(tx, botId), actor));
      await this.ledger.record(tx, [event]);
      this.repo.deleteBot(tx, botId);
    });
  }

  private change(botId: string, act: (bot: BotRecord | null) => Outcome<{ bot: BotRecord; event: LedgerEvent | null }>): Promise<BotRecord> {
    return this.firebase.db.runTransaction(async (tx) => {
      const { bot, event } = accepted(act(await this.repo.getBot(tx, botId)));
      if (!event) return bot;
      await this.ledger.record(tx, [event]);
      this.repo.setBot(tx, bot);
      return bot;
    });
  }
}
