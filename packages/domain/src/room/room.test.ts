import { sha256Hex } from 'ustp-audit';
import { describe, expect, it } from 'vitest';
import { parseRoomInput } from './commands.js';
import {
  acceptTerms,
  changeDoor,
  changeRoomSetting,
  checkAsk,
  checkRoomOpen,
  checkForget,
  checkInRoom,
  checkMessageRate,
  checkRoomMember,
  citations,
  DEFAULT_DOOR,
  deleteMessage,
  EMPTY_FEED,
  erased,
  memoryMatches,
  newAction,
  newDecision,
  newMessage,
  ROOM_INTRO,
  ROOM_LIMITS,
  ROOM_TERMS,
  ROOM_TERMS_HASH,
  roomDoorSchema,
  searchWords,
  switchAssistant,
  tidyRoomIntro,
  tidyRoomTerms,
  updateAction,
  withdrawConsent,
  type RoomActionRecord,
  type RoomConsentRecord,
  type RoomDecisionRecord,
  type RoomDoorRecord,
} from './room.js';
import { memoryLists, messageView, roomStatus, type RoomViewContext } from './views.js';

const AT = '2026-10-29T12:00:00.000Z';
const ctx = (accountId: string, moderator = false): RoomViewContext => ({
  accountId,
  moderator,
  people: new Map([
    ['ada', 'Ada Brooks'],
    ['bo', 'Bo'],
  ]),
});
const message = (authorId = 'ada', body = 'Canvass the north side first') =>
  newMessage({ messageId: 'm1', kind: 'member', authorId, body, createdAt: AT }, 1);
const decision = (itemId: string, text: string, at: string): RoomDecisionRecord =>
  (newDecision({ text, messageId: null }, null, itemId, 'ada', 1, at) as { ok: true; value: RoomDecisionRecord }).value;
const action = (fields: Partial<RoomActionRecord> = {}): RoomActionRecord => ({
  ...(newAction({ task: 'Book the hall', ownerId: 'bo', due: '2026-11-05' }, true, 'a1', 'ada', 2, AT) as { ok: true; value: RoomActionRecord }).value,
  ...fields,
});

const TERMS = DEFAULT_DOOR.terms;

