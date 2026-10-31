import {
  inRoom,
  type RoomConsentRecord,
  type RoomDoorRecord,
  type RoomFeedRecord,
  type RoomMemoryRecord,
  type RoomMessageKind,
  type RoomMessageRecord,
  type RoomRef,
  type RoomSource,
  type RoomTerms,
} from './room.js';
import { voiceLive, type RoomSignalKind, type RoomSignalRecord, type RoomVoiceRecord } from './voice.js';

/**
 * What the API shows of the room (design §5.10, §12). Only members in the room see any of it; everyone in it sees the
 * same messages and memory, by name (preferred, else legal), and what they themselves may change.
 */

/** Someone in the room. */
export interface RoomPerson {
  readonly accountId: string;
  readonly name: string;
}

/** How the room's model is run: self-hosted, the emulator-only stand-in, or not at all (`/ask` is refused). */
export type RoomModelKind = 'self-hosted' | 'stand-in' | 'off';

/** `GET /v1/room`: the door. What a member sees before entering, and the room's state once in. */
export interface RoomStatus {
  /** An Active member: may read the terms and enter. */
  readonly member: boolean;
  /** An admin has the room open; closed, nobody enters or uses it (`closed` says who and when). */
  readonly open: boolean;
  readonly closed: { readonly at: string | null; readonly by: RoomPerson | null } | null;
  /** The line under the door's heading, as an admin set it; empty shows none. */
  readonly intro: string;
  readonly terms: RoomTerms;
  /** Accepted the current terms and not left since. */
  readonly inRoom: boolean;
  /** Their last acceptance, of whichever version, and whether they left after it. */
  readonly consent: { readonly version: number; readonly acceptedAt: string; readonly withdrawnAt: string | null } | null;
  /** The rest is for members in the room only (null otherwise). */
  readonly room: {
    readonly seq: number;
    readonly memorySeq: number;
    readonly peopleSeq: number;
    readonly assistant: RoomAssistantView;
    /** Holds Membership Admin: switches the assistant, deletes any message or memory item. */
    readonly moderator: boolean;
    readonly people: readonly RoomPerson[];
    readonly voiceSeq: number;
    /** Who is in the call, in the order they joined. */
    readonly voice: readonly RoomVoiceView[];
  } | null;
}

/** Someone in the call, from one page. */
export interface RoomVoiceView extends RoomPerson {
  readonly sessionId: string;
  readonly joinedAt: string;
  readonly muted: boolean;
  readonly mine: boolean;
}

/** Half of a handshake sent to the viewer's page in the call. */
export interface RoomSignalView {
  readonly signalId: string;
  readonly from: string;
  readonly fromSession: string;
  readonly kind: RoomSignalKind;
  readonly sdp: string;
}

/** A STUN (or TURN) server browsers use to find a way to each other. */
export interface RoomIceServer {
  readonly urls: readonly string[];
}

/** `POST /v1/room/voice`: the page is in the call; it calls everyone already there. */
export interface RoomVoiceJoined {
  readonly sessionId: string;
  /** The feed number of joining: a list of who is in the call from before it is out of date. */
  readonly voiceSeq: number;
  readonly voice: readonly RoomVoiceView[];
  readonly iceServers: readonly RoomIceServer[];
}

export interface RoomAssistantView {
  readonly on: boolean;
  /** The model server's switch (a System Admin's): off, nothing goes to the model. */
  readonly server: boolean;
  readonly model: RoomModelKind;
  readonly switchedAt: string | null;
  readonly switchedBy: RoomPerson | null;
  /** Questions it is working on (their message IDs), oldest first. */
  readonly pending: readonly string[];
}

export interface RoomMessageView {
  readonly messageId: string;
  readonly kind: RoomMessageKind;
  /** Null for the assistant. */
  readonly author: RoomPerson | null;
  /** Empty once deleted. */
  readonly body: string;
  readonly createdAt: string;
  readonly ask: boolean;
  /** The assistant's joke; `author` is who asked for it. */
  readonly joke: boolean;
  readonly replyTo: string | null;
  readonly sources: readonly RoomSource[];
  readonly ref: RoomRef | null;
  readonly deleted: boolean;
  readonly mine: boolean;
  /** The viewer may delete it: their own, or any for a Membership Admin. */
  readonly deletable: boolean;
}

