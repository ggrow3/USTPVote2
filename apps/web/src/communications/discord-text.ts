import { DISCORD_COMMANDS, type DiscordAdminView, type DiscordCommandsStatus, type DiscordPostRecord, type DiscordTestRecord, type DiscordTokenStatus } from 'ustp-domain';

/** The Discord bot's pages in words (design §10.18), apart from the pages so they can be tested. */

export const DISCORD_INTRO =
  "The app's own bot posts to the party's Discord server when something happens on the site: a news post is published, " +
  'voting opens or is about to close, results come out, an event is published or is a day away, the legislative team ' +
  'shows a bill, a course is published. Each post is a title, a line and a link back to the site.';

export const DISCORD_NEVER =
  'The bot never posts who voted or has not, any member’s name, or anything said in the forum, the members’ room or a ' +
  'private message. Rehearsal elections are left out.';

export const CHANNEL_HELP =
  'A channel ID is a long number. In Discord, open User Settings › Advanced and switch on Developer Mode; then ' +
  'right-click a channel and choose Copy Channel ID. Leave a kind empty to post nothing of it.';

const when = (iso: string, locale?: string) =>
  new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** What stands between the bot and its first post, most pressing first; empty when nothing does. */
export function discordBlockers(view: Pick<DiscordAdminView, 'mode' | 'tokenSet' | 'canLink' | 'settings'>): string[] {
  const blockers: string[] = [];
  if (view.mode === 'off') blockers.push('The bot is switched off in this deployment’s settings (DISCORD=off), so nothing is posted whatever is set here.');
  if (!view.canLink) blockers.push('The site’s own address is not set in this deployment (WEB_ORIGIN). Every post links to the site, so nothing is posted until it is.');
  if (view.tokenSet === false) blockers.push('The bot’s token has not been added. A System Admin adds it under Admin › API keys.');
  if (view.tokenSet === null) blockers.push('This server cannot yet tell whether the bot’s token is set: the deployment’s Terraform for Discord has not been applied.');
  if (!Object.values(view.settings.channels).some(Boolean)) blockers.push('No channel is chosen yet, so there is nowhere to post.');
  return blockers;
}

/** Where the bot stands, in a sentence. */
export function discordStateText(view: Pick<DiscordAdminView, 'mode' | 'tokenSet' | 'canLink' | 'settings' | 'botName'>): string {
  const who = view.botName ? `The bot (${view.botName})` : 'The bot';
  if (view.mode === 'stub') return `${who} is a stand-in here: posts are recorded for testing, and nothing goes to Discord.`;
  if (!view.settings.enabled) return `${who} is switched off: nothing is posted.`;
  return discordBlockers(view).length ? `${who} is switched on, but cannot post yet.` : `${who} is switched on and posts within a minute of each thing happening.`;
}

export const COMMANDS_INTRO =
  `People in the server can ask the bot with ${DISCORD_COMMANDS.map((c) => `/${c.name}`).join(', ')}. Each answer comes from what ` +
  'the site shows anyone, and only the person who asked sees it unless they press Post in channel. The commands work ' +
  'whether or not the switch above is on.';

/** Where the slash commands stand, in a sentence. */
export function commandsText(commands: DiscordCommandsStatus, tokenSet: boolean | null, locale?: string): string {
  if (!commands.endpoint) return 'This deployment has no commands service yet, so the bot has no commands.';
  if (!tokenSet) return 'Discord is told of the commands once the bot’s token is added.';
  if (commands.problem) return `Discord has not taken the commands yet: ${commands.problem}. The site tries again every two minutes.`;
  if (!commands.registered || !commands.triedAt) return 'Discord is being told of the commands; that takes a minute or two.';
  return `Discord was told of the commands on ${when(commands.triedAt, locale)}. A new command can take a few minutes to appear in Discord.`;
}

export function testText(test: DiscordTestRecord, locale?: string): string {
  if (test.status === 'waiting') return 'The test post is on its way: it goes within a minute.';
  if (test.status === 'sent') return `The test post was sent ${when(test.doneAt ?? test.requestedAt, locale)}. Look for it in the channel.`;
  return `The test post was not sent: ${test.problem ?? 'Discord refused it'}.`;
}

export function postStatusText(post: Pick<DiscordPostRecord, 'status' | 'sentAt' | 'createdAt' | 'problem'>, locale?: string): string {
  if (post.status === 'sent') return `Posted ${when(post.sentAt ?? post.createdAt, locale)}`;
  if (post.status === 'failed') return `Not posted: ${post.problem ?? 'Discord refused it'}`;
  return `Started ${when(post.createdAt, locale)} and not finished; it is not tried again`;
}

export const TOKEN_INTRO =
  'The app’s Discord bot posts news, votes, events, bills and courses to the party’s Discord server, in the channels ' +
  'Communications Admins choose under Admin › Communications › Discord. Its token is kept in Google Secret Manager, ' +
  'and once it is saved nobody can see it here, System Admins included: only its last four characters are shown.';

export const TOKEN_WHERE =
  'In Discord’s Developer Portal, open the party’s application, then Bot, then Reset Token. The client secret and the ' +
  'public key on other pages are not the token.';

export function tokenStatusText(status: DiscordTokenStatus, locale?: string): string {
  if (status.unavailable) return `${status.unavailable.charAt(0).toUpperCase()}${status.unavailable.slice(1)}.`;
  if (!status.set) return 'No token is set, so the bot cannot post.';
  const bot = status.botName ? ` for the bot ${status.botName}` : '';
  const added = status.addedAt ? ` on ${new Date(status.addedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  if (!status.addedBy) return `A token is set. It was added${added} outside this app, so who added it is not known here.`;
  return `A token is set${bot}. It ends in ${status.hint} and was added${added} by ${status.addedBy.name}.`;
}

export const tokenTriedText = (tried: boolean): string =>
  tried ? 'A token is tried with Discord before it is saved, and one Discord does not accept is not kept.' : 'Here a token is saved without being tried with Discord.';

export const TOKEN_REMOVE_CONFIRM =
  'The bot stops posting until a System Admin adds a token again. The token stays valid at Discord: to revoke it, reset ' +
  'it in Discord’s Developer Portal too.';

/** A server or domain reason as the sentence under the field. */
export function asSentence(reason: string): string {
  const text = reason.charAt(0).toUpperCase() + reason.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
