import type { MyReferrals, ReferralLeaderboard, VisitSourceRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PageVisitsService } from './security/page-visits.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

/**
 * Referral links and the team leaderboard (design §5.17), and where visitors came from (§10.7): a member's link names
 * them on the application of someone who came by it, credited once the application is approved; arrivals are counted
 * by referring site and campaign tags, naming nobody.
 */

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa: Member;
let admin: Member;
let bylaws: { version: string; contentHash: string };

const application = (referralCode?: string) => ({
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
  ...(referralCode !== undefined && { referralCode }),
});

beforeEach(async () => {
  await resetEmulators();
  api.app.get(PageVisitsService).forget();
  [sa] = await api.systemAdmins();
  admin = await api.member('membership.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa);
  const published = await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'USTP Bylaws', text: 'Article I. Name.\n' });
  expect(published.status).toBe(201);
  bylaws = published.body;
});

async function apply(email: string, code?: string): Promise<{ who: Member; applicationId: string }> {
  const who = await api.member(email);
  const res = await api.call('POST', '/v1/registration/applications', who, application(code));
  expect(res.status).toBe(201);
  return { who, applicationId: res.body.applicationId };
}
const decide = (applicationId: string, decision: 'approve' | 'reject') =>
  api.call('POST', `/v1/admin/applications/${applicationId}/decision`, admin, { decision, reason: 'reviewed' });

/** An Active member, as approving their application makes them. */
async function activeMember(email: string, code?: string): Promise<Member> {
  const { who, applicationId } = await apply(email, code);
  expect((await decide(applicationId, 'approve')).status).toBe(201);
  return who;
}
const mine = async (who: User) => (await api.call('GET', '/v1/me/referrals', who)).body as MyReferrals;

async function team(teamId: string, lead: Member, ...members: Member[]): Promise<void> {
  const created = await api.call('POST', '/v1/admin/teams', admin, {
    teamId,
    name: teamId[0]!.toUpperCase() + teamId.slice(1),
    description: 'Working together',
    joinPolicy: 'approval',
    joinQuestion: 'Which city are you in?',
    capacity: null,
    memberLink: 'https://discord.gg/team',
    color: 'blue',
    icon: 'campaign',
    leadAccountId: lead.accountId,
  });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  for (const m of members) {
    const added = await api.call('POST', `/v1/admin/teams/${teamId}/members`, admin, { accountId: m.accountId, role: 'member' });
    expect(added.status, JSON.stringify(added.body)).toBeLessThan(300);
  }
}

