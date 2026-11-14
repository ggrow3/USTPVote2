import { z } from 'zod';
import type { DiscordSettings } from './discord.js';

/**
 * Linking a Discord account to a site account (design §10.18, "Linking"). A member signs in to Discord from the
 * Account page; the site learns their Discord user ID and nothing else, and the bot then gives them the Member role on
 * the party's server while their membership is Active. Linking tells Discord, and so everyone on the server, that the
 * person is a party member: the card says so before they start.
 */

/** The page Discord sends the member back to. It must be listed under OAuth2 › Redirects in Discord's Developer Portal. */
export const DISCORD_LINK_PATH = '/account/discord';
export const discordRedirectUri = (origin: string): string => `${origin}${DISCORD_LINK_PATH}`;

/** How long a started sign-in may take. */
export const DISCORD_LINK_STATE_MINUTES = 10;

/**
 * Where the member is sent to sign in to Discord. `identify` is the smallest thing Discord gives: who they are there
 * (ID and name), not their email, servers or messages.
 */
export function discordAuthorizeUrl(applicationId: string, origin: string, state: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: applicationId,
    scope: 'identify',
    state,
    redirect_uri: discordRedirectUri(origin),
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

/** `discord_link_states/{sha256(state)}`: a sign-in a member started, good once and for ten minutes. */
export interface DiscordLinkStateRecord {
  readonly accountId: string;
  readonly expiresAt: string;
}

/** Whether the linked account holds the Member role, as far as the bot knows. */
export type DiscordRoleState = 'none' | 'given';

/**
 * `discord_links/{discordUserId}`: a Discord account and the site account it is linked to. One Discord account links
 * to one site account, and one site account to one Discord account. An unlinked record stays (with `unlinkedAt`, and
 * no account) only until the worker has taken the role away, which needs the Discord ID.
 */
export interface DiscordLinkRecord {
  /** Null once unlinked, or once the account was deleted. */
  readonly accountId: string | null;
  readonly discordUserId: string;
  /** Their name on Discord when they linked, to show them which account it is. */
  readonly discordName: string | null;
  /** "Celebrate my milestones on Discord": the weekly post may name them. Off unless they tick it. */
  readonly celebrate: boolean;
  readonly linkedAt: string;
  readonly role: DiscordRoleState;
  /** When the role was last given, so it is given again now and then (a person who left the server and came back has lost it). */
  readonly roleAt: string | null;
  /** Why the role could not be given or taken; null when nothing stands in the way. */
  readonly roleProblem: DiscordRoleProblem | null;
  /** When the worker next looks at this link. */
  readonly roleCheckAt: string;
  readonly unlinkedAt: string | null;
}

/** Why a role change did not happen: the person is not on the server, or the bot may not change the role. */
export type DiscordRoleProblem = 'not_in_server' | 'not_allowed' | 'no_such_role';

/** How often the worker looks again at a link with nothing to do, to notice a membership that lapsed or came back. */
export const DISCORD_ROLE_RECHECK_MINUTES = 60;
/** How soon it looks again while a new link waits for the person to join the server. */
export const DISCORD_ROLE_SOON_MINUTES = 2;
/** For how long after linking it looks that often. */
export const DISCORD_ROLE_SOON_FOR_MINUTES = 60;
/** How often a role already given is given again. */
export const DISCORD_ROLE_REGIVE_HOURS = 24;
/** An unlinked record whose role the bot cannot take away is deleted anyway after this long. */
export const DISCORD_UNLINK_KEEP_DAYS = 7;

/** Whether the bot can give roles at all: the server and the role are set. */
export const discordRolesSet = (settings: Pick<DiscordSettings, 'guildId' | 'memberRoleId'>): boolean => !!settings.guildId && !!settings.memberRoleId;

/** Whether this link's account should hold the Member role: linked, and an Active member. */
export function discordRoleWanted(link: Pick<DiscordLinkRecord, 'unlinkedAt'>, activeMember: boolean): boolean {
  return !link.unlinkedAt && activeMember;
}

/** What the worker does about a link's role now. */
export type DiscordRoleStep = 'give' | 'take' | 'forget' | 'nothing';

export function discordRoleStep(
  link: Pick<DiscordLinkRecord, 'unlinkedAt' | 'role' | 'roleAt'>,
  activeMember: boolean,
  rolesSet: boolean,
  now: Date,
): DiscordRoleStep {
  const wanted = discordRoleWanted(link, activeMember);
  if (!rolesSet) return link.unlinkedAt ? 'forget' : 'nothing';
  if (wanted) {
    if (link.role !== 'given') return 'give';
    const givenAt = link.roleAt ? Date.parse(link.roleAt) : 0;
    return now.getTime() - givenAt >= DISCORD_ROLE_REGIVE_HOURS * 3_600_000 ? 'give' : 'nothing';
  }
  if (link.role === 'given') return 'take';
  return link.unlinkedAt ? 'forget' : 'nothing';
}

/** When the worker looks at a link again after a step. */
export function discordRoleNextCheck(link: Pick<DiscordLinkRecord, 'linkedAt'>, problem: DiscordRoleProblem | null, now: Date): string {
  const fresh = now.getTime() - Date.parse(link.linkedAt) < DISCORD_ROLE_SOON_FOR_MINUTES * 60_000;
  const minutes = problem === 'not_in_server' && fresh ? DISCORD_ROLE_SOON_MINUTES : DISCORD_ROLE_RECHECK_MINUTES;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** `POST /v1/me/discord/link`: what Discord sent the member back with. */
export const discordLinkSchema = z.strictObject({
  code: z.string().trim().min(1).max(200),
  state: z.string().trim().min(16).max(200),
});
export type DiscordLinkInput = z.infer<typeof discordLinkSchema>;

/** `PUT /v1/me/discord`: the member's one choice about their link. */
export const discordCelebrateSchema = z.strictObject({ celebrate: z.boolean() });
export type DiscordCelebrateInput = z.infer<typeof discordCelebrateSchema>;

/** `POST /v1/me/discord/start`: where to send the member. */
export interface DiscordLinkStart {
  readonly url: string;
  readonly state: string;
}

/** Why linking cannot be started here; null when it can. */
export type DiscordLinkBlocker = 'off' | 'no_origin' | 'no_application' | 'no_secret';

/** `GET /v1/me/discord`: the member's link, as the Account page shows it. */
export interface DiscordLinkView {
  readonly blocker: DiscordLinkBlocker | null;
  /** Whether the bot gives a role at all (the server and the role are set). */
  readonly rolesSet: boolean;
  /** Whether this account is an Active member, who gets the role. */
  readonly activeMember: boolean;
  readonly link: {
    readonly discordName: string | null;
    readonly linkedAt: string;
    readonly celebrate: boolean;
    readonly role: DiscordRoleState;
    readonly roleProblem: DiscordRoleProblem | null;
  } | null;
}

export function discordLinkView(
  link: DiscordLinkRecord | null | undefined,
  facts: Pick<DiscordLinkView, 'blocker' | 'rolesSet' | 'activeMember'>,
): DiscordLinkView {
  return {
    ...facts,
    link:
      link && !link.unlinkedAt
        ? { discordName: link.discordName, linkedAt: link.linkedAt, celebrate: link.celebrate, role: link.role, roleProblem: link.roleProblem }
        : null,
  };
}

/** What the admins' page shows of linking: counts, never who. */
export interface DiscordLinksSummary {
  readonly linked: number;
  readonly withRole: number;
  /** Linked members the bot could not find on the server. */
  readonly notInServer: number;
  /** Links whose role the bot was not allowed to change, or whose role does not exist: the bot's own setup is wrong. */
  readonly refused: number;
  readonly celebrating: number;
}

/** A new link's record. */
export function newDiscordLink(accountId: string, user: { readonly id: string; readonly name: string | null }, now: Date): DiscordLinkRecord {
  return {
    accountId,
    discordUserId: user.id,
    discordName: user.name,
    celebrate: false,
    linkedAt: now.toISOString(),
    role: 'none',
    roleAt: null,
    roleProblem: null,
    roleCheckAt: now.toISOString(),
    unlinkedAt: null,
  };
}
