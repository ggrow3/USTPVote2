import {
  DAILY_JOKES,
  ROOM_INTRO,
  ROOM_TERMS,
  ROOM_TERMS_HASH,
  type LedgerEntry,
  type RoomHistory,
  type RoomMemory,
  type RoomMessageView,
  type RoomSettingsView,
  type RoomStatus,
  type RoomUpdates,
  type RoomVoiceJoined,
} from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  api = await TestApi.start();
  worker = await TestWorker.start();
});
afterAll(async () => {
  await worker.close();
  await api.close();
});

type Member = User & { accountId: string };
let sa1: Member;
let ma: Member;
let ada: Member;
let bo: Member;
let cy: Member;

async function memberRecord(user: Member, legalName: string, status = 'active', preferredName: string | null = null) {
  await api.firebase.db
    .collection('members')
    .doc(user.accountId)
    .set({ accountId: user.accountId, status, legalName, preferredName, state: 'TX' });
}

const status = async (by: User) => (await api.call('GET', '/v1/room', by)).body as RoomStatus;
const enter = async (by: User) => {
  const res = await api.call('POST', '/v1/room/consent', by, { version: ROOM_TERMS.version });
  expect(res.status).toBe(200);
  return res.body as RoomStatus;
};
const say = async (by: User, body: string) => {
  const res = await api.call('POST', '/v1/room/messages', by, { body });
  expect(res.status).toBe(201);
  return res.body as RoomMessageView;
};
const updates = async (by: User, since: number, wait = false) =>
  (await api.call('GET', `/v1/room/updates?since=${since}&wait=${wait ? 1 : 0}`, by)).body as RoomUpdates;
const memory = async (by: User) => (await api.call('GET', '/v1/room/memory', by)).body as RoomMemory;

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

/** Waits for the assistant (answering in the api with the emulators) to reply to `questionId`. */
async function answerTo(by: User, questionId: string): Promise<RoomMessageView> {
  for (let i = 0; i < 100; i++) {
    const { messages } = await updates(by, 0);
    const answer = messages.find((m) => m.kind === 'assistant' && m.replyTo === questionId);
    if (answer) return answer;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no answer');
}

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  ada = await api.member('ada@example.test');
  bo = await api.member('bo@example.test');
  cy = await api.member('cy@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await memberRecord(ma, 'Morgan Admin');
  await memberRecord(ada, 'Ada Brooks');
  await memberRecord(bo, 'Robert Lee', 'active', 'Bo');
  await memberRecord(cy, 'Cy Park', 'applicant');
});

describe('the door', () => {
  it('shows the terms and nothing of the room until an Active member accepts them, ledgered', async () => {
    expect(await status(ada)).toMatchObject({ member: true, inRoom: false, consent: null, room: null, terms: { version: ROOM_TERMS.version } });
    expect((await api.call('GET', '/v1/room/messages', ada)).status).toBe(403);
    expect((await api.call('POST', '/v1/room/messages', ada, { body: 'hi' })).status).toBe(403);

    const entered = await enter(ada);
    // Entering is a change to the room too: open pages reload who is in it.
    expect(entered).toMatchObject({ inRoom: true, room: { seq: 1, peopleSeq: 1, moderator: false, people: [{ name: 'Ada Brooks' }], assistant: { on: true, model: 'stand-in' } } });
    const [entry] = await entries('room.consent_changed');
    expect(entry).toMatchObject({ actor: ada.accountId, subject: ada.accountId, payload: { change: 'accepted', termsVersion: ROOM_TERMS.version } });
    expect((await api.call('POST', '/v1/room/consent', ada, { version: ROOM_TERMS.version })).status).toBe(409);
    expect((await api.call('POST', '/v1/room/consent', bo, { version: ROOM_TERMS.version + 1 })).status).toBe(409);
  });

  it('keeps out anyone not Active, even after accepting', async () => {
    expect(await status(cy)).toMatchObject({ member: false, inRoom: false });
    expect((await api.call('POST', '/v1/room/consent', cy, { version: ROOM_TERMS.version })).status).toBe(403);
    await enter(bo);
    await memberRecord(bo, 'Robert Lee', 'suspended', 'Bo');
    expect(await status(bo)).toMatchObject({ member: false, inRoom: false, room: null });
    expect((await api.call('GET', '/v1/room/messages', bo)).status).toBe(403);
  });

  it('lets a member leave at once with /leave-room, ledgered, and come back', async () => {
    await enter(ada);
    const left = await api.call('DELETE', '/v1/room/consent', ada);
    expect(left.body).toMatchObject({ inRoom: false, room: null, consent: { withdrawnAt: expect.any(String) } });
    expect((await api.call('GET', '/v1/room/updates?since=0&wait=0', ada)).status).toBe(403);
    expect((await entries('room.consent_changed')).map((e) => e.payload.change)).toEqual(['accepted', 'withdrawn']);
    expect((await api.call('DELETE', '/v1/room/consent', ada)).status).toBe(409);
    expect((await enter(ada)).inRoom).toBe(true);
  });
});

