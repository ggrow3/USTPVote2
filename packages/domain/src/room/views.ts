import {
  ROOM_TERMS,
  ROOM_TERMS_HASH,
  inRoom,
  type RoomConsentRecord,
  type RoomFeedRecord,
  type RoomMemoryRecord,
  type RoomMessageKind,
  type RoomMessageRecord,
  type RoomRef,
  type RoomSource,
} from './room.js';

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
  readonly terms: { readonly version: number; readonly text: string; readonly hash: string };
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
  } | null;
}

export interface RoomAssistantView {
  readonly on: boolean;
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
    model,
    switchedAt: feed.switchedAt,
    switchedBy: feed.switchedBy ? person(ctx, feed.switchedBy) : null,
    pending: feed.pending,
  };
}

/** The door: the terms always; the room's state only for a member in it. */
export function roomStatus(
  member: boolean,
  consent: RoomConsentRecord | null,
  room: RoomStatus['room'],
): RoomStatus {
  const entered = member && inRoom(consent);
  return {
    member,
    terms: { version: ROOM_TERMS.version, text: ROOM_TERMS.text, hash: ROOM_TERMS_HASH },
    inRoom: entered,
    consent: consent ? { version: consent.termsVersion, acceptedAt: consent.acceptedAt, withdrawnAt: consent.withdrawnAt } : null,
    room: entered ? room : null,
  };
}
