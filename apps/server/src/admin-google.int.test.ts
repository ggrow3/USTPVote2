import { PROBLEM_TYPES } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MfaPolicyService } from './auth/mfa-policy.js';
import { SignInMethodsService } from './auth/sign-in-methods.service.js';
import { resetEmulators, SA1_EMAIL, SA2_EMAIL, TestApi, type User } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetEmulators();
  api.app.get(MfaPolicyService).invalidate();
  api.app.get(SignInMethodsService).invalidate();
});

const put = (user: User, body: object) => api.call('PUT', '/v1/admin/mfa-policy', user, body);
const fresh = () => api.app.get(MfaPolicyService).invalidate();
const changeRole = (by: User, accountId: string, role: string) =>
  api.call('POST', '/v1/admin/roles', by, { accountId, role, change: 'grant', reason: 'test' });

describe('Google sign-in required of System and Site Admins (design §4)', () => {
  it('is off by default, and turned on only by a System Admin signed in with Google', async () => {
    const withPassword = await api.member(SA1_EMAIL);
    const withGoogle = await api.member(SA2_EMAIL, { google: true });
    expect((await api.call('GET', '/v1/admin/mfa-policy', withPassword)).body).toMatchObject({ adminsGoogleRequired: false, version: 0 });
    expect((await api.call('GET', '/v1/me', withPassword)).body.signIn).toEqual({ googleRequired: false });

    expect(await put(withPassword, { basedOn: 0, membersRequired: false, adminsGoogleRequired: true })).toMatchObject({
      status: 409,
      body: { detail: 'sign in with Google yourself before requiring it of System and Site Admins' },
    });
    const on = await put(withGoogle, { basedOn: 0, membersRequired: false, adminsGoogleRequired: true });
    expect(on).toMatchObject({ status: 200, body: { adminsGoogleRequired: true, siteAdminsRequired: true, version: 1 } });
    fresh();

    // The System Admin with a password: no admin tools, this setting included, but their own pages, which say why.
    const refused = { status: 403, body: { type: PROBLEM_TYPES.googleRequired, detail: 'System and Site Admins must sign in with Google' } };
    expect(await api.call('GET', '/v1/admin/accounts', withPassword)).toMatchObject(refused);
    expect(await put(withPassword, { basedOn: 1, membersRequired: false, adminsGoogleRequired: false })).toMatchObject(refused);
    expect((await api.call('GET', '/v1/me', withPassword)).body.signIn).toEqual({ googleRequired: true });
    expect((await api.call('GET', '/v1/admin/accounts', withGoogle)).status).toBe(200);
    expect((await api.call('GET', '/v1/me', withGoogle)).body.signIn).toEqual({ googleRequired: false });

    // A page opened before the setting existed leaves it as it is; it is ledgered with the rest.
    expect((await put(withGoogle, { basedOn: 1, membersRequired: false })).body).toMatchObject({ adminsGoogleRequired: true, version: 1 });
    expect((await put(withGoogle, { basedOn: 1, membersRequired: false, adminsGoogleRequired: false })).body).toMatchObject({
      adminsGoogleRequired: false,
      version: 2,
    });
    fresh();
    expect((await api.call('GET', '/v1/admin/accounts', withPassword)).status).toBe(200);
    const events = (await api.firebase.db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());
    expect(events.filter((e) => e.type === 'mfa_policy.changed').map((e) => e.payload)).toEqual([
      { version: 1, membersRequired: false, siteAdminsRequired: true, adminsGoogleRequired: true },
      { version: 2, membersRequired: false, siteAdminsRequired: true, adminsGoogleRequired: false },
    ]);
  });

  it('holds Site Admins too, grants those roles only to Google sign-ins, and leaves other admins alone', async () => {
    const sa = await api.member(SA1_EMAIL, { google: true });
    const site = await api.member('site@example.test');
    const pat = await api.member('pat@example.test');
    const gia = await api.member('gia@example.test', { google: true });
    await api.grant(site.accountId, 'site_admin', sa);
    await api.grant(pat.accountId, 'membership_admin', sa);
    expect((await put(sa, { basedOn: 0, membersRequired: false, adminsGoogleRequired: true })).status).toBe(200);
    fresh();

    // A Site Admin made before it was required, signed in with a password.
    expect((await api.call('GET', '/v1/admin/accounts', site)).body.type).toBe(PROBLEM_TYPES.googleRequired);
    // A Membership Admin is not asked.
    expect((await api.call('GET', '/v1/admin/members', pat)).status).toBe(200);
    expect((await api.call('GET', '/v1/me', pat)).body.signIn).toEqual({ googleRequired: false });

    for (const role of ['site_admin', 'system_admin']) {
      expect(await changeRole(sa, pat.accountId, role), role).toMatchObject({
        status: 409,
        body: { detail: `${role} is for accounts that sign in with Google, and this one has not: they sign in with Google once first` },
      });
    }
    expect((await changeRole(sa, pat.accountId, 'course_admin')).status).toBe(201);
    expect((await changeRole(sa, gia.accountId, 'site_admin')).status).toBe(201);
    expect((await api.call('GET', '/v1/admin/accounts', gia)).status).toBe(200);

    // Google sign-in is not switched off while admins need it.
    expect(await api.call('PUT', '/v1/admin/sign-in-methods', sa, { 'google.com': false })).toMatchObject({
      status: 409,
      body: { detail: 'Sign in with Google is required of System and Site Admins; stop requiring it before switching it off' },
    });
  });

  it('is not turned on while Google sign-in is switched off', async () => {
    const sa = await api.member(SA1_EMAIL);
    expect((await api.call('PUT', '/v1/admin/sign-in-methods', sa, { 'google.com': false })).status).toBe(200);
    expect(await put(sa, { basedOn: 0, membersRequired: false, adminsGoogleRequired: true })).toMatchObject({
      status: 409,
      body: { detail: 'Sign in with Google is switched off; switch it on before requiring it of admins' },
    });
  });
});

describe('adding a member who will be an admin (design §5.13)', () => {
  const ada = { email: 'ada@example.test', legalName: 'Ada Lovelace', state: 'NY', city: 'Albany', postalCode: '12207', reason: 'Roster' };

  it('says the welcome is Google only, and is refused while Google sign-in is switched off', async () => {
    const sa = await api.member(SA1_EMAIL);
    const admin = await api.member('ma@example.test');
    await api.grant(admin.accountId, 'membership_admin', sa);

    const added = await api.call('POST', '/v1/admin/members', admin, { ...ada, adminSignIn: true });
    expect(added).toMatchObject({ status: 201, body: { googleOnly: true, added: [{ email: ada.email }] } });
    const plain = await api.call('POST', '/v1/admin/members', admin, { ...ada, email: 'bo@example.test' });
    expect(plain.status).toBe(201);
    expect(plain.body).not.toHaveProperty('googleOnly');

    expect((await api.call('PUT', '/v1/admin/sign-in-methods', sa, { 'google.com': false })).status).toBe(200);
    expect(await api.call('POST', '/v1/admin/members', admin, { ...ada, email: 'cy@example.test', adminSignIn: true })).toMatchObject({
      status: 409,
      body: { detail: 'Sign in with Google is switched off, so nobody can be welcomed to sign in with it' },
    });
  });
});
