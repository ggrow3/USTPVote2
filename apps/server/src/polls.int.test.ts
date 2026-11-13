import sharp from 'sharp';
import { Collections, POLL_VOTES_PER_ADDRESS_PER_DAY, type AdminPoll, type PublicPoll } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PollsService } from './communications/polls.service.js';
import { LinkPreviewService } from './link-previews/link-previews.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let comms: Member;
let ma: Member;
let ada: Member;
let cy: Member;

const ADMIN = '/v1/admin/communications/polls';
const QUESTION = 'Should Congress fund longevity research?';
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** A browser's token, as the web app makes them: URL-safe, here 22 characters. */
const browser = (n: number) => `browser-token-${String(n).padStart(8, '0')}`;

const draft = async (body: Record<string, unknown> = {}) =>
  (await api.call('POST', ADMIN, comms, { question: QUESTION, choices: ['Yes', 'No', 'Not sure'], closesAt: inDays(7), hashtags: ['Longevity'], ...body })).body as AdminPoll;
const publish = async (poll: AdminPoll) => (await api.call('POST', `${ADMIN}/${poll.pollId}/publish`, comms, { basedOn: poll.version })).body as AdminPoll;
const openPoll = async (body: Record<string, unknown> = {}) => publish(await draft(body));

/** An answer from someone signed out, from `address`, as Hosting forwards it. */
const answer = (pollId: string, choiceId: string, voter: string, address = '203.0.113.7', website = '') =>
  api.app.inject({ method: 'POST', url: `/v1/polls/${pollId}/votes`, headers: { 'x-forwarded-for': address }, payload: { choiceId, voter, website } });
const view = async (pollId: string, voter?: string) =>
  (await api.call('GET', `/v1/polls/${pollId}`, undefined, undefined, voter ? { 'x-poll-voter': voter } : {})).body as PublicPoll;
const adminView = async (pollId: string) => ((await api.call('GET', ADMIN, comms)).body as AdminPoll[]).find((p) => p.pollId === pollId)!;

async function memberRecord(user: Member, legalName: string, status = 'active') {
  await api.firebase.db.collection(Collections.members).doc(user.accountId).set({ accountId: user.accountId, status, legalName, preferredName: null, state: 'TX' });
}

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  comms = await api.member('comms@example.test');
  ma = await api.member('membership.admin@example.test');
  ada = await api.member('ada@example.test');
  cy = await api.member('cy@example.test');
  await api.grant(comms.accountId, 'communications_admin', sa1);
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await memberRecord(ada, 'Ada Brooks');
  await memberRecord(cy, 'Cy Park', 'applicant');
});

describe('writing polls', () => {
  it('is for Communications Admins only', async () => {
    for (const user of [ma, ada, sa1]) expect((await api.call('GET', ADMIN, user)).status).toBe(403);
    expect((await api.call('GET', ADMIN)).status).toBe(401);
    expect((await api.call('GET', ADMIN, comms)).status).toBe(200);
    expect((await api.call('POST', ADMIN, ada, { question: QUESTION, choices: ['Yes', 'No'] })).status).toBe(403);
  });

  it('keeps a draft private, publishes it with a closing time, and then fixes its question and choices', async () => {
    const poll = await draft({ closesAt: null });
    expect(poll).toMatchObject({ status: 'draft', state: 'draft', version: 1, choices: [{ choiceId: 'c1', label: 'Yes' }, { choiceId: 'c2' }, { choiceId: 'c3' }] });
    expect((await api.call('GET', `/v1/polls/${poll.pollId}`)).status).toBe(404);
    expect((await api.call('GET', '/v1/polls')).body).toEqual([]);

    expect((await api.call('POST', `${ADMIN}/${poll.pollId}/publish`, comms, { basedOn: 1 })).body.detail).toMatch(/set when the poll closes/);
    const soon = await api.call('PUT', `${ADMIN}/${poll.pollId}`, comms, { question: QUESTION, choices: ['Yes', 'No'], closesAt: new Date(Date.now() + 60_000).toISOString(), basedOn: 1 });
    expect(soon.status).toBe(200);
    expect((await api.call('POST', `${ADMIN}/${poll.pollId}/publish`, comms, { basedOn: 2 })).body.detail).toMatch(/at least 10 minutes/);
    const stale = await api.call('PUT', `${ADMIN}/${poll.pollId}`, comms, { question: QUESTION, choices: ['Yes', 'No'], closesAt: inDays(3), basedOn: 1 });
    expect(stale.status).toBe(409);
    const ready = (await api.call('PUT', `${ADMIN}/${poll.pollId}`, comms, { question: QUESTION, choices: ['Yes', 'No'], closesAt: inDays(3), basedOn: 2 })).body as AdminPoll;
    expect((await api.call('PUT', `${ADMIN}/${poll.pollId}`, comms, { question: 'Q?', choices: ['Yes', 'yes'], basedOn: 3 })).status).toBe(400);

    const published = await publish(ready);
    expect(published).toMatchObject({ status: 'published', state: 'open', publishedBy: comms.accountId });
    expect((await api.call('PUT', `${ADMIN}/${poll.pollId}`, comms, { question: 'Changed?', choices: ['A', 'B'], closesAt: inDays(3), basedOn: published.version })).status).toBe(409);
    expect(await view(poll.pollId)).toMatchObject({ question: QUESTION, state: 'open', voted: false, results: null, choices: [{ label: 'Yes' }, { label: 'No' }] });
  });

  it('is never ledgered', async () => {
    const poll = await openPoll();
    await answer(poll.pollId, 'c1', browser(1));
    await api.call('POST', `${ADMIN}/${poll.pollId}/close`, comms, { basedOn: poll.version });
    await api.call('DELETE', `${ADMIN}/${poll.pollId}`, comms);
    const types = (await api.firebase.db.collection(Collections.auditEvents).get()).docs.map((d) => d.data().type as string);
    expect(types.some((t) => t.startsWith('poll'))).toBe(false);
  });
});

