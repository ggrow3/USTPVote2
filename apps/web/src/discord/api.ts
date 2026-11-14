import type { DiscordLinkStart, DiscordLinkView } from 'ustp-domain';
import { api } from '../api.js';

/** A member's own Discord link (design §10.18, "Linking"): the only place its routes are written. */
const MINE = '/v1/me/discord';

export const myDiscord = () => api<DiscordLinkView>('GET', MINE);
/** Where to send the member to sign in to Discord, and the word that ties their return to this account. */
export const startDiscordLink = () => api<DiscordLinkStart>('POST', `${MINE}/start`);
/** Finishes the link with what Discord sent the member back with. */
export const finishDiscordLink = (code: string, state: string) => api<DiscordLinkView>('POST', `${MINE}/link`, { code, state });
export const setDiscordCelebrate = (celebrate: boolean) => api<DiscordLinkView>('PUT', MINE, { celebrate });
export const unlinkDiscord = () => api<DiscordLinkView>('DELETE', MINE);

/** Where the word of a started sign-in is kept in this tab, to check the return against. */
export const DISCORD_STATE_KEY = 'ustp.discord-link-state';
