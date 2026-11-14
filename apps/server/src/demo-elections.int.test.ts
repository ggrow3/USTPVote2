import { newSalt } from 'ustp-audit';
import {
  ACT_AS_HEADER,
  DEFAULT_NOTICE_SETTINGS,
  randomBallot,
  seededRandom,
  voterPersonaLabel,
  type BallotView,
  type DemoElectionResult,
  type NoticeRecord,
  type OutboxMessageRecord,
  type PersonaSummary,
} from 'ustp-domain';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIL_TRANSPORT, type MailTransport } from './notifications/mail-transport.js';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { DEMO_REASON } from './personas/demo-elections.js';
import { ledgerTypes } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/**
 * Demo elections (design §10.4): one request makes a scheduled rehearsal through the ordinary services, it mails
 * nobody, it runs to certified results like any rehearsal and is deleted again, and only System Admins in testing mode
 * can make one.
 */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  process.env.TESTING_MODE = 'true';
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(async () => {
  await Promise.all([api.close(), worker.close()]);
  delete process.env.TESTING_MODE;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Member = User & { accountId: string };
let sa1: Member;
let personas: PersonaSummary[];
beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1] = await api.systemAdmins();
  personas = (await api.call('POST', '/v1/testing/personas', sa1, {})).body;
  const bylaws = { version: '2026.1', title: 'USTP Bylaws', text: 'Article I. Name.\n' };
  expect((await api.call('POST', '/v1/admin/bylaws', sa1, bylaws, as('Test Membership Admin'))).status).toBe(201);
});

const db = () => api.firebase.db;
const idOf = (label: string) => personas.find((p) => p.label === label)!.accountId;
const as = (label: string) => ({ [ACT_AS_HEADER]: idOf(label) });
const call = (label: string, method: 'GET' | 'POST', url: string, body?: unknown) => api.call(method, url, sa1, body, as(label));
const createDemo = (body: object = {}, user: User = sa1, headers?: Record<string, string>) =>
  api.call('POST', '/v1/testing/demo-elections', user, body, headers);

/** The api and worker go by `Date`; moving it on is how a demo reaches its opening and closing times. */
function travelTo(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(ms + 1000);
}

async function demo(body: object = {}): Promise<DemoElectionResult> {
  const res = await createDemo(body);
  expect(res.status).toBe(201);
  personas = (await api.call('GET', '/v1/testing/personas', sa1)).body;
  return res.body;
}

/** One random ballot, cast by a test voter through the ballot endpoint. */
async function vote(electionId: string, n: number) {
  const view = (await call(voterPersonaLabel(n), 'GET', `/v1/elections/${electionId}/ballot`)).body as BallotView;
  const parts = randomBallot(view.definition, seededRandom(`voter-${n}`), 0).map((s) => ({ v: 1 as const, electionId, ...s, salt: newSalt() }));
  const cast = await call(voterPersonaLabel(n), 'POST', `/v1/elections/${electionId}/ballots`, { definitionHash: view.definitionHash, parts });
  expect(cast.status).toBe(201);
}

const outbox = async (electionId: string) =>
  (await db().collection('notice_outbox').where('electionId', '==', electionId).get()).docs.map((d) => d.data() as OutboxMessageRecord);
const notice = async (electionId: string, kind: string) =>
  (await db().collection('notices').doc(`${electionId}_${kind}`).get()).data() as NoticeRecord | undefined;
const entries = async (electionId: string, type: string) =>
  (await db().collection('audit_events').where('subject', '==', electionId).where('type', '==', type).get()).docs.map((d) => d.data());

