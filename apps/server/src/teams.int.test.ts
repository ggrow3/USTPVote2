import type { LedgerEntry, TeamDetail, TeamSummary } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let ma: Member;
let lea: Member;
let bo: Member;
let ada: Member;
let cy: Member;

/** Gives the account a member record with this status, as the membership context would. */
async function memberRecord(user: Member, legalName: string, status = 'active', preferredName: string | null = null) {
  await api.firebase.db
    .collection('members')
    .doc(user.accountId)
    .set({ accountId: user.accountId, status, legalName, preferredName, state: 'TX' });
}

const SETTINGS = {
  name: 'Outreach',
  description: 'Tabling, flyers and events',
  joinPolicy: 'approval',
  joinQuestion: 'Which city are you in?',
  capacity: null,
  memberLink: 'https://discord.gg/outreach',
  color: 'teal',
  icon: 'campaign',
};

const create = (by: User, body: Record<string, unknown> = {}) =>
  api.call('POST', '/v1/admin/teams', by, { ...SETTINGS, teamId: 'outreach', leadAccountId: lea.accountId, ...body });
const team = async (by: User, teamId = 'outreach') => (await api.call('GET', `/v1/teams/${teamId}`, by)).body as TeamDetail;
const join = (by: User, body: Record<string, unknown> = {}) => api.call('POST', '/v1/teams/outreach/join', by, body);
const decide = (by: User, accountId: string, decision: 'approve' | 'decline', note: string | null = null, admin = false) =>
  api.call('POST', `/v1/${admin ? 'admin/' : ''}teams/outreach/requests/${accountId}/decision`, by, { decision, note });

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  lea = await api.member('lea@example.test');
  bo = await api.member('bo@example.test');
  ada = await api.member('ada@example.test');
  cy = await api.member('cy@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await memberRecord(lea, 'Lea Ortiz');
  await memberRecord(bo, 'Robert Lee', 'active', 'Bo');
  await memberRecord(ada, 'Ada Brooks');
  await memberRecord(cy, 'Cy Park', 'applicant');
});

describe('creating teams', () => {
  it('a Membership Admin creates a team led by an Active member, ledgered', async () => {
    const res = await create(ma);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      team: { teamId: 'outreach', name: 'Outreach', version: 1, archived: false, createdBy: ma.accountId },
      members: 1,
      leads: [{ accountId: lea.accountId, name: 'Lea Ortiz' }],
      waiting: 0,
      roster: [{ accountId: lea.accountId, role: 'lead', name: 'Lea Ortiz', state: 'TX', active: true }],
    });
    expect((await entries('team.changed')).map((e) => [e.actor, e.subject, e.payload.change])).toEqual([[ma.accountId, 'outreach', 'created']]);
    expect((await entries('team.member_changed')).map((e) => [e.subject, e.payload])).toEqual([
      [lea.accountId, { teamId: 'outreach', change: 'added', role: 'lead' }],
    ]);
  });

  it('refuses anyone else, a lead who is not Active, a duplicate ID and bad settings', async () => {
    expect((await create(lea)).status).toBe(403);
    expect((await create(ma, { leadAccountId: cy.accountId })).status).toBe(409);
    expect((await create(ma)).status).toBe(201);
    expect((await create(ma)).status).toBe(409);
    const bad = await create(ma, { teamId: 'other', memberLink: 'http://example.com' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual([{ path: 'memberLink', message: 'use the https:// address' }]);
  });
});

