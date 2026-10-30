import type {
  RoomActionInput,
  RoomActionUpdate,
  RoomActionView,
  RoomDecisionInput,
  RoomDecisionView,
  RoomHistory,
  RoomMemory,
  RoomMessageView,
  RoomSetting,
  RoomSettingsView,
  RoomStatus,
  RoomUpdates,
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

/** Waits up to 25 seconds for a change after `since` (the api holds the request). */
export const updates = (since: number) => api<RoomUpdates>('GET', `/v1/room/updates?since=${since}&wait=1`);

export const postMessage = (body: string) => api<RoomMessageView>('POST', '/v1/room/messages', { body });
export const ask = (question: string) => api<RoomMessageView>('POST', '/v1/room/ask', { question });

/** The caller's own message, or as a Membership Admin anyone's. */
export function deleteMessage(messageId: string, asAdmin: boolean): Promise<RoomMessageView> {
  return api<RoomMessageView>('DELETE', `/v1/${asAdmin ? 'admin/' : ''}room/messages/${enc(messageId)}`);
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