describe('a demo election', () => {
  it('is scheduled at once: imported by the Test Election Admin, its rehearsal roll and schedule approved by the Test Auditor', async () => {
    const { seed, election: detail } = await demo({ votingMinutes: 30 });
    const { election } = detail;
    expect(seed).toMatch(/^[0-9a-f]{16}$/);
    expect(election.state).toBe('scheduled');
    expect(election.title).toMatch(/^\[Demo\] /);
    expect(election.description).toContain('demonstration election');
    expect(election.createdBy).toBe(idOf('Test Election Admin'));
    expect(Date.parse(election.opensAt) - Date.parse(election.createdAt)).toBe(60_000);
    expect(Date.parse(election.closesAt) - Date.parse(election.opensAt)).toBe(30 * 60_000);
    // Five test voters were added, and the roll is theirs alone.
    expect(personas.filter((p) => p.kind === 'voter').map((p) => [p.label, p.memberStatus])).toEqual(
      [1, 2, 3, 4, 5].map((n) => [voterPersonaLabel(n), 'active']),
    );
    expect(detail.roll).toMatchObject({ status: 'approved', count: 5, criteria: { status: 'active', testVotersOnly: true } });
    expect(detail.pending).toEqual([]);
    expect(detail.contests.every((c) => !c.positionId)).toBe(true);
    expect(detail.candidates.every((k) => k.accountId === null)).toBe(true);

    // The ledger records it as any rehearsal: the requests by the Test Election Admin, the decisions by the Test Auditor.
    expect(await ledgerTypes(api, election.electionId)).toEqual([
      'approval.requested',
      'approval.decided',
      'roll.approved',
      'approval.requested',
      'approval.decided',
      'election.scheduled',
    ]);
    const [rollApproved] = await entries(election.electionId, 'roll.approved');
    expect(rollApproved).toMatchObject({ actor: idOf('Test Auditor'), payload: { criteria: { testVotersOnly: true }, count: 5 } });
    for (const e of await entries(election.electionId, 'approval.requested')) {
      expect(e).toMatchObject({ actor: idOf('Test Election Admin'), payload: { reason: DEMO_REASON } });
    }

    // Another demo reuses the voters, and the same seed makes the same ballot.
    const again = (await demo({ seed })).election;
    expect(personas.filter((p) => p.kind === 'voter')).toHaveLength(5);
    expect(again.election.title).toBe(election.title);
    expect(again.contests.map((c) => [c.title, c.spec.kind])).toEqual(detail.contests.map((c) => [c.title, c.spec.kind]));
    const candidates = (d: typeof detail) => d.candidates.map((k) => `${k.name}: ${k.statement}`).sort();
    expect(candidates(again)).toEqual(candidates(detail));
  });

  it('mails nobody: its notices go to the outbox, addressed to nobody, and the mail transport is never used', async () => {
    const transport = worker.app.get<MailTransport>(MAIL_TRANSPORT);
    const sent = vi.spyOn(transport, 'send');
    // A reminder an hour before the close, so a two-hour demo gets one.
    const settings = { ...DEFAULT_NOTICE_SETTINGS, allEmails: true, reminderHours: 1 };
    expect((await api.call('PUT', '/v1/admin/notice-settings', sa1, { basedOn: 0, ...settings })).status).toBe(200);
    worker.app.get(NoticeSettingsService).invalidate();

    const { electionId, opensAt, closesAt } = (await demo({ votingMinutes: 120, secrecy: 'secret' })).election.election;
    await worker.tick();
    travelTo(Date.parse(opensAt));
    expect((await worker.tick()).body).toMatchObject({ electionsOpened: 1, noticesSent: 5 });
    expect(await notice(electionId, 'voting_open')).toMatchObject({ delivery: 'outbox', rehearsal: true, status: 'done', recipients: 5 });

    await vote(electionId, 1);
    travelTo(Date.parse(closesAt) - 59 * 60_000);
    // The reminder to the four who have not voted, and the voter's confirmation.
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 5 });
    expect(await notice(electionId, 'closing_soon')).toMatchObject({ delivery: 'outbox', rehearsal: true, status: 'done', recipients: 4 });

    const messages = await outbox(electionId);
    expect(messages.map((m) => m.subject.split(':')[0]).sort()).toEqual([
      ...Array(4).fill('Voting closes soon'),
      ...Array(5).fill('Voting is open'),
      'Your vote was recorded',
    ]);
    expect(messages.every((m) => m.to === null)).toBe(true);
    expect(sent).not.toHaveBeenCalled();
    for (const e of await entries(electionId, 'notice.sent')) expect(e.payload).toMatchObject({ delivery: 'outbox' });
  });

  it('runs to certified results like any rehearsal, and is deleted again with its ballots', async () => {
    // Five minutes, so the certification and the deletion still come within 15 minutes of signing in.
    const { electionId, opensAt, closesAt, title } = (await demo({ votingMinutes: 5 })).election.election;
    const url = `/v1/admin/elections/${electionId}`;
    await worker.tick();
    travelTo(Date.parse(opensAt));
    await worker.tick();
    for (const n of [1, 2, 3, 4]) await vote(electionId, n);

    travelTo(Date.parse(closesAt));
    const resultsUrl = `/v1/public/elections/${electionId}/results`;
    for (let i = 0; i < 4 && (await api.call('GET', resultsUrl)).status !== 200; i++) await worker.tick();
    const results = await api.call('GET', resultsUrl);
    expect(results.status).toBe(200);
    expect(results.body.bundle.participationCount).toBe(4);

    const certify = await call('Test Election Admin', 'POST', `${url}/certify`, { reason: 'demo over' });
    expect((await call('Test Auditor', 'POST', `/v1/admin/approvals/${certify.body.id}/decision`, { decision: 'approve', reason: 'ok' })).body.status).toBe('executed');
    expect((await call('Test Election Admin', 'GET', url)).body).toMatchObject({ election: { state: 'certified' }, ballotsCast: 4, officeTerms: 0 });
    await worker.tick(); // destroys the ballot-pool key, which deletion waits for

    expect((await call('Test Election Admin', 'POST', `${url}/delete`, { reason: 'demo over' })).status).toBe(204);
    expect((await api.call('GET', `/v1/public/elections/${electionId}`)).status).toBe(404);
    expect(await outbox(electionId)).toEqual([]);
    const [deleted] = await entries(electionId, 'election.deleted');
    expect(deleted!.payload).toEqual({ electionId, title, reason: 'demo over', rehearsal: true, ballotsCast: 4 });
    expect(title).toMatch(/^\[Demo\] /);
  });

  it('is made with no bylaws in force too, its test voters joining on none', async () => {
    await resetEmulators();
    [sa1] = await api.systemAdmins();
    const res = await createDemo();
    expect(res.status).toBe(201);
    const voters = (await db().collection('testing_personas').where('kind', '==', 'voter').get()).docs.map((d) => d.id);
    expect(voters).toHaveLength(5);
    const members = await Promise.all(voters.map(async (id) => (await db().collection('members').doc(id).get()).data()));
    expect(members.map((m) => m?.bylawsVersion)).toEqual([null, null, null, null, null]);
  });

  it('asks for a fresh sign-in before it writes anything, as the approvals it makes would', async () => {
    travelTo(Date.now() + 16 * 60_000);
    const res = await createDemo();
    expect(res).toMatchObject({ status: 403, body: { type: expect.stringMatching(/reauth/) } });
    expect((await db().collection('elections').get()).empty).toBe(true);
  });

  it('is made by a Site Admin too, ledgered as theirs', async () => {
    const site = await api.member('site@example.test');
    await api.grant(site.accountId, 'site_admin', sa1);
    const res = await createDemo({}, site);
    expect(res.status).toBe(201);
    const scheduled = await entries(res.body.election.election.electionId, 'election.scheduled');
    expect(scheduled).toHaveLength(1);
  });

  it('is made by System and Site Admins only: not by other admins, members or anyone acting as a persona', async () => {
    const pat = await api.member('pat@example.test');
    const ea = await api.member('ea@example.test');
    await api.grant(ea.accountId, 'election_admin', sa1);
    expect((await createDemo({}, pat)).status).toBe(403);
    expect((await createDemo({}, ea)).status).toBe(403);
    expect((await createDemo({}, sa1, as('Test Election Admin'))).status).toBe(403);
    expect((await api.call('POST', '/v1/testing/demo-elections')).status).toBe(401);
    expect((await createDemo({ votingMinutes: 2 })).status).toBe(400);
    expect((await db().collection('elections').get()).empty).toBe(true);
  });
});

describe('with testing mode off', () => {
  let off: TestApi;
  beforeAll(async () => {
    delete process.env.TESTING_MODE;
    off = await TestApi.start();
  });
  afterAll(async () => {
    await off.close();
    process.env.TESTING_MODE = 'true';
  });

  it('does not exist, whatever is sent', async () => {
    for (const body of [{}, { votingMinutes: 2 }, { opens: 'later' }]) {
      expect((await off.call('POST', '/v1/testing/demo-elections', sa1, body)).status).toBe(404);
    }
    expect((await db().collection('elections').get()).empty).toBe(true);
  });
});