describe('the chat', () => {
  beforeEach(async () => {
    await enter(ada);
    await enter(bo);
  });

  it('posts messages everyone in the room sees, in history and as updates', async () => {
    const start = (await status(bo)).room!.seq;
    const first = await say(ada, 'Canvass the north side first');
    expect(first).toMatchObject({ kind: 'member', author: { name: 'Ada Brooks' }, mine: true, deletable: true });
    await say(bo, 'Agreed');
    const history = (await api.call('GET', '/v1/room/messages', bo)).body as RoomHistory;
    expect(history.messages.map((m) => m.body)).toEqual(['Canvass the north side first', 'Agreed']);
    expect(history).toMatchObject({ seq: start + 2, before: null });
    expect((await updates(bo, start + 1)).messages.map((m) => m.body)).toEqual(['Agreed']);
    expect((await updates(bo, start + 2)).messages).toEqual([]);
    expect(await updates(bo, 99)).toMatchObject({ reset: true, messages: [] });
  });

  it('wakes a waiting page as soon as someone posts', async () => {
    const { seq } = await status(bo).then((s) => s.room!);
    const started = Date.now();
    const waiting = updates(bo, seq, true);
    setTimeout(() => void say(ada, 'Are you there?'), 300);
    const got = await waiting;
    expect(got.messages.map((m) => m.body)).toEqual(['Are you there?']);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('lets authors delete their messages, and Membership Admins in the room any', async () => {
    const m = await say(ada, 'Oops, wrong room');
    const posted = (await status(bo)).room!.seq;
    expect((await api.call('DELETE', `/v1/room/messages/${m.messageId}`, bo)).status).toBe(403);
    const gone = await api.call('DELETE', `/v1/room/messages/${m.messageId}`, ada);
    expect(gone.body).toMatchObject({ deleted: true, body: '' });
    expect((await updates(bo, posted)).messages).toMatchObject([{ messageId: m.messageId, deleted: true, body: '' }]);

    const other = await say(bo, 'Off topic');
    // A Membership Admin acts from inside the room too.
    expect((await api.call('DELETE', `/v1/admin/room/messages/${other.messageId}`, ma)).status).toBe(403);
    await enter(ma);
    expect((await api.call('DELETE', `/v1/admin/room/messages/${other.messageId}`, ada)).status).toBe(403);
    expect((await api.call('DELETE', `/v1/admin/room/messages/${other.messageId}`, ma)).body).toMatchObject({ deleted: true });
  });
});

describe('votes and reactions', () => {
  const vote = async (by: User, messageId: string, value: number) => {
    const res = await api.call('PUT', `/v1/room/messages/${messageId}/vote`, by, { value });
    expect(res.status).toBe(200);
    return res.body as RoomMessageView;
  };
  const react = async (by: User, messageId: string, reaction: string, on = true) => {
    const res = await api.call('PUT', `/v1/room/messages/${messageId}/reactions`, by, { reaction, on });
    expect(res.status).toBe(200);
    return res.body as RoomMessageView;
  };
  const seen = async (by: User, messageId: string) =>
    ((await api.call('GET', '/v1/room/messages', by)).body as RoomHistory).messages.find((m) => m.messageId === messageId)!;
  const records = async (messageId: string) =>
    (await api.firebase.db.collection('room_reactions').where('messageId', '==', messageId).get()).docs.map((d) => d.data());

  beforeEach(async () => {
    await enter(ada);
    await enter(bo);
  });

  it('takes one vote per member, changed or taken back, and shows only the score', async () => {
    const m = await say(bo, 'Canvass the north side first');
    expect(m).toMatchObject({ reactable: true, score: 0, myVote: 0, reactions: [] });
    expect(await vote(ada, m.messageId, 1)).toMatchObject({ score: 1, myVote: 1 });
    expect(await seen(bo, m.messageId)).toMatchObject({ score: 1, myVote: 0 });
    // Authors may vote on their own, as on the forum.
    expect(await vote(bo, m.messageId, -1)).toMatchObject({ score: 0, myVote: -1 });
    expect(await vote(ada, m.messageId, -1)).toMatchObject({ score: -2, myVote: -1 });

    // The same vote again changes nothing, not even the feed.
    const before = (await status(ada)).room!.seq;
    expect(await vote(ada, m.messageId, -1)).toMatchObject({ score: -2, myVote: -1 });
    expect((await status(ada)).room!.seq).toBe(before);

    expect(await vote(ada, m.messageId, 0)).toMatchObject({ score: -1, myVote: 0 });
    expect(await records(m.messageId)).toMatchObject([{ accountId: bo.accountId, vote: -1, reactions: [] }]);
    // Totals only: nothing Bo is shown says who else voted.
    await vote(ada, m.messageId, 1);
    expect(JSON.stringify(await seen(bo, m.messageId))).not.toContain(ada.accountId);
    expect((await api.call('PUT', `/v1/room/messages/${m.messageId}/vote`, bo, { value: 2 })).status).toBe(400);
  });

  it('counts emoji reactions, each member’s own taken back by giving it again', async () => {
    const m = await say(ada, 'Flyers are printed');
    expect(await react(bo, m.messageId, 'celebrate')).toMatchObject({ reactions: [{ reaction: 'celebrate', count: 1, mine: true }] });
    expect(await react(bo, m.messageId, 'like')).toMatchObject({
      reactions: [
        { reaction: 'like', count: 1, mine: true },
        { reaction: 'celebrate', count: 1, mine: true },
      ],
    });
    expect(await react(ada, m.messageId, 'like')).toMatchObject({
      reactions: [
        { reaction: 'like', count: 2, mine: true },
        { reaction: 'celebrate', count: 1, mine: false },
      ],
    });
    expect(await react(bo, m.messageId, 'celebrate', false)).toMatchObject({ reactions: [{ reaction: 'like', count: 2, mine: true }] });
    expect(await seen(ada, m.messageId)).toMatchObject({ reactions: [{ reaction: 'like', count: 2, mine: true }] });
    expect((await api.call('PUT', `/v1/room/messages/${m.messageId}/reactions`, bo, { reaction: 'angry', on: true })).status).toBe(400);
  });

  it('reaches every page in the room as an update, waking one that waits', async () => {
    const m = await say(ada, 'Who can drive on Saturday?');
    const { seq } = (await status(ada)).room!;
    const waiting = updates(ada, seq, true);
    setTimeout(() => void react(bo, m.messageId, 'thanks'), 300);
    expect((await waiting).messages).toMatchObject([{ messageId: m.messageId, reactions: [{ reaction: 'thanks', count: 1, mine: false }] }]);
    await vote(bo, m.messageId, 1);
    expect((await updates(ada, seq + 1)).messages).toMatchObject([{ messageId: m.messageId, score: 1, myVote: 0 }]);
  });

  it('is for Active members in the room, on members’ messages and answers but not notices', async () => {
    const m = await say(ada, 'Hello');
    expect((await api.call('PUT', `/v1/room/messages/${m.messageId}/vote`, cy, { value: 1 })).status).toBe(403);
    // Not in the room: a Membership Admin who has not accepted the terms.
    expect((await api.call('PUT', `/v1/room/messages/${m.messageId}/reactions`, ma, { reaction: 'like', on: true })).status).toBe(403);
    await api.call('DELETE', '/v1/room/consent', bo);
    expect((await api.call('PUT', `/v1/room/messages/${m.messageId}/vote`, bo, { value: 1 })).status).toBe(403);

    await api.call('POST', '/v1/room/decisions', ada, { text: 'Meet on Tuesdays' });
    const notice = ((await api.call('GET', '/v1/room/messages', ada)).body as RoomHistory).messages.find((x) => x.kind === 'notice')!;
    expect(notice.reactable).toBe(false);
    expect((await api.call('PUT', `/v1/room/messages/${notice.messageId}/vote`, ada, { value: 1 })).status).toBe(409);
    expect((await api.call('PUT', '/v1/room/messages/no-such-message/vote', ada, { value: 1 })).status).toBe(404);
  });

  it('go with their message: deleted, or an answer erased with what it cites', async () => {
    const m = await say(bo, 'The canvassing plan v2 starts on the north side');
    await vote(ada, m.messageId, 1);
    await react(ada, m.messageId, 'love');
    const answer = await answerTo(ada, (await api.call('POST', '/v1/room/ask', ada, { question: 'What is the canvassing plan?' })).body.messageId);
    expect(await react(bo, answer.messageId, 'thinking')).toMatchObject({ reactable: true, reactions: [{ count: 1 }] });
    await vote(ada, answer.messageId, -1);

    await enter(ma);
    const gone = await api.call('DELETE', `/v1/admin/room/messages/${m.messageId}`, ma);
    expect(gone.body).toMatchObject({ deleted: true, reactable: false, score: 0, myVote: 0, reactions: [] });
    expect(await seen(ada, answer.messageId)).toMatchObject({ deleted: true, score: 0, myVote: 0, reactions: [] });
    expect(await records(m.messageId)).toEqual([]);
    expect(await records(answer.messageId)).toEqual([]);
    expect((await api.call('PUT', `/v1/room/messages/${m.messageId}/vote`, ada, { value: 1 })).status).toBe(404);

    // Forgetting a decision erases the answers citing it, their reactions too.
    const d = (await api.call('POST', '/v1/room/decisions', ada, { text: 'Adopted canvassing plan v2' })).body;
    const second = await answerTo(ada, (await api.call('POST', '/v1/room/ask', ada, { question: 'What is the canvassing plan?' })).body.messageId);
    await react(bo, second.messageId, 'like');
    expect((await api.call('DELETE', `/v1/room/memory/${d.itemId}`, ada)).status).toBe(204);
    expect(await records(second.messageId)).toEqual([]);
    expect(await seen(bo, second.messageId)).toMatchObject({ deleted: true, reactions: [] });
  });
});

describe('memory', () => {
  beforeEach(async () => {
    await enter(ada);
    await enter(bo);
  });

  it('logs decisions and action items with notices, and lists them', async () => {
    const m = await say(bo, 'Let’s adopt canvassing plan v2, north side first');
    const after = (await status(bo)).room!.seq;
    const decision = await api.call('POST', '/v1/room/decisions', ada, { text: 'Adopted canvassing plan v2', messageId: m.messageId });
    expect(decision.status).toBe(201);
    expect(decision.body).toMatchObject({ kind: 'decision', quote: 'Let’s adopt canvassing plan v2, north side first', createdBy: { name: 'Ada Brooks' }, forgettable: true });
    const todo = await api.call('POST', '/v1/room/actions', ada, { task: 'Print canvassing flyers', ownerId: bo.accountId, due: '2026-11-05' });
    expect(todo.body).toMatchObject({ kind: 'action', owner: { name: 'Bo' }, status: 'open', editable: true });
    expect((await api.call('POST', '/v1/room/actions', ada, { task: 'x', ownerId: cy.accountId })).status).toBe(409);

    const notices = (await updates(bo, after)).messages;
    expect(notices.map((n) => [n.kind, n.body])).toEqual([
      ['notice', 'logged a decision: Adopted canvassing plan v2'],
      ['notice', 'added an action item for Bo: Print canvassing flyers (due 2026-11-05)'],
    ]);
    const all = await memory(bo);
    expect(all.decisions).toHaveLength(1);
    expect(all.actions).toMatchObject([{ text: 'Print canvassing flyers', editable: true, forgettable: false }]);
    // The page searches memory itself: the api takes no search, so none reaches its logs.
    expect((await api.call('GET', '/v1/room/memory?q=flyers', bo)).status).toBe(200);

    const itemId = todo.body.itemId as string;
    const done = await api.call('PUT', `/v1/room/actions/${itemId}`, bo, { task: 'Print canvassing flyers', ownerId: bo.accountId, due: '2026-11-05', status: 'done' });
    expect(done.body).toMatchObject({ status: 'done', expireAt: expect.any(String) });
    expect((await api.call('PUT', `/v1/room/actions/${itemId}`, ma, { task: 'x', ownerId: bo.accountId, due: null, status: 'open' })).status).toBe(403);
  });

  it('forgets what its creator or a Membership Admin removes, notices and all', async () => {
    const d = (await api.call('POST', '/v1/room/decisions', ada, { text: 'Meet on Tuesdays' })).body;
    expect((await api.call('DELETE', `/v1/room/memory/${d.itemId}`, bo)).status).toBe(403);
    expect((await api.call('DELETE', `/v1/room/memory/${d.itemId}`, ada)).status).toBe(204);
    expect((await memory(bo)).decisions).toEqual([]);
    const history = (await api.call('GET', '/v1/room/messages', bo)).body as RoomHistory;
    expect(history.messages).toMatchObject([{ kind: 'notice', deleted: true, body: '' }]);

    const d2 = (await api.call('POST', '/v1/room/decisions', bo, { text: 'Meet on Wednesdays' })).body;
    await enter(ma);
    expect((await api.call('DELETE', `/v1/admin/room/memory/${d2.itemId}`, ma)).status).toBe(204);
    expect((await api.call('DELETE', `/v1/room/memory/${d2.itemId}`, bo)).status).toBe(404);
  });
});

describe('the assistant', () => {
  beforeEach(async () => {
    await enter(ada);
    await enter(bo);
  });

  it('answers /ask from the room’s memory, citing its sources', async () => {
    await say(bo, 'The canvassing plan v2 starts on the north side');
    await api.call('POST', '/v1/room/decisions', ada, { text: 'Adopted canvassing plan v2' });
    await say(ada, 'Lunch is at noon');
    const asked = await api.call('POST', '/v1/room/ask', ada, { question: 'What did we decide about the canvassing plan?' });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ kind: 'member', ask: true, body: 'What did we decide about the canvassing plan?' });
    const answer = await answerTo(bo, asked.body.messageId);
    expect(answer).toMatchObject({ kind: 'assistant', author: null, deletable: false });
    expect(answer.body).toContain('Adopted canvassing plan v2');
    expect(answer.sources.map((s) => s.kind).sort()).toEqual(['decision', 'message']);
    expect(answer.sources.every((s) => !s.excerpt.includes('Lunch'))).toBe(true);
    expect((await status(ada)).room!.assistant.pending).toEqual([]);
    const job = (await api.firebase.db.collection('room_jobs').get()).docs[0]!.data();
    expect(job).toMatchObject({ state: 'done', answerId: answer.messageId });
  });

  it('erases an answer when something it cites is deleted or forgotten', async () => {
    const m = await say(bo, 'The canvassing plan v2 starts on the north side');
    const d = (await api.call('POST', '/v1/room/decisions', ada, { text: 'Adopted canvassing plan v2' })).body;
    const first = await answerTo(ada, (await api.call('POST', '/v1/room/ask', ada, { question: 'What is the canvassing plan?' })).body.messageId);
    expect(first.sources.map((s) => s.id).sort()).toEqual([m.messageId, d.itemId].sort());
    // Renumbered as listed: the first source is [1].
    expect(first.body).toContain('[1]');
    expect((await api.call('DELETE', `/v1/room/messages/${m.messageId}`, bo)).status).toBe(200);
    const gone = (await updates(ada, 0)).messages.find((x) => x.messageId === first.messageId)!;
    expect(gone).toMatchObject({ deleted: true, body: '', sources: [] });

    const second = await answerTo(ada, (await api.call('POST', '/v1/room/ask', ada, { question: 'What is the canvassing plan?' })).body.messageId);
    expect(second.sources.map((s) => s.id)).toEqual([d.itemId]);
    expect((await api.call('DELETE', `/v1/room/memory/${d.itemId}`, ada)).status).toBe(204);
    expect((await updates(ada, 0)).messages.find((x) => x.messageId === second.messageId)).toMatchObject({ deleted: true, body: '' });
  });

  it('cancels a waiting question its author deletes', async () => {
    // A question the worker has not taken yet, as the queue would leave it.
    const q = await say(ada, 'placeholder');
    const at = new Date().toISOString();
    await api.firebase.db.collection('room_messages').doc(q.messageId).update({ ask: true, body: 'Still waiting?' });
    await api.firebase.db.collection('room_jobs').doc('waiting').set({
      jobId: 'waiting', questionId: q.messageId, askedBy: ada.accountId, question: 'Still waiting?', state: 'queued',
      createdAt: at, startedAt: null, finishedAt: null, answerId: null, error: null, expireAt: null,
    });
    await api.firebase.db.collection('room_state').doc('feed').update({ pending: [q.messageId] });
    expect((await status(ada)).room!.assistant.pending).toEqual([q.messageId]);
    expect((await api.call('DELETE', `/v1/room/messages/${q.messageId}`, ada)).status).toBe(200);
    expect((await status(ada)).room!.assistant.pending).toEqual([]);
    expect((await api.firebase.db.collection('room_jobs').doc('waiting').get()).data()).toMatchObject({ state: 'cancelled', expireAt: expect.any(String) });
  });

  it('says so when memory has nothing on it', async () => {
    const asked = await api.call('POST', '/v1/room/ask', ada, { question: 'Who won the 1904 World Series?' });
    expect((await answerTo(ada, asked.body.messageId)).body).toBe('The room’s memory does not say.');
  });

  it('is switched off and on by a Membership Admin in the room, ledgered', async () => {
    expect((await api.call('PUT', '/v1/admin/room/assistant', ada, { on: false })).status).toBe(403);
    await enter(ma);
    // A question still waiting is cancelled, and its record deleted a day on with the rest.
    await api.firebase.db.collection('room_jobs').doc('waiting').set({
      jobId: 'waiting', questionId: 'q-waiting', askedBy: ada.accountId, question: 'Anything new?', state: 'queued',
      createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, answerId: null, error: null, expireAt: null,
    });
    await api.firebase.db.collection('room_state').doc('feed').update({ pending: ['q-waiting'] });
    const off = await api.call('PUT', '/v1/admin/room/assistant', ma, { on: false });
    expect(off.body).toMatchObject({ room: { moderator: true, assistant: { on: false, pending: [], switchedBy: { name: 'Morgan Admin' } } } });
    expect((await api.firebase.db.collection('room_jobs').doc('waiting').get()).data()).toMatchObject({ state: 'cancelled', expireAt: expect.any(String) });
    expect((await api.call('POST', '/v1/room/ask', ada, { question: 'Anything?' })).status).toBe(409);
    expect((await api.call('POST', '/v1/room/decisions', ada, { text: 'Still works' })).status).toBe(201);
    expect((await entries('room.assistant_switched')).map((e) => e.payload)).toEqual([{ on: false }]);
    expect((await api.call('PUT', '/v1/admin/room/assistant', ma, { on: false })).status).toBe(409);
    expect((await api.call('PUT', '/v1/admin/room/assistant', ma, { on: true })).body).toMatchObject({ room: { assistant: { on: true } } });
  });
});

