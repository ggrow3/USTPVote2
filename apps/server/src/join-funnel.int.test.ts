import type { JoinFunnelReport } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let admin: Member;
let bylaws: { version: string; contentHash: string };

const application = () => ({
  bylawsVersion: bylaws.version,
  bylawsHash: bylaws.contentHash,
  legalName: 'Robin Applicant',
  dateOfBirth: '1990-04-01',
  attestsAge: true,
  formVersion: 0,
  usVoteEligible: true,
  agreesWithCoreIdeals: true,
  state: 'CA',
  city: 'San Francisco',
  postalCode: '94110',
});

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  admin = await api.member('membership.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1);
  const published = await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'USTP Bylaws', text: 'Article I. Name.\n' });
  expect(published.status).toBe(201);
  bylaws = published.body;
});

async function apply(email: string): Promise<{ who: Member; applicationId: string }> {
  const who = await api.member(email);
  const res = await api.call('POST', '/v1/registration/applications', who, application());
  expect(res.status).toBe(201);
  return { who, applicationId: res.body.applicationId };
}
const decide = (applicationId: string, decision: 'approve' | 'reject') =>
  api.call('POST', `/v1/admin/applications/${applicationId}/decision`, admin, { decision, reason: 'reviewed' });

describe('the join funnel', () => {
  it("counts the period's accounts through each step, and names nobody", async () => {
    // The two System Admins and the Membership Admin are accounts of the period too: three who never applied.
    await api.member('looked.only@example.test');
    await apply('waiting@example.test');
    const refused = await apply('refused@example.test');
    expect((await decide(refused.applicationId, 'reject')).status).toBe(201);
    const quiet = await apply('quiet.member@example.test');
    expect((await decide(quiet.applicationId, 'approve')).status).toBe(201);
    const busy = await apply('busy.member@example.test');
    expect((await decide(busy.applicationId, 'approve')).status).toBe(201);
    await api.firebase.db.collection('course_progress').doc(`intro_${busy.who.accountId}`).set({ courseId: 'intro', accountId: busy.who.accountId });
    await api.firebase.db.collection('team_members').doc(`t1_${busy.who.accountId}`).set({ teamId: 't1', accountId: busy.who.accountId });
    for (let i = 0; i < 3; i++) expect((await api.call('POST', '/v1/public/page-visits', undefined, { path: '/register' })).status).toBeLessThan(300);

    const res = await api.call('GET', '/v1/admin/join-funnel?days=7', admin);
    expect(res.status).toBe(200);
    const report = res.body as JoinFunnelReport;
    expect(report.steps.map((s) => [s.id, s.count])).toEqual([
      ['account', 8],
      ['verified', 8],
      ['applied', 4],
      ['approved', 2],
      ['active', 1],
    ]);
    expect(report).toMatchObject({ days: 7, registerOpens: 3, registerOpensSignedIn: 0, waiting: 1, rejected: 1, oldestWaitingDays: 0, truncated: false });
    expect(report.firstSteps).toEqual({ voted: 0, course: 1, team: 1, room: 0, posted: 0 });
    expect(report.medianDaysToDecision).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(/example\.test|Robin|[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('leaves out members a Membership Admin added, and is for Membership Admins only', async () => {
    const added = await api.call('POST', '/v1/admin/members', admin, { email: 'ada@example.test', legalName: 'Ada Lovelace', state: 'NY', city: 'Albany', postalCode: '12207', reason: 'Roster' });
    expect(added.status).toBeLessThan(300);
    const report = (await api.call('GET', '/v1/admin/join-funnel', admin)).body as JoinFunnelReport;
    expect(report.days).toBe(30);
    expect(report.steps[0]).toMatchObject({ id: 'account', count: 3 });
    const outsider = await api.member('outsider@example.test');
    expect((await api.call('GET', '/v1/admin/join-funnel', outsider)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/join-funnel')).status).toBe(401);
  });
});

describe('a new member’s first steps', () => {
  it('are the member’s own, ticked from the records, and empty for someone who is not a member', async () => {
    const applicant = await apply('applicant@example.test');
    expect((await api.call('GET', '/v1/me/first-steps', applicant.who)).body).toEqual({ memberSince: null, done: [] });

    expect((await decide(applicant.applicationId, 'approve')).status).toBe(201);
    const fresh = await api.call('GET', '/v1/me/first-steps', applicant.who);
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual({ memberSince: expect.any(String), done: [] });

    await api.firebase.db.collection('course_progress').doc(`intro_${applicant.who.accountId}`).set({ courseId: 'intro', accountId: applicant.who.accountId });
    await api.firebase.db.collection('forum_comments').doc('c1').set({ commentId: 'c1', authorId: applicant.who.accountId });
    expect((await api.call('GET', '/v1/me/first-steps', applicant.who)).body.done.sort()).toEqual(['course', 'posted']);
    expect((await api.call('GET', '/v1/me/first-steps')).status).toBe(401);
  });
});