describe('answering a poll signed out', () => {
  it('takes one answer per browser, then shows that browser the results so far', async () => {
    const poll = await openPoll();
    const first = await answer(poll.pollId, 'c1', browser(1));
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ voted: true, results: { everyone: { total: 1, counts: { c1: 1, c2: 0, c3: 0 } }, members: { total: 0 } } });
    const again = await answer(poll.pollId, 'c2', browser(1));
    expect(again.statusCode).toBe(409);
    expect(again.json().detail).toMatch(/already answered/);
    expect((await answer(poll.pollId, 'c9', browser(2))).statusCode).toBe(400);
    expect((await answer(poll.pollId, 'c2', 'bad token')).statusCode).toBe(400);

    expect(await view(poll.pollId, browser(1))).toMatchObject({ voted: true, results: { everyone: { total: 1 } } });
    expect(await view(poll.pollId, browser(2))).toMatchObject({ voted: false, results: null });
    expect(await view(poll.pollId)).toMatchObject({ voted: false, results: null });
    const listed = (await api.call('GET', '/v1/polls', undefined, undefined, { 'x-poll-voter': browser(1) })).body as PublicPoll[];
    expect(listed).toEqual([expect.objectContaining({ pollId: poll.pollId, voted: true, results: expect.anything() })]);
  });

  it('keeps no choice, address or token: only a hashed mark that this browser answered', async () => {
    const poll = await openPoll();
    await answer(poll.pollId, 'c2', browser(1), '198.51.100.23');
    const stored = JSON.stringify(
      await Promise.all(
        [Collections.pollMarks, Collections.pollAddressCounts, Collections.pollTallies].map(async (c) =>
          (await api.firebase.db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() })),
        ),
      ),
    );
    expect(stored).not.toContain('198.51.100.23');
    expect(stored).not.toContain(browser(1));
    const marks = (await api.firebase.db.collection(Collections.pollMarks).get()).docs.map((d) => d.data());
    expect(marks).toEqual([{ pollId: poll.pollId }]);
  });

  it('counts nothing from a form filler that fills the hidden field, and answers it all the same', async () => {
    const poll = await openPoll();
    const trapped = await answer(poll.pollId, 'c1', browser(1), '203.0.113.7', 'http://spam.example');
    expect(trapped.statusCode).toBe(200);
    expect((await adminView(poll.pollId)).results.everyone.total).toBe(0);
  });

  it(`takes at most ${POLL_VOTES_PER_ADDRESS_PER_DAY} answers a day to one poll from one network address`, async () => {
    const poll = await openPoll();
    for (let i = 0; i < POLL_VOTES_PER_ADDRESS_PER_DAY; i++) expect((await answer(poll.pollId, 'c1', browser(100 + i), '203.0.113.9')).statusCode).toBe(200);
    const over = await answer(poll.pollId, 'c1', browser(999), '203.0.113.9');
    expect(over.statusCode).toBe(429);
    expect((await answer(poll.pollId, 'c1', browser(999), '203.0.113.10')).statusCode).toBe(200);
    const other = await openPoll({ question: 'Should the FDA treat ageing as a disease?' });
    expect((await answer(other.pollId, 'c1', browser(998), '203.0.113.9')).statusCode).toBe(200);
  });

  it('refuses answers to a draft or a closed poll', async () => {
    const pending = await draft();
    expect((await answer(pending.pollId, 'c1', browser(1))).statusCode).toBe(404);
    const poll = await openPoll();
    await api.call('POST', `${ADMIN}/${poll.pollId}/close`, comms, { basedOn: poll.version });
    const late = await answer(poll.pollId, 'c1', browser(1));
    expect(late.statusCode).toBe(409);
    expect(late.json().detail).toMatch(/closed/);
    expect((await answer('not-a-poll', 'c1', browser(1))).statusCode).toBe(404);
  });
});

