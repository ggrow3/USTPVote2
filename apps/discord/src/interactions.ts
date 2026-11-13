import {
  DISCORD_CALLBACK,
  DISCORD_INTERACTION,
  discordCommandReply,
  discordInteractionNote,
  discordInteractionReply,
  discordSharedCommand,
  isDiscordCommand,
  type DiscordCommandName,
} from 'ustp-domain';
import type { Site } from './site.js';

/** What Discord sends: only the parts read here. Nothing about the person who ran the command is read. */
export interface Interaction {
  readonly type?: unknown;
  readonly data?: { readonly name?: unknown; readonly custom_id?: unknown };
}

/**
 * The answer to one request from Discord (design §10.18). Discord waits three seconds, so the site is given until
 * `deadline`; if it has not answered (its api starts cold after a quiet spell), the person is asked to try again, and
 * the read goes on so the next try is answered from what it brings.
 */
export async function answer(interaction: Interaction, site: Site, deadline: number, now: () => number = Date.now): Promise<unknown> {
  if (interaction.type === DISCORD_INTERACTION.ping) return { type: DISCORD_CALLBACK.pong };

  let command: DiscordCommandName | null = null;
  let shared = false;
  if (interaction.type === DISCORD_INTERACTION.command && isDiscordCommand(interaction.data?.name)) command = interaction.data.name;
  if (interaction.type === DISCORD_INTERACTION.component) {
    command = discordSharedCommand(interaction.data?.custom_id);
    shared = true;
  }
  if (!command) return discordInteractionNote('This bot does not know that command. Try `/help`.');

  const reading = site.command(command);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadline - now()));
  });
  try {
    const data = await Promise.race([reading, late]);
    if (!data) return discordInteractionNote('The site is waking up. Try again in a few seconds.');
    return discordInteractionReply(discordCommandReply(data, site.origin), shared ? { shared: true } : { shared: false, command });
  } catch {
    return discordInteractionNote('The site could not be read just now. Try again in a minute.');
  } finally {
    clearTimeout(timer);
  }
}