describe('referral links (design §5.17)', () => {
  it('are for Active members, made once, and lead to the Register page', async () => {
    const applicant = await api.member('applicant@example.test');
    expect(await mine(applicant)).toEqual({ eligible: false, code: null, link: null, joined: 0, waiting: 0 });
    const ada = await activeMember('ada@example.test');
    const first = await mine(ada);
    expect(first.eligible).toBe(true);
    expect(first.code).toMatch(/^[a-z2-9]{8}$/);
    expect(first.link).toMatch(new RegExp(`/register\\?ref=${first.code}$`));
    expect((await mine(ada)).code).toBe(first.code);
    expect((await api.firebase.db.collection('referral_codes').doc(first.code!).get()).data()).toMatchObject({ accountId: ada.accountId });
  });

  it('name the member on an application that came by their link, credited only when it is approved', async () => {
    const ada = await activeMember('ada@example.test');
    const { code } = await mine(ada);
    const robin = await apply('robin@example.test', code!);
    const sam = await apply('sam@example.test', code!);
    await apply('lee@example.test', 'nobodyss');
    await apply('kim@example.test', 'not a code');
    const stored = (await api.firebase.db.collection('applications').doc(robin.applicationId).get()).data();
    expect(stored).toMatchObject({ referredBy: ada.accountId });
    expect(await mine(ada)).toMatchObject({ joined: 0, waiting: 2 });

    expect((await decide(robin.applicationId, 'approve')).status).toBe(201);
    expect((await decide(sam.applicationId, 'reject')).status).toBe(201);
    expect(await mine(ada)).toMatchObject({ joined: 1, waiting: 0 });
    // Nobody else's counts are anyone's to see, and the applicant's own link never counts for them.
    const robinsOwn = (await mine(robin.who)).code!;
    const again = await api.call('POST', '/v1/registration/applications', robin.who, application(robinsOwn));
    expect(again.status).toBe(409);
  });

  it('rank teams for Active members by the people their members brought in', async () => {
    const ada = await activeMember('ada@example.test');
    const bo = await activeMember('bo@example.test');
    const cy = await activeMember('cy@example.test');
    await team('outreach', ada, bo);
    await team('media', cy);
    const adaCode = (await mine(ada)).code!;
    const boCode = (await mine(bo)).code!;
    await activeMember('p1@example.test', adaCode);
    await activeMember('p2@example.test', adaCode);
    await activeMember('p3@example.test', boCode);
    await apply('p4@example.test', boCode);

    const board = (await api.call('GET', '/v1/referrals/leaderboard?days=30', cy)).body as ReferralLeaderboard;
    expect(board.joined).toBe(3);
    expect(board.teams.map((t) => [t.teamId, t.joined, t.rank, t.mine])).toEqual([
      ['outreach', 3, 1, false],
      ['media', 0, 2, true],
    ]);
    expect(JSON.stringify(board)).not.toContain(ada.accountId);
    expect((await api.call('GET', '/v1/referrals/leaderboard', admin)).status).toBe(200);
    const outsider = await api.member('outsider@example.test');
    expect((await api.call('GET', '/v1/referrals/leaderboard', outsider)).status).toBe(403);
  });
});

describe('where visitors came from (design §10.7)', () => {
  const sources = async () => (await api.firebase.db.collection('visit_sources').get()).docs.map((d) => d.data() as VisitSourceRecord);
  const arrive = (path: string, from: Record<string, unknown>, user?: User) =>
    user ? api.call('POST', '/v1/page-visits', user, { path, from }) : api.call('POST', '/v1/public/page-visits', undefined, { path, from });

  it('counts arrivals by host and tags, naming nobody even when signed in, and reports them', async () => {
    const pat = await api.member('pat@example.test');
    expect((await arrive('/news', { referrer: 'www.Facebook.com', source: 'Facebook', medium: 'social', campaign: 'Spring' })).status).toBe(204);
    expect((await arrive('/news', { referrer: 'facebook.com', source: 'facebook', medium: 'social', campaign: 'spring' }, pat)).status).toBe(204);
    expect((await arrive('/register', { referral: true })).status).toBe(204);
    expect((await arrive('/', {})).status).toBe(204);
    expect((await arrive('/', { referrer: 'localhost', source: 'x<y>' })).status).toBe(204);
    expect((await api.call('POST', '/v1/public/page-visits', undefined, { path: '/news' })).status).toBe(204);

    const records = await sources();
    expect(records.reduce((n, r) => n + r.count, 0)).toBe(5);
    const facebook = records.find((r) => r.referrer === 'facebook.com')!;
    expect(facebook).toMatchObject({ page: 'news', source: 'facebook', medium: 'social', campaign: 'spring', referral: false, count: 2 });
    expect(JSON.stringify(records)).not.toContain(pat.accountId);
    expect(records.find((r) => r.source === 'x_y_')).toMatchObject({ referrer: null });

    const report = await api.call('GET', '/v1/admin/page-visits?days=7', sa);
    expect(report.body.sources).toMatchObject({
      arrivals: 5,
      fromSites: 2,
      withCampaign: 3,
      byReferralLink: 1,
      direct: 1,
      sites: [{ host: 'facebook.com', arrivals: 2 }],
    });
  });
});
