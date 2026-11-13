import { DEFAULT_FIRST_STEPS, type FirstStepSetting } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let admin: Member;
let ada: Member;

const db = () => api.firebase.db;
const ledger = async () => (await db().collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());
const put = (by: User | undefined, steps: readonly unknown[], basedOn = 0) => api.call('PUT', '/v1/admin/first-steps', by, { basedOn, steps });
const mine = (by: User | undefined) => api.call('GET', '/v1/me/first-steps', by);
const tick = (by: User | undefined, id: string, done: unknown) => api.call('PUT', `/v1/me/first-steps/${id}`, by, { done });

const [course, team] = DEFAULT_FIRST_STEPS.steps as [FirstStepSetting, FirstStepSetting];
const bylaws: FirstStepSetting = { id: 'bylaws', label: 'Read the bylaws', why: 'How the party is run.', link: '/bylaws', check: 'self' };
const social: FirstStepSetting = { id: 'social', label: 'Follow the party', why: '', link: 'https://example.org/ustp', check: 'self' };

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  admin = await api.member('membership.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1);
  ada = await api.member('ada@example.test');
  await db().collection('members').doc(ada.accountId).set({ accountId: ada.accountId, status: 'active', memberSince: '2026-11-01T00:00:00.000Z' });
});

describe('the getting started list’s settings (design §5.16)', () => {
  it('start as the default list', async () => {
    expect((await api.call('GET', '/v1/admin/first-steps', admin)).body).toEqual({ ...DEFAULT_FIRST_STEPS, version: 0, updatedAt: null, updatedBy: null });
    expect((await mine(ada)).body).toEqual({ memberSince: '2026-11-01T00:00:00.000Z', done: [], steps: DEFAULT_FIRST_STEPS.steps, ticked: [] });
  });

  it('are read and changed by Membership Admins only', async () => {
    const site = await api.member('site@example.test');
    await api.grant(site.accountId, 'site_admin', sa1);
    for (const who of [sa1, site, ada]) {
      expect((await api.call('GET', '/v1/admin/first-steps', who)).status).toBe(403);
      expect((await put(who, [bylaws])).status).toBe(403);
    }
    expect((await put(undefined, [bylaws])).status).toBe(401);
    expect((await mine(ada)).body.steps).toEqual(DEFAULT_FIRST_STEPS.steps);
  });

  it('save the steps tidied, ledger the whole list, and show members the new list', async () => {
    const res = await put(admin, [{ ...bylaws, label: '  Read  the\n bylaws ', link: ' /bylaws ' }, { ...team, label: 'Find your team' }, social]);
    const steps = [bylaws, { ...team, label: 'Find your team' }, social];
    expect(res).toMatchObject({ status: 200, body: { steps, version: 1, updatedBy: admin.accountId, updatedAt: expect.any(String) } });
    expect((await ledger()).at(-1)).toMatchObject({ type: 'first_steps.changed', actor: admin.accountId, subject: null, payload: { version: 1, steps } });
    expect((await mine(ada)).body).toMatchObject({ steps, done: [], ticked: [] });

    // The same list again is no change: no new version and nothing ledgered.
    const entries = (await ledger()).length;
    expect((await put(admin, steps, 1)).body.version).toBe(1);
    expect(await ledger()).toHaveLength(entries);
  });

  it('refuse an edit made from an older copy', async () => {
    expect((await put(admin, [bylaws])).status).toBe(200);
    expect(await put(admin, [social])).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/someone else changed/) } });
    expect((await put(admin, [social], 1)).body).toMatchObject({ version: 2, steps: [social] });
  });

  it('refuse steps that break a rule', async () => {
    const refused = async (steps: readonly unknown[]) => (await put(admin, steps)).body.detail as string;
    expect(await refused([course, { ...course, id: 'course-2' }])).toMatch(/both ticked when they start a course/);
    expect(await refused([{ ...bylaws, link: 'javascript:alert(1)' }])).toMatch(/Step 1: use a page on this site/);
    expect(await refused([{ ...bylaws, link: '//evil.example' }])).toMatch(/Step 1: use a page on this site/);
    expect(await refused([{ ...bylaws, label: ' ' }])).toBe('Step 1 needs its words');
    expect(await refused(Array.from({ length: 11 }, (_, i) => ({ ...bylaws, id: `s${i}` })))).toBe('list at most 10 steps');
    expect((await put(admin, [{ ...bylaws, check: 'teleport' }])).status).toBe(400);
    expect((await put(admin, [{ ...bylaws, extra: true }])).status).toBe(400);
    expect((await api.call('GET', '/v1/admin/first-steps', admin)).body.version).toBe(0);
  });

  it('may have no steps, and then members have no list', async () => {
    expect((await put(admin, [])).body).toMatchObject({ version: 1, steps: [] });
    expect((await mine(ada)).body).toEqual({ memberSince: '2026-11-01T00:00:00.000Z', done: [], steps: [], ticked: [] });
  });
});

describe('a member ticking their own steps', () => {
  beforeEach(async () => {
    expect((await put(admin, [bylaws, course, social])).status).toBe(200);
  });

  it('ticks and unticks a step the member ticks themselves, kept for them alone', async () => {
    const ben = await api.member('ben@example.test');
    await db().collection('members').doc(ben.accountId).set({ accountId: ben.accountId, status: 'active', memberSince: '2026-11-02T00:00:00.000Z' });
    const entries = (await ledger()).length;

    expect(await tick(ada, 'bylaws', true)).toMatchObject({ status: 200, body: { ticked: ['bylaws'] } });
    expect((await tick(ada, 'social', true)).body.ticked).toEqual(['bylaws', 'social']);
    expect((await tick(ada, 'bylaws', false)).body.ticked).toEqual(['social']);
    expect((await mine(ada)).body.ticked).toEqual(['social']);
    expect((await mine(ben)).body.ticked).toEqual([]);
    // Nothing a member ticks is ledgered.
    expect(await ledger()).toHaveLength(entries);
  });

  it('forgets a tick once its step leaves the list, and never ticks a step the site checks', async () => {
    await tick(ada, 'social', true);
    expect((await put(admin, [bylaws, course], 1)).status).toBe(200);
    expect((await mine(ada)).body.ticked).toEqual([]);
    expect(await tick(ada, 'course', true)).toMatchObject({ status: 409, body: { detail: 'the site ticks this step once you have done it' } });
    expect((await tick(ada, 'social', true)).status).toBe(404);
    expect((await tick(ada, 'Not_An_Id', true)).status).toBe(404);
    expect((await tick(ada, 'bylaws', 'yes')).status).toBe(400);
  });

  it('is for Active members only', async () => {
    const applicant = await api.member('applicant@example.test');
    expect((await tick(applicant, 'bylaws', true)).status).toBe(403);
    await db().collection('members').doc(applicant.accountId).set({ accountId: applicant.accountId, status: 'suspended' });
    expect((await tick(applicant, 'bylaws', true)).status).toBe(403);
    expect((await tick(undefined, 'bylaws', true)).status).toBe(401);
  });
});