/** `GET /v1/room/messages`: a page of history, oldest first, and the feed number to ask for updates after. */
export interface RoomHistory {
  readonly messages: readonly RoomMessageView[];
  /** The message before this page, if there are older ones. */
  readonly before: string | null;
  readonly seq: number;
}

/**
 * `GET /v1/room/updates`: messages made or deleted after `since`, in the order they changed, and the room's state now.
 * `reset` when the page is too far behind: it reloads the history instead.
 */
export interface RoomUpdates {
  readonly seq: number;
  readonly memorySeq: number;
  /** Changes when someone enters or leaves: the page reloads the room's status for who is in it. */
  readonly peopleSeq: number;
  readonly messages: readonly RoomMessageView[];
  readonly assistant: RoomAssistantView;
  readonly voiceSeq: number;
  /** Who is in the call, when that changed after `since`; null when it did not. */
  readonly voice: readonly RoomVoiceView[] | null;
  /** Handshakes sent to the page's session in the call (`voice=`) after `since`, in order. */
  readonly signals: readonly RoomSignalView[];
  readonly reset: boolean;
}

export interface RoomDecisionView {
  readonly kind: 'decision';
  readonly itemId: string;
  readonly text: string;
  readonly messageId: string | null;
  readonly quote: string | null;
  readonly createdBy: RoomPerson;
  readonly createdAt: string;
  readonly forgettable: boolean;
}

export interface RoomActionView {
  readonly kind: 'action';
  readonly itemId: string;
  readonly text: string;
  readonly owner: RoomPerson;
  readonly due: string | null;
  readonly status: 'open' | 'done';
  readonly doneAt: string | null;
  /** When it will be deleted, once done. */
  readonly expireAt: string | null;
  readonly createdBy: RoomPerson;
  readonly createdAt: string;
  readonly editable: boolean;
  readonly forgettable: boolean;
}

export type RoomMemoryView = RoomDecisionView | RoomActionView;

/**
 * `GET /v1/room/memory`: decisions newest first, open action items by due date, then done ones. The page searches them
 * itself, so what a member looks for never leaves their browser.
 */
export interface RoomMemory {
  readonly decisions: readonly RoomDecisionView[];
  readonly actions: readonly RoomActionView[];
  readonly memorySeq: number;
}

/** `GET /v1/admin/room/settings`: the admins' switches, who changed each last, and how the room is doing. */
export interface RoomSettingsView {
  readonly open: boolean;
  readonly openChangedAt: string | null;
  readonly openChangedBy: RoomPerson | null;
  readonly server: {
    readonly on: boolean;
    readonly changedAt: string | null;
    readonly changedBy: RoomPerson | null;
    /** How this deployment runs the model; `off` until Terraform creates the server (room_model_enabled). */
    readonly model: RoomModelKind;
  };
  /** The Membership Admins' kill switch in the room itself. */
  readonly assistantOn: boolean;
  /** Members in the room now, and questions waiting for the assistant. */
  readonly people: number;
  readonly pending: number;
  /** This admin may switch the server: System Admins only, since it decides what the GPU costs. */
  readonly canSwitchServer: boolean;
  /** What the door shows, who changed each part last, and the revision to edit from. */
  readonly door: {
    readonly revision: number;
    readonly intro: string;
    readonly terms: RoomTerms;
    readonly introChangedAt: string | null;
    readonly introChangedBy: RoomPerson | null;
    readonly termsChangedAt: string | null;
    readonly termsChangedBy: RoomPerson | null;
  };
}

export function roomSettingsView(
  feed: RoomFeedRecord,
  door: RoomDoorRecord,
  model: RoomModelKind,
  people: number,
  canSwitchServer: boolean,
  ctx: RoomViewContext,
): RoomSettingsView {
  return {
    open: feed.open,
    openChangedAt: feed.openChangedAt,
    openChangedBy: feed.openChangedBy ? person(ctx, feed.openChangedBy) : null,
    server: {
      on: feed.serverOn,
      changedAt: feed.serverChangedAt,
      changedBy: feed.serverChangedBy ? person(ctx, feed.serverChangedBy) : null,
      model,
    },
    assistantOn: feed.assistantOn,
    people,
    pending: feed.pending.length,
    canSwitchServer,
    door: {
      revision: door.revision,
      intro: door.intro,
      terms: door.terms,
      introChangedAt: door.introChangedAt,
      introChangedBy: door.introChangedBy ? person(ctx, door.introChangedBy) : null,
      termsChangedAt: door.termsChangedAt,
      termsChangedBy: door.termsChangedBy ? person(ctx, door.termsChangedBy) : null,
    },
  };
}

