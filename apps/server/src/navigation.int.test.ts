import { DEFAULT_NAVIGATION, type NavigationSettings } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NavigationService } from './administration/navigation.js';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let sa2: Member;

beforeEach(async () => {
  await resetEmulators();
  api.app.get(NavigationService).invalidate();
  [sa1, sa2] = await api.systemAdmins();
});

function edit(change: (s: any) => void, base: NavigationSettings = DEFAULT_NAVIGATION): NavigationSettings {
  const copy = structuredClone(base) as any;
  change(copy);
  return copy;
}

const put = (by: User, settings: NavigationSettings, basedOn = 0) =>
  api.call('PUT', '/v1/admin/navigation', by, { basedOn, ...settings });
const ledger = async () => (await api.firebase.db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());

describe('navigation settings (design §10.5)', () => {
  it('start as the defaults, readable by anyone, with nothing saved', async () => {
    const res = await api.call('GET', '/v1/navigation');
    expect(res).toMatchObject({ status: 200, body: { ...DEFAULT_NAVIGATION, version: 0 } });
    expect(res.body).not.toHaveProperty('updatedBy');
    expect((await api.call('GET', '/v1/admin/navigation', sa1)).body).toEqual({
      ...DEFAULT_NAVIGATION,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('are changed by System Admins only', async () => {
    const pat = await api.member('pat@example.test');
    await api.grant(pat.accountId, 'membership_admin', sa1);
    const settings = edit((s) => (s.menu.applicant.ballot = false));
    expect((await put(pat, settings)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/navigation', pat)).status).toBe(403);
    expect((await api.call('PUT', '/v1/admin/navigation', undefined, { basedOn: 0, ...settings })).status).toBe(401);
    expect((await api.call('GET', '/v1/navigation')).body.version).toBe(0);
  });

  it('save the whole matrix, ledgering each changed cell with the admin as actor', async () => {
    const settings = edit((s) => {
      s.menu.applicant.ballot = false;
      s.sections.system_admin.offices = true;
      s.startsOn.active = 'ballot';
    });
    const res = await put(sa1, settings);
    expect(res).toMatchObject({ status: 200, body: { ...settings, version: 1, updatedBy: sa1.accountId } });
    expect((await api.call('GET', '/v1/navigation')).body).toEqual({ ...settings, version: 1 });

    const events = await ledger();
    expect(events.at(-1)).toMatchObject({
      type: 'navigation.changed',
      actor: sa1.accountId,
      subject: null,
      payload: {
        version: 1,
        changes: [
          { audience: 'applicant', link: 'ballot', shown: false },
          { audience: 'system_admin', section: 'offices', shown: true },
          { audience: 'active', startsOn: 'ballot' },
        ],
      },
    });
  });

  it('record nothing when nothing changed', async () => {
    const before = (await ledger()).length;
    expect((await put(sa1, DEFAULT_NAVIGATION)).body.version).toBe(0);
    expect(await ledger()).toHaveLength(before);
  });

  it("refuse an edit made from an older copy, so one admin does not undo another's", async () => {
    expect((await put(sa1, edit((s) => (s.menu.lapsed.ballot = false)))).body.version).toBe(1);
    const stale = await put(sa2, edit((s) => (s.menu.resigned.ballot = false)), 0);
    expect(stale).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/someone else changed/) } });
    expect((await api.call('GET', '/v1/navigation')).body.menu.lapsed.ballot).toBe(false);
  });

  it('refuse a section the API does not let that role use, and hiding guarded sections from System Admins', async () => {
    const forbidden = await put(sa1, edit((s) => (s.sections.election_admin.members = true)));
    expect(forbidden).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/does not let that role use it/) } });
    const lockOut = await put(sa1, edit((s) => (s.sections.system_admin.navigation = false)));
    expect(lockOut).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/lock them out/) } });
    const hiddenStart = await put(sa1, edit((s) => ((s.menu.active.verify = false), (s.startsOn.active = 'verify'))));
    expect(hiddenStart).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/not shown to them/) } });
    expect((await api.call('GET', '/v1/navigation')).body.version).toBe(0);
  });

  it("recompute a role's Admin link from its sections", async () => {
    const res = await put(
      sa1,
      edit((s) => {
        for (const section of Object.keys(s.sections.auditor)) s.sections.auditor[section] = false;
        s.menu.auditor.admin = true;
      }),
    );
    expect(res.body.menu.auditor.admin).toBe(false);
    expect((await ledger()).at(-1)!.payload.changes).toContainEqual({ audience: 'auditor', link: 'admin', shown: false });
  });

  it('validate the body: every audience and cell, and the version it was edited from', async () => {
    const { applicant: _, ...menu } = DEFAULT_NAVIGATION.menu;
    expect((await api.call('PUT', '/v1/admin/navigation', sa1, { basedOn: 0, ...DEFAULT_NAVIGATION, menu })).status).toBe(400);
    expect((await api.call('PUT', '/v1/admin/navigation', sa1, { ...DEFAULT_NAVIGATION })).status).toBe(400);
  });
});