describe('the admins’ switches', () => {
  beforeEach(async () => {
    await enter(ada);
  });

  it('let Membership and System Admins close and open the room for everyone, ledgered', async () => {
    expect((await api.call('GET', '/v1/admin/room/settings', ada)).status).toBe(403);
    const settings = await api.call('GET', '/v1/admin/room/settings', ma);
    expect(settings.body).toMatchObject({ open: true, server: { on: true, model: 'stand-in' }, people: 1, canSwitchServer: false });

    const closed = await api.call('PUT', '/v1/admin/room/settings/open', ma, { on: false });
    expect(closed.body).toMatchObject({ open: false, openChangedBy: { name: 'Morgan Admin' } });
    expect(await status(ada)).toMatchObject({ open: false, inRoom: false, room: null, closed: { by: { name: 'Morgan Admin' } } });
    expect((await api.call('GET', '/v1/room/messages', ada)).status).toBe(403);
    expect((await api.call('POST', '/v1/room/messages', ada, { body: 'hello?' })).status).toBe(403);
    expect((await api.call('PUT', '/v1/admin/room/settings/open', sa1, { on: false })).status).toBe(409);

    const opened = (await api.call('PUT', '/v1/admin/room/settings/open', sa1, { on: true })).body;
    expect(opened).toMatchObject({ open: true, canSwitchServer: true });
    // A System Admin with no membership is named by their account's display name, else "an admin"; never by email.
    expect(opened.openChangedBy.name).not.toMatch(/@|Former member/);
    expect((await say(ada, 'Back again')).body).toBe('Back again');
    expect((await entries('room.settings_changed')).map((e) => e.payload)).toEqual([
      { setting: 'open', on: false },
      { setting: 'open', on: true },
    ]);
  });

  it('let only System Admins switch the model server; off, questions are refused and the chat goes on', async () => {
    expect((await api.call('PUT', '/v1/admin/room/settings/server', ma, { on: false })).status).toBe(403);
    const off = await api.call('PUT', '/v1/admin/room/settings/server', sa1, { on: false });
    expect(off.body).toMatchObject({ server: { on: false }, canSwitchServer: true });
    expect((await status(ada)).room!.assistant).toMatchObject({ server: false });
    const refused = await api.call('POST', '/v1/room/ask', ada, { question: 'Anything new?' });
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toContain('model server off');
    await say(ada, 'The chat still works');
    expect((await api.call('PUT', '/v1/admin/room/settings/server', sa1, { on: true })).body).toMatchObject({ server: { on: true } });
    const asked = await api.call('POST', '/v1/room/ask', ada, { question: 'Anything new?' });
    expect(asked.status).toBe(201);
    await answerTo(ada, asked.body.messageId);
    expect((await entries('room.settings_changed')).map((e) => e.payload)).toEqual([
      { setting: 'server', on: false },
      { setting: 'server', on: true },
    ]);
  });

  it('let Membership and System Admins change the door’s words; new terms send everyone back to accept them, ledgered', async () => {
    const door = (by: User, input: { basedOn: number; intro: string; terms: string }) => api.call('PUT', '/v1/admin/room/door', by, input);
    expect((await door(ada, { basedOn: 0, intro: '', terms: 'Mine now' })).status).toBe(403);
    const before = (await api.call('GET', '/v1/admin/room/settings', ma)).body as RoomSettingsView;
    expect(before.door).toMatchObject({ revision: 0, intro: ROOM_INTRO, terms: { version: 1, text: ROOM_TERMS.text, hash: ROOM_TERMS_HASH }, termsChangedBy: null });

    // The intro alone is no new version: nobody leaves.
    const intro = await door(ma, { basedOn: 0, intro: '  Where the group plans. ', terms: ROOM_TERMS.text });
    expect(intro.body.door).toMatchObject({ revision: 1, intro: 'Where the group plans.', terms: { version: 1 }, introChangedBy: { name: 'Morgan Admin' } });
    expect(await status(ada)).toMatchObject({ inRoom: true, intro: 'Where the group plans.', terms: { version: 1 } });
    // An edit of an older revision is refused, and so are empty terms.
    expect((await door(sa1, { basedOn: 0, intro: '', terms: 'New' })).status).toBe(409);
    expect((await door(sa1, { basedOn: 1, intro: '', terms: ' \n\n ' })).status).toBe(400);

    expect((await api.call('POST', '/v1/room/voice', ada, {})).status).toBe(201);
    const terms = 'The assistant reads the room.\n\nLeave with /leave-room.';
    const saved = await door(sa1, { basedOn: 1, intro: 'Where the group plans.', terms: `${terms}\n\n\n` });
    expect(saved.body).toMatchObject({ people: 0, door: { revision: 2, terms: { version: 2, text: terms }, termsChangedBy: { name: expect.any(String) } } });
    const hash = (saved.body as RoomSettingsView).door.terms.hash;
    // Ada is back at the door at once, and accepts the new terms (not the old ones) to come back.
    expect((await api.call('GET', '/v1/room/updates?since=0&wait=0', ada)).status).toBe(403);
    expect(await status(ada)).toMatchObject({ inRoom: false, room: null, consent: { version: 1 }, terms: { version: 2, text: terms, hash } });
    expect((await api.call('POST', '/v1/room/consent', ada, { version: 1 })).status).toBe(409);
    const back = await api.call('POST', '/v1/room/consent', ada, { version: 2 });
    // Back in the room, and out of the call she was in.
    expect(back.body).toMatchObject({ inRoom: true, room: { people: [{ name: 'Ada Brooks' }], voice: [] } });
    const said = ((await api.call('GET', '/v1/room/messages', ada)).body as RoomHistory).messages;
    const notice = said.find((m) => m.kind === 'notice' && m.body === 'changed the room’s terms (version 2); everyone accepts them again to stay');
    // The System Admin who changed them holds no membership: named as an admin, never "Former member" or by email.
    expect(notice?.author?.name).toEqual(expect.any(String));
    expect(notice?.author?.name).not.toMatch(/@|Former member/);

    expect((await entries('room.door_changed')).map((e) => e.payload)).toEqual([
      { termsVersion: 1, termsHash: ROOM_TERMS_HASH, changes: [{ part: 'intro', to: 'Where the group plans.' }] },
      { termsVersion: 2, termsHash: hash, changes: [{ part: 'terms', to: terms }] },
    ]);
    expect((await entries('room.consent_changed')).at(-1)).toMatchObject({ payload: { change: 'accepted', termsVersion: 2, termsHash: hash } });
  });
});