/** Who is looking, and the names of everyone mentioned. */
export interface RoomViewContext {
  readonly accountId: string;
  readonly moderator: boolean;
  readonly people: ReadonlyMap<string, string>;
}

const person = (ctx: RoomViewContext, accountId: string): RoomPerson => ({ accountId, name: ctx.people.get(accountId) ?? 'Former member' });

export function messageView(m: RoomMessageRecord, ctx: RoomViewContext): RoomMessageView {
  const deleted = m.deletedAt !== null;
  const mine = m.kind === 'member' && m.authorId === ctx.accountId;
  return {
    messageId: m.messageId,
    kind: m.kind,
    author: m.authorId ? person(ctx, m.authorId) : null,
    body: m.body,
    createdAt: m.createdAt,
    ask: m.ask,
    joke: m.joke === true,
    replyTo: m.replyTo,
    sources: m.sources,
    ref: m.ref,
    deleted,
    mine,
    deletable: !deleted && (mine || ctx.moderator),
  };
}

export function memoryView(item: RoomMemoryRecord, ctx: RoomViewContext): RoomMemoryView {
  const forgettable = ctx.moderator || item.createdBy === ctx.accountId;
  if (item.kind === 'decision') {
    return {
      kind: 'decision',
      itemId: item.itemId,
      text: item.text,
      messageId: item.messageId,
      quote: item.quote,
      createdBy: person(ctx, item.createdBy),
      createdAt: item.createdAt,
      forgettable,
    };
  }
  return {
    kind: 'action',
    itemId: item.itemId,
    text: item.text,
    owner: person(ctx, item.ownerId),
    due: item.due,
    status: item.status,
    doneAt: item.doneAt,
    expireAt: item.expireAt,
    createdBy: person(ctx, item.createdBy),
    createdAt: item.createdAt,
    editable: forgettable || item.ownerId === ctx.accountId,
    forgettable,
  };
}

/** Decisions newest first; open action items by due date (none last), then done ones, latest done first. */
export function memoryLists(items: readonly RoomMemoryRecord[], ctx: RoomViewContext): Pick<RoomMemory, 'decisions' | 'actions'> {
  const decisions = items.filter((i) => i.kind === 'decision').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const actions = items
    .filter((i) => i.kind === 'action')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.status === 'done') return (b.doneAt ?? '').localeCompare(a.doneAt ?? '');
      return (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt.localeCompare(b.createdAt);
    });
  return {
    decisions: decisions.map((d) => memoryView(d, ctx) as RoomDecisionView),
    actions: actions.map((a) => memoryView(a, ctx) as RoomActionView),
  };
}

export function assistantView(feed: RoomFeedRecord, model: RoomModelKind, ctx: RoomViewContext): RoomAssistantView {
  return {
    on: feed.assistantOn,
    server: feed.serverOn,
    model,
    switchedAt: feed.switchedAt,
    switchedBy: feed.switchedBy ? person(ctx, feed.switchedBy) : null,
    pending: feed.pending,
  };
}

/** Who is in the call now (live pages only), in the order they joined. */
export function voiceView(records: readonly RoomVoiceRecord[], now: string, ctx: RoomViewContext): RoomVoiceView[] {
  return records
    .filter((v) => voiceLive(v, now))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.accountId.localeCompare(b.accountId))
    .map((v) => ({ ...person(ctx, v.accountId), sessionId: v.sessionId, joinedAt: v.joinedAt, muted: v.muted, mine: v.accountId === ctx.accountId }));
}

export const signalView = (s: RoomSignalRecord): RoomSignalView => ({ signalId: s.signalId, from: s.from, fromSession: s.fromSession, kind: s.kind, sdp: s.sdp });

/** The door: its intro and terms always; the room's state only for a member in it, while it is open. */
export function roomStatus(
  door: RoomDoorRecord,
  member: boolean,
  consent: RoomConsentRecord | null,
  room: RoomStatus['room'],
  closed: RoomStatus['closed'] = null,
): RoomStatus {
  const entered = member && inRoom(consent, door.terms.version) && !closed;
  return {
    member,
    open: !closed,
    closed,
    intro: door.intro,
    terms: door.terms,
    inRoom: entered,
    consent: consent ? { version: consent.termsVersion, acceptedAt: consent.acceptedAt, withdrawnAt: consent.withdrawnAt } : null,
    room: entered ? room : null,
  };
}
