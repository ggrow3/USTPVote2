import { Controller, Get, Header, Injectable } from '@nestjs/common';
import { Collections, isRehearsalRoll, type DiscordAppState, type DiscordAppView, type DiscordOpenVote } from 'ustp-domain';
import { Public } from '../auth/decorators.js';
import { ElectionReader } from '../elections/election-reader.js';
import { Firebase } from '../infra/firebase.js';

/** What the commands service reads of the bot itself (design §10.18): the application's public key, and the open votes. */
@Injectable()
export class DiscordPublic {
  constructor(
    private readonly firebase: Firebase,
    private readonly elections: ElectionReader,
  ) {}

  async app(): Promise<DiscordAppView> {
    const state = (await this.firebase.db.collection(Collections.discordState).doc('app').get()).data() as Partial<DiscordAppState> | undefined;
    return { publicKey: state?.publicKey ?? null };
  }

  /** Votes open now, soonest to close first, without rehearsals. Each is already public on the ledger (`election.opened`). */
  async votes(now: Date = new Date()): Promise<DiscordOpenVote[]> {
    const votes: DiscordOpenVote[] = [];
    for (const election of await this.elections.inState('open')) {
      if (Date.parse(election.closesAt) <= now.getTime()) continue;
      if (isRehearsalRoll((await this.elections.approvedRoll(election))?.criteria)) continue;
      votes.push({ electionId: election.electionId, title: election.title, closesAt: election.closesAt });
    }
    return votes.sort((a, b) => a.closesAt.localeCompare(b.closesAt));
  }
}

/**
 * For the `discord` service, which holds no credentials and reads the site as any visitor does. The key is the one
 * Discord publishes on the application's own page; nothing here is secret.
 */
@Controller('v1/public/discord')
@Public()
export class PublicDiscordController {
  constructor(private readonly discord: DiscordPublic) {}

  @Get('app')
  @Header('Cache-Control', 'public, max-age=60')
  app() {
    return this.discord.app();
  }

  @Get('votes')
  @Header('Cache-Control', 'public, max-age=60')
  votes() {
    return this.discord.votes();
  }
}