describe('the door', () => {
  it('is for Active members who accepted the current terms and have not left', () => {
    expect(checkRoomMember('active').ok).toBe(true);
    expect(checkRoomMember('applicant')).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(checkInRoom(null, TERMS.version)).toMatchObject({ ok: false, reason: 'accept the room’s terms to enter' });
    const accepted = acceptTerms(null, TERMS, { version: ROOM_TERMS.version }, 'ada', AT);
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        consent: { accountId: 'ada', termsVersion: ROOM_TERMS.version, termsHash: ROOM_TERMS_HASH, acceptedAt: AT, withdrawnAt: null },
        event: { type: 'room.consent_changed', actor: 'ada', subject: 'ada', payload: { change: 'accepted', termsVersion: ROOM_TERMS.version } },
      },
    });
    const consent = (accepted as { ok: true; value: { consent: RoomConsentRecord } }).value.consent;
    expect(checkInRoom(consent, TERMS.version).ok).toBe(true);
    expect(ROOM_TERMS_HASH).toBe(sha256Hex(ROOM_TERMS.text));
    expect(acceptTerms(consent, TERMS, { version: ROOM_TERMS.version }, 'ada', AT)).toMatchObject({ ok: false, refusal: 'conflict' });
  });

  it('refuses terms other than those in force, and sends back members who accepted older ones', () => {
    expect(acceptTerms(null, TERMS, { version: ROOM_TERMS.version + 1 }, 'ada', AT)).toMatchObject({ ok: false, reason: expect.stringContaining('read them again') });
    const old: RoomConsentRecord = { accountId: 'ada', termsVersion: 0, termsHash: 'x', acceptedAt: AT, withdrawnAt: null };
    expect(checkInRoom(old, TERMS.version)).toMatchObject({ ok: false, reason: expect.stringContaining('terms have changed') });
    expect(acceptTerms(old, TERMS, { version: ROOM_TERMS.version }, 'ada', AT).ok).toBe(true);
  });

  it('lets a member leave at once, ledgered, and come back by accepting again', () => {
    const consent: RoomConsentRecord = { accountId: 'ada', termsVersion: ROOM_TERMS.version, termsHash: ROOM_TERMS_HASH, acceptedAt: AT, withdrawnAt: null };
    const left = withdrawConsent(consent, '2026-10-30T00:00:00.000Z');
    expect(left).toMatchObject({ ok: true, value: { consent: { withdrawnAt: '2026-10-30T00:00:00.000Z' }, event: { payload: { change: 'withdrawn' } } } });
    const gone = (left as { ok: true; value: { consent: RoomConsentRecord } }).value.consent;
    expect(checkInRoom(gone, TERMS.version).ok).toBe(false);
    expect(withdrawConsent(gone, AT)).toMatchObject({ ok: false });
    expect(withdrawConsent(null, AT)).toMatchObject({ ok: false });
    expect(acceptTerms(gone, TERMS, { version: ROOM_TERMS.version }, 'ada', AT)).toMatchObject({ ok: true, value: { consent: { withdrawnAt: null } } });
  });

  it('shows the room’s state only to a member in it', () => {
    const consent: RoomConsentRecord = { accountId: 'ada', termsVersion: ROOM_TERMS.version, termsHash: ROOM_TERMS_HASH, acceptedAt: AT, withdrawnAt: null };
    const room = {
      seq: 3,
      memorySeq: 1,
      peopleSeq: 1,
      assistant: { on: true, server: true, model: 'stand-in' as const, switchedAt: null, switchedBy: null, pending: [] },
      moderator: false,
      people: [],
      voiceSeq: 0,
      voice: [],
    };
    expect(roomStatus(DEFAULT_DOOR, true, consent, room)).toMatchObject({ member: true, inRoom: true, room: { seq: 3 } });
    expect(roomStatus(DEFAULT_DOOR, false, consent, room)).toMatchObject({ member: false, inRoom: false, room: null });
    expect(roomStatus(DEFAULT_DOOR, true, { ...consent, withdrawnAt: AT }, room)).toMatchObject({ inRoom: false, room: null, consent: { withdrawnAt: AT } });
    const door = roomStatus(DEFAULT_DOOR, true, null, room);
    expect(door.terms).toEqual({ version: ROOM_TERMS.version, text: ROOM_TERMS.text, hash: ROOM_TERMS_HASH });
    expect(door.intro).toBe(ROOM_INTRO);
  });
});

