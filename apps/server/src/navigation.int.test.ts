import { Collections, DEFAULT_NAVIGATION, type NavigationSettings } from 'ustp-domain';
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
      s.menu.signed_out.signin = false;
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
          { audience: 'signed_out', link: 'signin', shown: false },
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

  it('refuse a section the API does not let that role use, hiding guarded sections, and stranding visitors', async () => {
    const forbidden = await put(sa1, edit((s) => (s.sections.election_admin.members = true)));
    expect(forbidden).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/does not let that role use it/) } });
    const lockOut = await put(sa1, edit((s) => (s.sections.system_admin.navigation = false)));
    expect(lockOut).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/lock them out/) } });
    const hiddenStart = await put(sa1, edit((s) => ((s.menu.active.verify = false), (s.startsOn.active = 'verify'))));
    expect(hiddenStart).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/not shown to them/) } });
    const signedIn = await put(sa1, edit((s) => (s.menu.active.signin = true)));
    expect(signedIn).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/they are signed in/) } });
    const stranded = await put(
      sa1,
      edit((s) => {
        for (const link of ['signin', 'register', 'ballot', 'admin']) s.menu.signed_out[link] = false;
      }),
    );
    expect(stranded).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/need a way to sign in/) } });
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

  it('give a link added since the settings were saved its default, keeping what was saved', async () => {
    const older = edit((s) => {
      for (const audience of Object.keys(s.menu)) delete s.menu[audience].offices;
      s.menu.applicant.ballot = false;
    });
    await api.firebase.db
      .collection(Collections.navigation)
      .doc('current')
      .set({ ...older, version: 2, updatedAt: '2026-10-26T00:00:00.000Z', updatedBy: sa1.accountId });
    api.app.get(NavigationService).invalidate();
    const resolved = edit((s) => (s.menu.applicant.ballot = false));
    expect((await api.call('GET', '/v1/navigation')).body).toEqual({ ...resolved, version: 2 });

    const offices = !DEFAULT_NAVIGATION.menu.signed_out.offices;
    const res = await put(sa1, edit((s) => (s.menu.signed_out.offices = offices), resolved), 2);
    expect(res.body).toMatchObject({ version: 3, menu: { signed_out: { offices }, applicant: { ballot: false } } });
    expect((await ledger()).at(-1)!.payload.changes).toEqual([{ audience: 'signed_out', link: 'offices', shown: offices }]);
  });

  it('let a role hide a link from the people who hold it, ledgered with the cell', async () => {
    const settings = edit((s) => {
      s.hiddenFrom.system_admin.register = true;
      s.menu.election_admin.ballot = false;
      s.hiddenFrom.election_admin.ballot = true;
    });
    const res = await put(sa1, settings);
    expect(res).toMatchObject({ status: 200, body: { version: 1, hiddenFrom: { system_admin: { register: true }, election_admin: { ballot: true } } } });
    expect((await api.call('GET', '/v1/navigation')).body).toEqual({ ...settings, version: 1 });
    expect((await ledger()).at(-1)!.payload.changes).toEqual([
      { audience: 'election_admin', link: 'ballot', shown: false, hidden: true },
      { audience: 'system_admin', link: 'register', shown: false, hidden: true },
    ]);

    const back = await put(sa1, edit((s) => (s.hiddenFrom.system_admin.register = false), settings), 1);
    expect(back.body).toMatchObject({ version: 2, hiddenFrom: { system_admin: { register: false } } });
    expect((await ledger()).at(-1)!.payload.changes).toEqual([{ audience: 'system_admin', link: 'register', shown: false, hidden: false }]);
  });

  it("refuse hiding a role's Admin link or Sign in, or a link both shown to and hidden from the role", async () => {
    const admin = await put(sa1, edit((s) => (s.hiddenFrom.auditor.admin = true)));
    expect(admin).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/follows its sections/) } });
    const signIn = await put(sa1, edit((s) => (s.hiddenFrom.auditor.signin = true)));
    expect(signIn).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/visitors only/) } });
    const both = await put(sa1, edit((s) => (s.hiddenFrom.election_admin.ballot = true)));
    expect(both).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/both shown to and hidden from/) } });
    expect((await api.call('GET', '/v1/navigation')).body.version).toBe(0);
  });

  it('read settings saved before roles could hide links as hiding none, and keep hidden links a save leaves out', async () => {
    const { hiddenFrom: _, ...older } = edit((s) => (s.menu.applicant.ballot = false));
    await api.firebase.db
      .collection(Collections.navigation)
      .doc('current')
      .set({ ...older, version: 4, updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: sa1.accountId });
    api.app.get(NavigationService).invalidate();
    const resolved = edit((s) => (s.menu.applicant.ballot = false));
    expect((await api.call('GET', '/v1/navigation')).body).toEqual({ ...resolved, version: 4 });

    const hidden = edit((s) => (s.hiddenFrom.system_admin.register = true), resolved);
    expect((await put(sa1, hidden, 4)).body.version).toBe(5);
    // A page opened before roles could hide links sends none: the saved ones stay, unless it shows one to the role.
    const fromOlderPage = (change: (s: any) => void) => {
      const { hiddenFrom: _h, ...rest } = edit(change, hidden);
      return rest;
    };
    const res = await api.call('PUT', '/v1/admin/navigation', sa1, { basedOn: 5, ...fromOlderPage((s) => (s.menu.lapsed.ballot = false)) });
    expect(res.body).toMatchObject({ version: 6, hiddenFrom: { system_admin: { register: true } }, menu: { lapsed: { ballot: false } } });
    const showsIt = fromOlderPage((s) => {
      s.menu.lapsed.ballot = false;
      s.menu.system_admin.register = true;
    });
    const shown = await api.call('PUT', '/v1/admin/navigation', sa1, { basedOn: 6, ...showsIt });
    expect(shown.body).toMatchObject({ version: 7, hiddenFrom: { system_admin: { register: false } }, menu: { system_admin: { register: true } } });
    expect((await ledger()).at(-1)!.payload.changes).toEqual([{ audience: 'system_admin', link: 'register', shown: true, hidden: false }]);
  });

  it('validate the body: every audience and cell, and the version it was edited from', async () => {
    const { applicant: _, ...menu } = DEFAULT_NAVIGATION.menu;
    expect((await api.call('PUT', '/v1/admin/navigation', sa1, { basedOn: 0, ...DEFAULT_NAVIGATION, menu })).status).toBe(400);
    expect((await api.call('PUT', '/v1/admin/navigation', sa1, { ...DEFAULT_NAVIGATION })).status).toBe(400);
  });
});
