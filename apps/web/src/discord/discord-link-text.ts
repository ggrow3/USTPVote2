import type { DiscordLinkView } from 'ustp-domain';

/** The Connect Discord card in words (design §10.18, "Linking"), apart from the card so they can be tested. */

export const LINK_INTRO =
  'Connect your Discord account to get the Member role on the party’s Discord server, and the channels that go with it.';

/** Said before the member starts: what linking gives away. */
export const LINK_TELLS =
  'Linking tells Discord, and everyone on the party’s server, that you are a party member: the Member role shows on your ' +
  'profile there. The site learns your Discord ID and name, and nothing else: not your email, your servers or your messages.';

export const CELEBRATE_LABEL = 'Celebrate my milestones on Discord';
export const CELEBRATE_HELP =
  'When you join or finish a course, the bot’s weekly post may name you. Left unticked, it never does. It never says ' +
  'anything about how or whether you voted.';

export const UNLINK_CONFIRM = 'The Member role is taken away on Discord within a few minutes. You can connect again whenever you like.';

/** Whether the card has anything to show: linking is set up here, or the account is linked already. */
export const showsDiscordCard = (view: DiscordLinkView): boolean => !!view.link || !view.blocker;

/** Where the Member role stands for a linked account, in a sentence. */
export function roleText(view: DiscordLinkView): string {
  const link = view.link;
  if (!link) return '';
  if (!view.rolesSet) return 'The party has not set a Member role on its server yet, so there is none to give.';
  if (!view.activeMember) return 'The Member role is for Active members. You get it once your membership is Active.';
  if (link.role === 'given') return 'You hold the Member role on the party’s server.';
  if (link.roleProblem === 'not_in_server') {
    return 'The bot could not find you on the party’s server. Join the server with this Discord account, and the role follows within the hour (within a few minutes if you join soon).';
  }
  if (link.roleProblem) return 'The bot could not give you the Member role: its permissions on the server need fixing. The Communications team can see this; the role follows once it is fixed.';
  return 'The Member role is on its way: the bot gives it within a few minutes.';
}

/** What to say when Discord sent the member back without a code. */
export function returnProblem(query: { readonly error?: string; readonly code?: string; readonly state?: string }, expectedState: string | null): string | null {
  if (query.error === 'access_denied') return 'You chose Cancel at Discord, so nothing was linked.';
  if (query.error) return 'Discord did not finish the sign-in, so nothing was linked. Start again from your Account page.';
  if (!query.code || !query.state) return 'This page finishes connecting Discord. Start from your Account page.';
  if (!expectedState || expectedState !== query.state) {
    return 'This sign-in was not started in this browser tab, so nothing was linked. Start again from your Account page.';
  }
  return null;
}