describe('the door’s words', () => {
  const input = (fields: Partial<{ basedOn: number; intro: string; terms: string }> = {}) =>
    roomDoorSchema.parse({ basedOn: 0, intro: ROOM_INTRO, terms: ROOM_TERMS.text, ...fields });

  it('are tidied: the intro on one line, the terms with one blank line at most between paragraphs', () => {
    expect(tidyRoomIntro('  A room\n for  members ')).toBe('A room for members');
    expect(tidyRoomTerms('\r\nFirst line  \r\nstill first\r\n\r\n\r\n \r\nSecond\t\n\n')).toBe('First line\nstill first\n\nSecond');
    expect(input({ intro: '', terms: ' One.\n\n\n\nTwo. ' })).toMatchObject({ intro: '', terms: 'One.\n\nTwo.' });
    expect(roomDoorSchema.safeParse({ basedOn: 0, intro: '', terms: ' \n\n ' }).success).toBe(false);
    expect(roomDoorSchema.safeParse({ basedOn: 0, intro: 'x'.repeat(ROOM_LIMITS.intro + 1), terms: 'Terms' }).success).toBe(false);
    expect(roomDoorSchema.safeParse({ basedOn: 0, intro: '', terms: 'x'.repeat(ROOM_LIMITS.terms + 1) }).success).toBe(false);
  });

  it('make changed terms the next version, ledgered with their text and hash, so everyone accepts them again', () => {
    const saved = changeDoor(DEFAULT_DOOR, input({ terms: 'New terms.\n\nLeave with /leave-room.' }), 'ma', AT);
    const text = 'New terms.\n\nLeave with /leave-room.';
    expect(saved).toEqual({
      ok: true,
      value: {
        door: {
          ...DEFAULT_DOOR,
          revision: 1,
          terms: { version: 2, text, hash: sha256Hex(text) },
          termsChangedAt: AT,
          termsChangedBy: 'ma',
        },
        newTerms: true,
        event: { type: 'room.door_changed', actor: 'ma', subject: null, payload: { termsVersion: 2, termsHash: sha256Hex(text), changes: [{ part: 'terms', to: text }] } },
      },
    });
    const door = (saved as { ok: true; value: { door: RoomDoorRecord } }).value.door;
    const consent: RoomConsentRecord = { accountId: 'ada', termsVersion: 1, termsHash: ROOM_TERMS_HASH, acceptedAt: AT, withdrawnAt: null };
    expect(checkInRoom(consent, door.terms.version)).toMatchObject({ ok: false, reason: expect.stringContaining('terms have changed') });
    expect(acceptTerms(consent, door.terms, { version: 2 }, 'ada', AT)).toMatchObject({ ok: true, value: { consent: { termsVersion: 2, termsHash: sha256Hex(text) } } });
  });

  it('change the intro without a new version, and refuse an edit of an older revision', () => {
    const saved = changeDoor(DEFAULT_DOOR, input({ intro: 'Where the group plans.' }), 'ma', AT);
    expect(saved).toMatchObject({
      ok: true,
      value: {
        door: { revision: 1, intro: 'Where the group plans.', terms: { version: 1 }, introChangedBy: 'ma', termsChangedBy: null },
        newTerms: false,
        event: { payload: { termsVersion: 1, changes: [{ part: 'intro', to: 'Where the group plans.' }] } },
      },
    });
    const door = (saved as { ok: true; value: { door: RoomDoorRecord } }).value.door;
    expect(changeDoor(door, input({ intro: 'Mine' }), 'sa', AT)).toMatchObject({ ok: false, refusal: 'conflict', reason: expect.stringContaining('reload') });
    expect(changeDoor(door, input({ basedOn: 1, intro: 'Where the group plans.' }), 'sa', AT)).toEqual({ ok: true, value: null });
  });
});

describe('messages', () => {
  it('expire 90 days after they are posted', () => {
    expect(message().expireAt).toBe('2027-01-27T12:00:00.000Z');
  });

  it('are deleted by their author, or by a Membership Admin, which erases the text', () => {
    expect(deleteMessage(message(), 'ada', false, 5, AT)).toMatchObject({ ok: true, value: { body: '', deletedBy: 'ada', seq: 5 } });
    const citing = newMessage(
      { messageId: 'm3', kind: 'assistant', authorId: null, body: 'Plan v2 [1]', createdAt: AT, sources: [{ kind: 'message', id: 'm1', excerpt: 'Canvass', at: AT }] },
      3,
    );
    expect(citing.cites).toEqual(['m1']);
    expect(erased(citing, 'ada', 6, AT)).toMatchObject({ body: '', sources: [], cites: [], deletedAt: AT, seq: 6 });
    expect(deleteMessage(message(), 'bo', false, 5, AT)).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(deleteMessage(message(), 'bo', true, 5, AT)).toMatchObject({ ok: true, value: { deletedBy: 'bo' } });
    const answer = newMessage({ messageId: 'm2', kind: 'assistant', authorId: null, body: 'An answer', createdAt: AT }, 2);
    expect(deleteMessage(answer, 'ada', false, 5, AT)).toMatchObject({ ok: false, refusal: 'forbidden' });
    const gone = (deleteMessage(message(), 'ada', false, 5, AT) as { ok: true; value: ReturnType<typeof message> }).value;
    expect(deleteMessage(gone, 'ada', false, 6, AT)).toMatchObject({ ok: false, refusal: 'not_found' });
  });

  it('show the viewer what they may delete', () => {
    expect(messageView(message(), ctx('ada'))).toMatchObject({ mine: true, deletable: true, author: { name: 'Ada Brooks' } });
    expect(messageView(message(), ctx('bo'))).toMatchObject({ mine: false, deletable: false });
    expect(messageView(message(), ctx('bo', true))).toMatchObject({ deletable: true });
    expect(messageView(message('gone'), ctx('bo')).author).toEqual({ accountId: 'gone', name: 'Former member' });
  });

  it('are limited per minute and per day', () => {
    expect(checkMessageRate(0, 0).ok).toBe(true);
    expect(checkMessageRate(ROOM_LIMITS.messagesPerMinute, 0)).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkMessageRate(0, ROOM_LIMITS.messagesPerDay)).toMatchObject({ ok: false, refusal: 'rate_limited' });
  });
});