describe('joining and leading', () => {
  beforeEach(async () => {
    expect((await create(ma)).status).toBe(201);
  });

  it('every Active member sees the teams and who is on them; others are refused', async () => {
    const list = (await api.call('GET', '/v1/teams', ada)).body as TeamSummary[];
    expect(list).toHaveLength(1);
    // Not on the team: no link, no requests.
    expect(list[0]).toMatchObject({ team: { memberLink: null }, members: 1, mine: { role: null, request: null }, waiting: null });
    expect((await team(lea)).team.memberLink).toBe('https://discord.gg/outreach');
    expect((await api.call('GET', '/v1/teams', cy)).status).toBe(403);
    expect((await api.call('GET', '/v1/teams/outreach', cy)).status).toBe(403);
    expect((await api.call('GET', '/v1/teams/nope', ada)).status).toBe(404);
  });

  it('ask to join with an answer; the lead approves; the member joins, ledgered', async () => {
    expect((await join(ada, { message: 'I can table' })).status).toBe(409); // the question needs an answer
    const asked = await join(ada, { message: 'I can table', answer: 'Austin' });
    expect(asked.status).toBe(201);
    expect(asked.body.mine.request).toMatchObject({ status: 'pending', question: 'Which city are you in?', answer: 'Austin' });
    expect((await join(ada, { answer: 'Austin' })).status).toBe(409); // already asked
    expect(await entries('team.member_changed')).toHaveLength(1); // a request is not ledgered

    // Members do not decide, leads do and see who waits.
    expect((await decide(bo, ada.accountId, 'approve')).status).toBe(403);
    const led = await team(lea);
    expect(led.requests).toEqual([expect.objectContaining({ accountId: ada.accountId, name: 'Ada Brooks', message: 'I can table' })]);
    expect((await team(bo)).requests).toBeNull();

    const approved = await decide(lea, ada.accountId, 'approve');
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ members: 2, waiting: 0, requests: [] });
    expect((await team(ada)).mine).toMatchObject({ role: 'member', request: { status: 'approved', decidedBy: lea.accountId } });
    const [, joined] = await entries('team.member_changed');
    expect(joined).toMatchObject({ actor: lea.accountId, subject: ada.accountId, payload: { change: 'joined', role: 'member' } });
  });

  it('a declined member waits two weeks; a withdrawn request can be made again', async () => {
    await join(ada, { answer: 'Austin' });
    const declined = await decide(lea, ada.accountId, 'decline', 'We are full this season');
    expect(declined.status).toBe(201);
    expect((await team(ada)).mine.request).toMatchObject({ status: 'declined', note: 'We are full this season' });
    expect((await join(ada, { answer: 'Austin' })).body.detail).toMatch(/you can ask again from/);

    await join(bo, { answer: 'Dallas' });
    expect((await api.call('DELETE', '/v1/teams/outreach/request', bo)).body.mine.request.status).toBe('withdrawn');
    expect((await join(bo, { answer: 'Dallas' })).status).toBe(201);
  });

  it('open teams take members at once; closed and full ones take nobody', async () => {
    const { name: _, ...settings } = SETTINGS;
    const put = async (changes: Record<string, unknown>) => {
      const version = (await team(lea)).team.version;
      return api.call('PUT', '/v1/teams/outreach', lea, { ...settings, ...changes, basedOn: version });
    };
    expect((await put({ joinPolicy: 'open', capacity: 2 })).status).toBe(200);
    const joined = await join(ada);
    expect(joined.body).toMatchObject({ members: 2, mine: { role: 'member' } });
    expect((await join(bo)).body.detail).toBe('the team is full');
    expect((await put({ joinPolicy: 'closed', capacity: null })).status).toBe(200);
    expect((await join(bo)).body.detail).toMatch(/not taking members/);
    // A lead keeps the name; a stale edit is refused.
    expect((await api.call('PUT', '/v1/teams/outreach', lea, { ...settings, name: 'Field', basedOn: 3 })).status).toBe(400);
    expect((await api.call('PUT', '/v1/teams/outreach', lea, { ...settings, basedOn: 1 })).status).toBe(409);
    expect((await api.call('PUT', '/v1/teams/outreach', ada, { ...settings, basedOn: 3 })).status).toBe(403);
    expect((await entries('team.changed')).map((e) => e.payload.fields)).toEqual([
      expect.any(Array),
      ['joinPolicy', 'capacity'],
      ['joinPolicy', 'capacity'],
    ]);
  });

  it('a lead makes a co-lead, then steps down; the last lead cannot leave', async () => {
    await join(bo, { answer: 'Dallas' });
    await decide(lea, bo.accountId, 'approve');
    expect((await api.call('POST', '/v1/teams/outreach/leave', lea)).status).toBe(409);
    expect((await api.call('POST', '/v1/teams/outreach/step-down', lea)).status).toBe(409);
    expect((await api.call('POST', `/v1/teams/outreach/members/${bo.accountId}/lead`, ada)).status).toBe(403);
    const made = await api.call('POST', `/v1/teams/outreach/members/${bo.accountId}/lead`, lea);
    expect(made.body.leads.map((l: { name: string }) => l.name)).toEqual(['Bo', 'Lea Ortiz']);
    // A lead does not remove another lead.
    expect((await api.call('DELETE', `/v1/teams/outreach/members/${bo.accountId}`, lea)).status).toBe(403);
    const stepped = await api.call('POST', '/v1/teams/outreach/step-down', lea);
    expect(stepped.body.mine.role).toBe('member');
    expect((await api.call('POST', '/v1/teams/outreach/leave', lea)).body.mine.role).toBeNull();
    // Bo, the only lead now, removes members but cannot leave.
    expect((await api.call('POST', '/v1/teams/outreach/leave', bo)).status).toBe(409);
    expect((await entries('team.member_changed')).map((e) => e.payload.change)).toEqual(['added', 'joined', 'made_lead', 'stepped_down', 'left']);
  });

  it('a lead removes a member; people no longer Active drop off the roster but leads still see them', async () => {
    await join(ada, { answer: 'Austin' });
    await decide(lea, ada.accountId, 'approve');
    await join(bo, { answer: 'Dallas' });
    await decide(lea, bo.accountId, 'approve');
    await memberRecord(bo, 'Robert Lee', 'lapsed', 'Bo');
    expect((await team(ada)).roster.map((p) => p.name)).toEqual(['Lea Ortiz', 'Ada Brooks']);
    expect((await team(ada)).members).toBe(2);
    expect((await team(lea)).roster.map((p) => [p.name, p.active])).toEqual([
      ['Lea Ortiz', true],
      ['Ada Brooks', true],
      ['Bo', false],
    ]);
    // Bo cannot act while lapsed.
    expect((await api.call('POST', '/v1/teams/outreach/leave', bo)).status).toBe(403);
    const removed = await api.call('DELETE', `/v1/teams/outreach/members/${bo.accountId}`, lea);
    expect(removed.body.roster.map((p: { name: string }) => p.name)).toEqual(['Lea Ortiz', 'Ada Brooks']);
    expect((await entries('team.member_changed')).at(-1)).toMatchObject({ actor: lea.accountId, subject: bo.accountId, payload: { change: 'removed' } });
  });
});