describe('retention', () => {
  it('deletes messages with their votes and reactions, and done action items, past their time, and gives up on stale questions', async () => {
    await enter(ada);
    const old = await say(ada, 'Old news');
    const fresh = await say(ada, 'Fresh news');
    // A reaction expires with its message: it takes the message's expireAt.
    await api.call('PUT', `/v1/room/messages/${fresh.messageId}/reactions`, ada, { reaction: 'like', on: true });
    const reaction = (await api.firebase.db.collection('room_reactions').get()).docs[0]!;
    const freshDoc = await api.firebase.db.collection('room_messages').doc(fresh.messageId).get();
    expect(reaction.get('expireAt')).toBe(freshDoc.get('expireAt'));
    await api.call('PUT', `/v1/room/messages/${old.messageId}/vote`, ada, { value: 1 });
    const todo = (await api.call('POST', '/v1/room/actions', ada, { task: 'Done long ago', ownerId: ada.accountId })).body;
    const past = '2026-01-01T00:00:00.000Z';
    await api.firebase.db.collection('room_messages').doc(old.messageId).update({ expireAt: past });
    await api.firebase.db.collection('room_reactions').where('messageId', '==', old.messageId).get().then((s) => s.docs[0]!.ref.update({ expireAt: past }));
    await api.firebase.db.collection('room_memory').doc(todo.itemId).update({ status: 'done', doneAt: past, expireAt: past });
    await api.firebase.db.collection('room_jobs').doc('stale').set({
      jobId: 'stale',
      questionId: 'q-stale',
      askedBy: ada.accountId,
      question: 'Lost?',
      state: 'queued',
      createdAt: past,
      startedAt: null,
      finishedAt: null,
      answerId: null,
      error: null,
      expireAt: null,
    });

    const tick = await worker.tick();
    expect(tick.status).toBe(200);
    expect(tick.body.roomExpired).toBe(4);
    const bodies = ((await api.call('GET', '/v1/room/messages', ada)).body as RoomHistory).messages.map((m) => m.body);
    expect(bodies).not.toContain('Old news');
    expect(bodies).toContain('Fresh news');
    expect((await api.firebase.db.collection('room_reactions').get()).docs.map((d) => d.get('messageId'))).toEqual([fresh.messageId]);
    expect(bodies.at(-1)).toBe(`I could not answer this: it took longer than 10 minutes. Ask again in a minute.`);
    expect((await memory(ada)).actions).toEqual([]);
    expect((await api.firebase.db.collection('room_jobs').doc('stale').get()).data()).toMatchObject({ state: 'failed' });
  });

  it('drops pages gone quiet from the call and deletes old handshakes', async () => {
    await enter(ada);
    const past = '2026-01-01T00:00:00.000Z';
    await api.firebase.db.collection('room_voice').doc(bo.accountId).set({ accountId: bo.accountId, sessionId: 'gone', joinedAt: past, seenAt: past, muted: false, actions: [] });
    await api.firebase.db.collection('room_signals').doc('old').set({ signalId: 'old', seq: 1, from: bo.accountId, fromSession: 'gone', to: ada.accountId, toSession: 's', kind: 'offer', sdp: 'v=0', createdAt: past, expireAt: past });
    // Already left out of who is in the call; the tick deletes it, and tells open pages.
    const before = await status(ada);
    expect(before.room?.voice).toEqual([]);
    const tick = await worker.tick();
    expect(tick.body.roomExpired).toBe(2);
    expect((await api.firebase.db.collection('room_voice').doc(bo.accountId).get()).exists).toBe(false);
    expect((await api.firebase.db.collection('room_signals').doc('old').get()).exists).toBe(false);
    expect((await updates(ada, before.room!.seq)).voice).toEqual([]);
  });
});