describe('memory', () => {
  it('logs a decision as the group’s, keeping what the message it came from said', () => {
    const d = newDecision({ text: 'Canvass north first', messageId: 'm1' }, message(), 'd1', 'bo', 3, AT);
    expect(d).toMatchObject({ ok: true, value: { kind: 'decision', text: 'Canvass north first', createdBy: 'bo', quote: 'Canvass the north side first', expireAt: null } });
    expect(newDecision({ text: 'x', messageId: 'm9' }, null, 'd1', 'bo', 3, AT)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(newDecision({ text: 'x', messageId: null }, null, 'd1', 'bo', 3, AT)).toMatchObject({ ok: true, value: { quote: null } });
    const long = message('ada', 'y'.repeat(ROOM_LIMITS.message));
    expect((newDecision({ text: 'x', messageId: 'm1' }, long, 'd1', 'bo', 3, AT) as { ok: true; value: { quote: string } }).value.quote).toHaveLength(ROOM_LIMITS.quote);
  });

  it('gives action items an owner in the room', () => {
    expect(action()).toMatchObject({ kind: 'action', ownerId: 'bo', status: 'open', due: '2026-11-05', expireAt: null });
    expect(newAction({ task: 'x', ownerId: 'cy', due: null }, false, 'a1', 'ada', 2, AT)).toMatchObject({ ok: false, reason: 'its owner must be someone in the room' });
  });

  it('lets the owner, whoever added it, or a Membership Admin change an action item; done ones expire 90 days on', () => {
    const update = { task: 'Book the hall', ownerId: 'bo', due: '2026-11-05', status: 'done' as const };
    const done = updateAction(action(), update, true, 'bo', false, 4, '2026-11-01T00:00:00.000Z');
    expect(done).toMatchObject({ ok: true, value: { status: 'done', doneAt: '2026-11-01T00:00:00.000Z', expireAt: '2027-01-30T00:00:00.000Z', seq: 4 } });
    expect(updateAction(action(), update, true, 'cy', false, 4, AT)).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(updateAction(action(), update, true, 'cy', true, 4, AT).ok).toBe(true);
    expect(updateAction(action(), { ...update, status: 'open' }, true, 'ada', false, 4, AT)).toEqual({ ok: true, value: null });
    const reopened = updateAction(action({ status: 'done', doneAt: AT, expireAt: 'x' }), { ...update, status: 'open' }, true, 'ada', false, 5, AT);
    expect(reopened).toMatchObject({ ok: true, value: { status: 'open', doneAt: null, expireAt: null } });
    expect(updateAction(action(), { ...update, ownerId: 'cy' }, false, 'ada', false, 4, AT)).toMatchObject({ ok: false, reason: 'its owner must be someone in the room' });
  });

  it('forgets an item for whoever added it or a Membership Admin', () => {
    expect(checkForget(action(), 'ada', false).ok).toBe(true);
    expect(checkForget(action(), 'bo', false)).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(checkForget(action(), 'bo', true).ok).toBe(true);
    expect(checkForget(null, 'ada', true)).toMatchObject({ ok: false, refusal: 'not_found' });
  });

  it('lists decisions newest first and open action items by due date, done ones last', () => {
    const items = [
      action({ itemId: 'a1', due: '2026-11-09' }),
      action({ itemId: 'a2', due: null }),
      action({ itemId: 'a3', due: '2026-11-02' }),
      action({ itemId: 'a4', status: 'done', doneAt: AT }),
      decision('d1', 'old', '2026-10-01T00:00:00.000Z'),
      decision('d2', 'new', AT),
    ];
    const lists = memoryLists(items, ctx('bo'));
    expect(lists.decisions.map((d) => d.itemId)).toEqual(['d2', 'd1']);
    expect(lists.actions.map((a) => a.itemId)).toEqual(['a3', 'a1', 'a2', 'a4']);
    expect(lists.actions[0]).toMatchObject({ owner: { name: 'Bo' }, editable: true, forgettable: false });
  });

  it('searches on every word of the query', () => {
    expect(searchWords('What did we decide about the Canvassing plan?')).toEqual(['decide', 'canvassing', 'plan']);
    const item = action({ text: 'Print canvassing flyers' });
    expect(memoryMatches(item, searchWords('canvassing flyers'))).toBe(true);
    expect(memoryMatches(item, searchWords('canvassing posters'))).toBe(false);
    expect(memoryMatches(item, searchWords('2026-11'))).toBe(true);
    expect(memoryMatches({ text: 'Adopted plan v2', quote: 'north side first' }, searchWords('north plan'))).toBe(true);
  });
});

describe('the assistant', () => {
  it('is switched off and on by a Membership Admin, cancelling what it had waiting', () => {
    const feed = { ...EMPTY_FEED, seq: 7, pending: ['q1', 'q2'] };
    const off = switchAssistant(feed, false, 'ma', AT);
    expect(off).toMatchObject({ ok: true, value: { feed: { assistantOn: false, pending: [], switchedBy: 'ma' }, cancelled: ['q1', 'q2'], event: { type: 'room.assistant_switched', payload: { on: false } } } });
    expect(switchAssistant(feed, true, 'ma', AT)).toMatchObject({ ok: false, reason: 'the assistant is already on' });
    expect(checkAsk({ ...feed, assistantOn: false }, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('switched the assistant off') });
  });

  it('takes a limited number of questions', () => {
    expect(checkAsk(EMPTY_FEED, 0).ok).toBe(true);
    expect(checkAsk(EMPTY_FEED, ROOM_LIMITS.questionsPerDay)).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkAsk({ ...EMPTY_FEED, pending: Array.from({ length: ROOM_LIMITS.pending }, (_, i) => `q${i}`) }, 0)).toMatchObject({ ok: false, refusal: 'rate_limited' });
  });

  it('keeps only citations of sources it was given, each once', () => {
    // Renumbered in the order first cited, as the answer lists its sources.
    expect(citations('We chose plan v2 [2], twice [2] and north first [1].', 3)).toEqual({ text: 'We chose plan v2 [1], twice [1] and north first [2].', cited: [2, 1] });
    expect(citations('Made up [27]. Real [17] [0].', 20)).toEqual({ text: 'Made up. Real [1].', cited: [17] });
    expect(citations('Made up [7]. Real [1] [0].', 2)).toEqual({ text: 'Made up. Real [1].', cited: [1] });
    expect(citations('Nothing cited.', 0)).toEqual({ text: 'Nothing cited.', cited: [] });
  });
});