describe('Membership Admins', () => {
  beforeEach(async () => {
    expect((await create(ma)).status).toBe(201);
  });

  it('add anyone Active as a lead or member, change roles, and decide requests', async () => {
    await join(ada, { answer: 'Austin' });
    // Adding someone who asked closes their request.
    const added = await api.call('POST', '/v1/admin/teams/outreach/members', ma, { accountId: ada.accountId, role: 'member' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ members: 2, waiting: 0 });
    expect((await team(ada)).mine.request).toMatchObject({ status: 'approved', decidedBy: ma.accountId });
    expect((await api.call('POST', '/v1/admin/teams/outreach/members', ma, { accountId: cy.accountId, role: 'member' })).status).toBe(409);
    const lead = await api.call('POST', '/v1/admin/teams/outreach/members', ma, { accountId: ada.accountId, role: 'lead' });
    expect(lead.body.leads).toHaveLength(2);
    // Taking the lead from Lea, then removing her.
    expect((await api.call('POST', '/v1/admin/teams/outreach/members', ma, { accountId: lea.accountId, role: 'member' })).status).toBe(201);
    expect((await api.call('DELETE', `/v1/admin/teams/outreach/members/${lea.accountId}`, ma)).status).toBe(200);
    // Ada is the last lead now.
    expect((await api.call('DELETE', `/v1/admin/teams/outreach/members/${ada.accountId}`, ma)).status).toBe(409);
    await join(bo, { answer: 'Dallas' });
    expect((await decide(ma, bo.accountId, 'approve', null, true)).body.members).toBe(2);
  });

  it('rename, archive and restore; an archived team is hidden from members and takes nobody', async () => {
    const detail = (await api.call('GET', '/v1/admin/teams/outreach', ma)).body as TeamDetail;
    const renamed = await api.call('PUT', '/v1/admin/teams/outreach', ma, { ...SETTINGS, name: 'Field outreach', basedOn: detail.team.version });
    expect(renamed.body.team).toMatchObject({ name: 'Field outreach', version: 2 });
    expect((await api.call('POST', '/v1/admin/teams/outreach/archive', ma, { archived: true })).body.team.archived).toBe(true);
    expect((await api.call('GET', '/v1/teams', ada)).body).toEqual([]);
    expect((await api.call('GET', '/v1/teams/outreach', lea)).status).toBe(404);
    expect((await join(ada, { answer: 'Austin' })).status).toBe(404);
    expect((await api.call('GET', '/v1/admin/teams', ma)).body).toHaveLength(1);
    expect((await api.call('POST', '/v1/admin/teams/outreach/archive', ma, { archived: false })).body.team.archived).toBe(false);
    expect((await api.call('GET', '/v1/teams', ada)).body).toHaveLength(1);
    expect((await entries('team.changed')).map((e) => e.payload.change)).toEqual(['created', 'updated', 'archived', 'restored']);
    // Leads cannot use the admin routes.
    expect((await api.call('POST', '/v1/admin/teams/outreach/archive', lea, { archived: true })).status).toBe(403);
  });
});