describe('the call', () => {
  const join = async (by: User, body: object = {}) => {
    const res = await api.call('POST', '/v1/room/voice', by, body);
    expect(res.status).toBe(201);
    return res.body as RoomVoiceJoined;
  };
  const inCall = async (by: User, since: number, sessionId: string) =>
    (await api.call('GET', `/v1/room/updates?since=${since}&wait=0&voice=${sessionId}`, by)).body as RoomUpdates;

  beforeEach(async () => {
    await enter(ada);
    await enter(bo);
  });

  it('says who is in it, passes each pair’s handshake, and lets them leave', async () => {
    const a = await join(ada);
    expect(a).toMatchObject({ voice: [{ name: 'Ada Brooks', mine: true, muted: false }], iceServers: [{ urls: [expect.stringMatching(/^stun:/)] }] });
    const b = await join(bo, { muted: true });
    expect(b.voice.map((v) => [v.name, v.muted])).toEqual([['Ada Brooks', false], ['Bo', true]]);
    // Everyone in the room sees who is in the call, in or out of it.
    expect((await updates(ada, a.voiceSeq)).voice?.map((v) => v.name)).toEqual(['Ada Brooks', 'Bo']);
    expect((await status(ada)).room?.voice).toHaveLength(2);

    // Bo joined later, so Bo offers; only Ada's page in the call gets it.
    const offer = { to: ada.accountId, toSession: a.sessionId, kind: 'offer', sdp: 'v=0 offer' };
    expect((await api.call('POST', '/v1/room/voice/signals', bo, { sessionId: b.sessionId, signals: [offer] })).status).toBe(204);
    expect((await inCall(ada, b.voiceSeq, a.sessionId)).signals).toEqual([{ signalId: expect.any(String), from: bo.accountId, fromSession: b.sessionId, kind: 'offer', sdp: 'v=0 offer' }]);
    expect((await inCall(ada, b.voiceSeq, 'another-page')).signals).toEqual([]);
    expect((await updates(ada, b.voiceSeq)).signals).toEqual([]);
    const answer = { to: bo.accountId, toSession: b.sessionId, kind: 'answer', sdp: 'v=0 answer' };
    expect((await api.call('POST', '/v1/room/voice/signals', ada, { sessionId: a.sessionId, signals: [answer] })).status).toBe(204);
    expect((await inCall(bo, b.voiceSeq, b.sessionId)).signals.map((s) => s.kind)).toEqual(['answer']);
    // Never to a page not in the call, nor from one.
    expect((await api.call('POST', '/v1/room/voice/signals', bo, { sessionId: b.sessionId, signals: [{ ...offer, toSession: 'old' }] })).status).toBe(409);
    expect((await api.call('POST', '/v1/room/voice/signals', bo, { sessionId: 'old', signals: [offer] })).status).toBe(409);

    // Muting tells the room; a page saying it is still there does not.
    const seq = (await status(ada)).room!.seq;
    expect((await api.call('PUT', '/v1/room/voice', bo, { sessionId: b.sessionId, muted: true })).status).toBe(204);
    expect((await status(ada)).room!.seq).toBe(seq);
    expect((await api.call('PUT', '/v1/room/voice', bo, { sessionId: b.sessionId, muted: false })).status).toBe(204);
    expect((await updates(ada, seq)).voice?.find((v) => v.name === 'Bo')?.muted).toBe(false);

    // Leaving from another page changes nothing; from the page in the call, it leaves.
    expect((await api.call('DELETE', '/v1/room/voice?sessionId=old', ada)).status).toBe(204);
    expect((await status(bo)).room!.voice).toHaveLength(2);
    expect((await api.call('DELETE', `/v1/room/voice?sessionId=${a.sessionId}`, ada)).status).toBe(204);
    expect((await status(bo)).room!.voice.map((v) => v.name)).toEqual(['Bo']);
    expect((await api.call('PUT', '/v1/room/voice', ada, { sessionId: a.sessionId, muted: false })).status).toBe(409);
  });

  it('moves a member to the page they last joined from, and drops them when they leave the room', async () => {
    const first = await join(ada);
    const second = await join(ada);
    expect(second.voice).toEqual([expect.objectContaining({ sessionId: second.sessionId, mine: true })]);
    expect((await api.call('PUT', '/v1/room/voice', ada, { sessionId: first.sessionId, muted: false })).status).toBe(409);
    expect((await api.call('POST', '/v1/room/voice', cy, {})).status).toBe(403);
    expect((await api.call('DELETE', '/v1/room/consent', ada)).status).toBe(200);
    expect((await status(bo)).room!.voice).toEqual([]);
  });

  it('ends when an admin closes the room', async () => {
    const a = await join(ada);
    await join(bo);
    await api.call('PUT', '/v1/admin/room/settings/open', ma, { on: false });
    expect((await api.call('PUT', '/v1/room/voice', ada, { sessionId: a.sessionId, muted: false })).status).toBe(403);
    expect((await api.call('POST', '/v1/room/voice', ada, {})).status).toBe(403);
    expect((await api.call('POST', '/v1/room/joke', ada)).status).toBe(403);
    await api.call('PUT', '/v1/admin/room/settings/open', ma, { on: true });
    expect((await status(ada)).room?.voice).toEqual([]);
  });

  it('holds eight at most', async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 8; i++) {
      await api.firebase.db.collection('room_voice').doc(`m${i}`).set({ accountId: `m${i}`, sessionId: `s${i}`, joinedAt: now, seenAt: now, muted: false, actions: [] });
    }
    const full = await api.call('POST', '/v1/room/voice', ada, {});
    expect(full.status).toBe(409);
    expect(full.body.detail).toContain('the call is full');
  });
});

describe('/joke', () => {
  beforeEach(async () => {
    await enter(ada);
  });

  it('tells a lame joke for whoever asked, a different one each time, as the assistant', async () => {
    const first = await api.call('POST', '/v1/room/joke', ada);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ kind: 'assistant', joke: true, author: { name: 'Ada Brooks' }, mine: false, deletable: false });
    const told = DAILY_JOKES.find((j) => (first.body as RoomMessageView).body === `${j.setup}\n${j.punchline}`);
    expect(told).toBeDefined();
    const second = (await api.call('POST', '/v1/room/joke', ada)).body as RoomMessageView;
    expect(second.body).not.toBe(first.body.body);
    expect((await updates(ada, 0)).messages.filter((m) => m.joke)).toHaveLength(2);
  });

  it('stops while the assistant is switched off', async () => {
    await enter(ma);
    await api.call('PUT', '/v1/admin/room/assistant', ma, { on: false });
    expect((await api.call('POST', '/v1/room/joke', ada)).status).toBe(409);
  });
});