describe('answering a poll signed in', () => {
  it("takes one answer per account, and counts an Active member's among members too", async () => {
    const poll = await openPoll();
    const mine = await api.call('POST', `/v1/polls/${poll.pollId}/member-votes`, ada, { choiceId: 'c2', voter: browser(50) });
    expect(mine.status).toBe(200);
    expect(mine.body.results).toEqual({ everyone: { total: 1, counts: { c1: 0, c2: 1, c3: 0 } }, members: { total: 1, counts: { c1: 0, c2: 1, c3: 0 } } });
    // Once per account, from any browser; and that browser has answered, signed in or not.
    expect((await api.call('POST', `/v1/polls/${poll.pollId}/member-votes`, ada, { choiceId: 'c1', voter: browser(51) })).status).toBe(409);
    expect((await answer(poll.pollId, 'c1', browser(50))).statusCode).toBe(409);
    expect((await api.call('GET', `/v1/polls/${poll.pollId}/mine`, ada)).body).toMatchObject({ voted: true, results: { everyone: { total: 1 } } });

    // An applicant answers as everyone else does.
    await api.call('POST', `/v1/polls/${poll.pollId}/member-votes`, cy, { choiceId: 'c1', voter: browser(60) });
    expect((await adminView(poll.pollId)).results).toMatchObject({ everyone: { total: 2, counts: { c1: 1, c2: 1 } }, members: { total: 1 } });
    expect((await api.call('GET', `/v1/polls/${poll.pollId}/mine`, ma)).body).toMatchObject({ voted: false, results: null });
    expect((await api.call('GET', `/v1/polls/${poll.pollId}/mine`)).status).toBe(401);
  });
});