describe('the composer', () => {
  it('reads commands at the start, and everything else as a message', () => {
    expect(parseRoomInput('/ask What did we decide?')).toEqual({ kind: 'command', command: 'ask', args: 'What did we decide?' });
    expect(parseRoomInput('  /TODO  Book the hall ')).toEqual({ kind: 'command', command: 'todo', args: 'Book the hall' });
    expect(parseRoomInput('/memory')).toEqual({ kind: 'command', command: 'memory', args: '' });
    expect(parseRoomInput('/leave-room')).toEqual({ kind: 'command', command: 'leave-room', args: '' });
    expect(parseRoomInput('/shrug')).toEqual({ kind: 'unknown', command: 'shrug' });
    expect(parseRoomInput('see /ask later')).toEqual({ kind: 'message', text: 'see /ask later' });
    expect(parseRoomInput('//ask is a command')).toEqual({ kind: 'message', text: '/ask is a command' });
    expect(parseRoomInput('/ask\nmulti\nline')).toEqual({ kind: 'command', command: 'ask', args: 'multi\nline' });
  });
});

describe('the admins’ switches', () => {
  it('open and close the room, refusing everyone while it is closed', () => {
    const closed = changeRoomSetting(EMPTY_FEED, 'open', false, 'ma', AT);
    expect(closed).toMatchObject({
      ok: true,
      value: { feed: { open: false, openChangedBy: 'ma', openChangedAt: AT }, cancelled: [], event: { type: 'room.settings_changed', payload: { setting: 'open', on: false } } },
    });
    const feed = { ...(closed as { ok: true; value: { feed: Omit<typeof EMPTY_FEED, 'seq'> } }).value.feed, seq: 1 };
    expect(checkRoomOpen(feed)).toMatchObject({ ok: false, refusal: 'forbidden', reason: expect.stringContaining('closed') });
    expect(checkRoomOpen(EMPTY_FEED).ok).toBe(true);
    expect(changeRoomSetting(feed, 'open', false, 'ma', AT)).toMatchObject({ ok: false, reason: 'the room is already closed' });
  });

  it('switch the model server off, cancelling what waits and refusing questions until it is on', () => {
    const feed = { ...EMPTY_FEED, pending: ['q1'] };
    const off = changeRoomSetting(feed, 'server', false, 'sa', AT);
    expect(off).toMatchObject({ ok: true, value: { feed: { serverOn: false, serverChangedBy: 'sa', pending: [] }, cancelled: ['q1'] } });
    const offFeed = { ...(off as { ok: true; value: { feed: Omit<typeof EMPTY_FEED, 'seq'> } }).value.feed, seq: 1 };
    expect(checkAsk(offFeed, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('model server off') });
    expect(changeRoomSetting(offFeed, 'server', true, 'sa', AT)).toMatchObject({ ok: true, value: { feed: { serverOn: true }, cancelled: [] } });
    expect(changeRoomSetting(EMPTY_FEED, 'server', true, 'sa', AT)).toMatchObject({ ok: false, reason: 'the model server is already on' });
  });

  it('show a closed room’s door with who closed it, and nothing of the room', () => {
    const consent: RoomConsentRecord = { accountId: 'ada', termsVersion: ROOM_TERMS.version, termsHash: ROOM_TERMS_HASH, acceptedAt: AT, withdrawnAt: null };
    const room = { seq: 3, memorySeq: 1, peopleSeq: 1, assistant: { on: true, server: true, model: 'stand-in' as const, switchedAt: null, switchedBy: null, pending: [] }, moderator: false, people: [], voiceSeq: 0, voice: [] };
    expect(roomStatus(DEFAULT_DOOR, true, consent, room, { at: AT, by: { accountId: 'ma', name: 'Morgan' } })).toMatchObject({
      open: false,
      inRoom: false,
      room: null,
      closed: { by: { name: 'Morgan' } },
    });
  });
});
