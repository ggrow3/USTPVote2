import type {
  RoomActionInput,
  RoomActionUpdate,
  RoomActionView,
  RoomDecisionInput,
  RoomDecisionView,
  RoomHistory,
  RoomMemory,
  RoomMessageView,
  RoomReaction,
  RoomSetting,
  RoomSettingsView,
  RoomSignalsInput,
  RoomStatus,
  RoomUpdates,
  RoomVoiceJoined,
  VoteValue,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The members' room's API (design §5.10, §12): the only place its routes are written. Members use `/v1/room`; a
 * Membership Admin in the room uses `/v1/admin/room` for what only they may do (others' messages and memory, the
 * assistant's switch), with their second factor.
 */

const enc = encodeURIComponent;

export const roomStatus = () => api<RoomStatus>('GET', '/v1/room');
export const acceptTerms = (version: number) => api<RoomStatus>('POST', '/v1/room/consent', { version });
export const leaveRoom = () => api<RoomStatus>('DELETE', '/v1/room/consent');

export function history(before?: string | null): Promise<RoomHistory> {
  return api<RoomHistory>('GET', `/v1/room/messages${before ? `?before=${enc(before)}` : ''}`);
}

/**
 * Waits up to 25 seconds for a change after `since` (the api holds the request). A page in the call names its session,
 * and gets the handshakes sent to it.
 */
export function updates(since: number, voice: string | null = null, wait = true): Promise<RoomUpdates> {
  return api<RoomUpdates>('GET', `/v1/room/updates?since=${since}&wait=${wait ? 1 : 0}${voice ? `&voice=${enc(voice)}` : ''}`);
}

export const postMessage = (body: string) => api<RoomMessageView>('POST', '/v1/room/messages', { body });
export const ask = (question: string) => api<RoomMessageView>('POST', '/v1/room/ask', { question });
export const joke = () => api<RoomMessageView>('POST', '/v1/room/joke');

/** The call (peer to peer): the api says who is in it and passes handshakes; the sound goes between browsers. */
export const joinVoice = (muted: boolean) => api<RoomVoiceJoined>('POST', '/v1/room/voice', { muted });
export const updateVoice = (sessionId: string, muted: boolean) => api<void>('PUT', '/v1/room/voice', { sessionId, muted });
export function leaveVoice(sessionId: string, keepalive = false): Promise<void> {
  return api<void>('DELETE', `/v1/room/voice?sessionId=${enc(sessionId)}`, undefined, { keepalive });
}
export const sendSignals = (sessionId: string, signals: RoomSignalsInput['signals']) => api<void>('POST', '/v1/room/voice/signals', { sessionId, signals });

/** The caller's own message, or as a Membership Admin anyone's. */
export function deleteMessage(messageId: string, asAdmin: boolean): Promise<RoomMessageView> {
  return api<RoomMessageView>('DELETE', `/v1/${asAdmin ? 'admin/' : ''}room/messages/${enc(messageId)}`);
}

/** The caller's vote on a message (0 takes it back), and their reaction added or taken back; the message comes back. */
export const voteOn = (messageId: string, value: VoteValue) => api<RoomMessageView>('PUT', `/v1/room/messages/${enc(messageId)}/vote`, { value });
export function reactTo(messageId: string, reaction: RoomReaction, on: boolean): Promise<RoomMessageView> {
  return api<RoomMessageView>('PUT', `/v1/room/messages/${enc(messageId)}/reactions`, { reaction, on });
}

export const decide = (input: RoomDecisionInput) => api<RoomDecisionView>('POST', '/v1/room/decisions', input);
export const addAction = (input: RoomActionInput) => api<RoomActionView>('POST', '/v1/room/actions', input);

export function updateAction(itemId: string, input: RoomActionUpdate, asAdmin: boolean): Promise<RoomActionView> {
  return api<RoomActionView>('PUT', `/v1/${asAdmin ? 'admin/' : ''}room/actions/${enc(itemId)}`, input);
}

/** Everything in memory; the page searches it, so a search never leaves the browser. */
export const memory = () => api<RoomMemory>('GET', '/v1/room/memory');

export function forget(itemId: string, asAdmin: boolean): Promise<void> {
  return api<void>('DELETE', `/v1/${asAdmin ? 'admin/' : ''}room/memory/${enc(itemId)}`);
}

export const switchAssistant = (on: boolean) => api<RoomStatus>('PUT', '/v1/admin/room/assistant', { on });

/** Admin › Members' room: the room open or closed, its model server on or off. */
export const roomSettings = () => api<RoomSettingsView>('GET', '/v1/admin/room/settings');
export const setRoomSetting = (setting: RoomSetting, on: boolean) => api<RoomSettingsView>('PUT', `/v1/admin/room/settings/${setting}`, { on });