describe('a closed poll', () => {
  it('shows everyone its results, and its link preview has a bar per choice', async () => {
    const poll = await openPoll();
    const previews = api.app.get(LinkPreviewService);
    const open = await previews.find(`/polls/${poll.pollId}`);
    expect(open?.preview).toMatchObject({ title: `Poll: ${QUESTION}`, card: { kicker: expect.stringMatching(/^Poll · Open until /), lines: ['Yes · No · Not sure', expect.any(String)] } });
    expect(open?.preview.card.bars).toBeUndefined();

    for (const [i, choice] of ['c1', 'c1', 'c1', 'c2'].entries()) await answer(poll.pollId, choice, browser(i + 1), `203.0.113.${i + 1}`);
    await api.call('POST', `/v1/polls/${poll.pollId}/member-votes`, ada, { choiceId: 'c2', voter: browser(50) });
    expect((await previews.find(`/polls/${poll.pollId}`))?.version).toBe(open?.version);

    const closed = (await api.call('POST', `${ADMIN}/${poll.pollId}/close`, comms, { basedOn: poll.version })).body as AdminPoll;
    expect(closed).toMatchObject({ state: 'closed', closedBy: comms.accountId });
    expect(await view(poll.pollId)).toMatchObject({ state: 'closed', voted: false, results: { everyone: { total: 5, counts: { c1: 3, c2: 2, c3: 0 } }, members: { total: 1 } } });

    const found = await previews.find(`/polls/${poll.pollId}`);
    expect(found?.preview).toMatchObject({
      title: `Poll results: ${QUESTION}`,
      description: expect.stringContaining('Most chose “Yes” (60%); Active members chose “No” (100%), of 5 answers'),
      card: {
        kicker: 'Poll results · 5 answers',
        bars: [
          { label: 'Yes', value: '60%', share: 0.6, highlight: true },
          { label: 'No', value: '40%', share: 0.4 },
          { label: 'Not sure', value: '0%', share: 0 },
        ],
      },
    });
    const card = await api.app.inject({ method: 'GET', url: `/v1/public/link-cards?path=${encodeURIComponent(`/polls/${poll.pollId}`)}` });
    expect(card.statusCode).toBe(200);
    expect(await sharp(card.rawPayload).metadata()).toMatchObject({ format: 'png', width: 1200, height: 630 });
  });

  it('has no preview or card while a draft', async () => {
    const pending = await draft();
    expect(await api.app.get(LinkPreviewService).find(`/polls/${pending.pollId}`)).toBeNull();
    expect((await api.app.inject({ method: 'GET', url: `/v1/public/link-cards?path=${encodeURIComponent(`/polls/${pending.pollId}`)}` })).statusCode).toBe(404);
  });

  it("loses its marks at the worker's next tick, with the address counts of days gone", async () => {
    const done = await openPoll();
    const running = await openPoll({ question: 'Should ageing be a disease?' });
    await answer(done.pollId, 'c1', browser(1));
    await api.call('POST', `/v1/polls/${done.pollId}/member-votes`, ada, { choiceId: 'c1', voter: browser(2) });
    await answer(running.pollId, 'c1', browser(1));
    await api.call('POST', `${ADMIN}/${done.pollId}/close`, comms, { basedOn: done.version });
    await api.firebase.db.collection(Collections.pollAddressCounts).doc('2020-01-01_x_y').set({ day: '2020-01-01', pollId: 'x', count: 3 });
    await api.firebase.db.collection(Collections.pollLimits).doc('2020-01-01').set({ day: '2020-01-01', salt: 'aa' });

    expect(await api.app.get(PollsService).clearClosed()).toBe(3);
    const marks = (await api.firebase.db.collection(Collections.pollMarks).get()).docs.map((d) => d.data().pollId as string);
    expect(marks).toEqual([running.pollId]);
    expect((await adminView(done.pollId)).marksCleared).toBe(true);
    expect((await adminView(done.pollId)).results.everyone.total).toBe(2);
    expect((await api.firebase.db.collection(Collections.pollAddressCounts).get()).docs.map((d) => d.id)).not.toContain('2020-01-01_x_y');
    expect((await api.firebase.db.collection(Collections.pollLimits).get()).docs.map((d) => d.id)).not.toContain('2020-01-01');
    expect(await api.app.get(PollsService).clearClosed()).toBe(0);
  });
});

describe('sharing and deleting a poll', () => {
  it('counts share buttons on a published poll, and deleting takes it off the site with everything of it', async () => {
    const pending = await draft();
    expect((await api.call('POST', '/v1/share/clicks', undefined, { item: `poll-${pending.pollId}`, target: 'x' })).status).toBe(404);
    const poll = await openPoll({ question: 'Should Congress fund cryonics research?' });
    expect((await api.call('POST', '/v1/share/clicks', undefined, { item: `poll-${poll.pollId}`, target: 'bluesky' })).status).toBe(204);
    expect((await adminView(poll.pollId)).shared).toBe(1);
    await answer(poll.pollId, 'c1', browser(1));

    expect((await api.call('DELETE', `${ADMIN}/${poll.pollId}`, ada)).status).toBe(403);
    expect((await api.call('DELETE', `${ADMIN}/${poll.pollId}`, comms)).status).toBe(204);
    expect((await api.call('GET', `/v1/polls/${poll.pollId}`)).status).toBe(404);
    for (const c of [Collections.pollMarks, Collections.pollTallies, Collections.pollAddressCounts]) {
      expect((await api.firebase.db.collection(c).where('pollId', '==', poll.pollId).get()).size, c).toBe(0);
    }
    expect((await api.firebase.db.collection(Collections.shareCounts).doc(`poll-${poll.pollId}`).get()).exists).toBe(false);
    expect((await api.call('DELETE', `${ADMIN}/${poll.pollId}`, comms)).status).toBe(404);
  });
});
