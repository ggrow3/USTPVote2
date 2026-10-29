import { setTimeout as sleep } from 'node:timers/promises';
import { Timestamp } from 'firebase-admin/firestore';
import { SIGN_IN_RETENTION_DAYS, type SignInLog } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignInLogService } from './security/sign-in-log.js';
import { SiteAnalyticsService } from './security/site-analytics.js';
import { resetEmulators, signIn, TestApi, type User } from './testing/emulator.js';

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
  api.app.get(SignInLogService).forget();
  api.app.get(SiteAnalyticsService).invalidate();
  [sa1, sa2] = await api.systemAdmins();
});

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const signInsOf = async (uid: string): Promise<Record<string, unknown>[]> =>
  (await api.firebase.db.collection('sign_ins').where('uid', '==', uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ledger = async () => (await api.firebase.db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());

describe('the sign-in log (design §10.7)', () => {
  it('records each sign-in once, with the address the proxies reported and the browser', async () => {
    const lee = await api.user('lee@example.test');
    const headers = { 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 35.191.0.1', 'user-agent': CHROME };
    for (let i = 0; i < 3; i++) expect((await api.call('GET', '/v1/me', lee, undefined, headers)).status).toBe(200);

    const records = await signInsOf(lee.uid);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record).toMatchObject({
      accountId: null,
      email: 'lee@example.test',
      provider: 'password',
      mfa: false,
      ip: '198.51.100.7',
      forwardedFor: ['6.6.6.6', '198.51.100.7', '35.191.0.1'],
      userAgent: CHROME,
    });
    expect(record.id).toMatch(new RegExp(`^${lee.uid}_\\d+$`));
    const days = ((record.expireAt as Timestamp).toMillis() - Date.parse(record.seenAt as string)) / 86_400_000;
    expect(days).toBeCloseTo(SIGN_IN_RETENTION_DAYS, 3);
  });

  it('records a new sign-in, with the account it belongs to, when the person signs in again', async () => {
    const pat = await api.member('pat@example.test');
    await sleep(1100); // auth_time is in whole seconds
    const again = { ...pat, token: await signIn(pat.email) };
    expect((await api.call('GET', '/v1/me', again)).status).toBe(200);
    const records = await signInsOf(pat.uid);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.accountId).sort()).toEqual([null, pat.accountId].sort());
  });

  it('records second-factor sign-ins as such, even before an approval is asked for', async () => {
    const kim = await api.member('kim@example.test', { mfa: true });
    expect(await signInsOf(kim.uid)).toMatchObject([{ mfa: true }]);
  });

  it('is read by System Admins and Auditors only, newest first', async () => {
    const aud = await api.member('aud@example.test');
    await api.grant(aud.accountId, 'auditor', sa1);
    const pat = await api.member('pat@example.test');
    await api.grant(pat.accountId, 'membership_admin', sa1);

    const read = (by: User | undefined, days?: number) =>
      api.call('GET', `/v1/admin/security/sign-ins${days === undefined ? '' : `?days=${days}`}`, by);
    expect((await read(pat)).status).toBe(403);
    expect((await read(undefined)).status).toBe(401);

    const asAdmin = await read(sa2, 7);
    expect(asAdmin.status).toBe(200);
    const log = asAdmin.body as SignInLog;
    expect(log).toMatchObject({ days: 7, truncated: false });
    expect(log.signIns.map((s) => s.email)).toEqual(expect.arrayContaining(['sa1@example.test', 'sa2@example.test', 'aud@example.test', 'pat@example.test']));
    const seen = log.signIns.map((s) => s.seenAt);
    expect(seen).toEqual([...seen].sort().reverse());
    expect(log.signIns[0]).not.toHaveProperty('expireAt');

    // Recorded before their accounts existed (POST /v1/accounts was their first request), read with the account they have.
    expect(log.signIns.find((s) => s.email === 'pat@example.test')?.accountId).toBe(pat.accountId);
    const asAuditor = await read(aud, 12345);
    expect(asAuditor).toMatchObject({ status: 200, body: { days: 30 } });
  });

  it('never enters the ledger', async () => {
    await api.member('lee@example.test');
    expect((await ledger()).map((e) => e.type)).not.toContain('sign_in');
    expect(JSON.stringify(await ledger())).not.toContain('forwardedFor');
  });
});

describe('site analytics (design §10.7)', () => {
  const put = (by: User | undefined, measurementId: string | null, basedOn = 0) =>
    api.call('PUT', '/v1/admin/site-analytics', by, { basedOn, measurementId });

  it('is off until a System Admin sets a measurement ID, which anyone may read', async () => {
    expect((await api.call('GET', '/v1/site-analytics')).body).toEqual({ measurementId: null, version: 0 });
    const res = await put(sa1, ' g-abc123xyz9 ');
    expect(res).toMatchObject({ status: 200, body: { measurementId: 'G-ABC123XYZ9', version: 1, updatedBy: sa1.accountId } });
    expect((await api.call('GET', '/v1/site-analytics')).body).toEqual({ measurementId: 'G-ABC123XYZ9', version: 1 });
    expect((await ledger()).filter((e) => e.type === 'analytics.changed')).toMatchObject([
      { actor: sa1.accountId, payload: { version: 1, measurementId: 'G-ABC123XYZ9' } },
    ]);
  });

  it('is changed by System Admins only, from the version they saw, and switched off with null', async () => {
    const aud = await api.member('aud@example.test');
    await api.grant(aud.accountId, 'auditor', sa1);
    expect((await put(aud, 'G-ABC123XYZ9')).status).toBe(403);
    expect((await put(undefined, 'G-ABC123XYZ9')).status).toBe(401);
    expect((await put(sa1, 'UA-1234-1')).status).toBe(400);
    expect((await put(sa1, 'G-ABC123XYZ9')).status).toBe(200);
    expect((await put(sa2, null, 0)).status).toBe(409);
    expect((await put(sa2, null, 1)).body).toMatchObject({ measurementId: null, version: 2 });
    expect((await api.call('GET', '/v1/site-analytics')).body).toEqual({ measurementId: null, version: 2 });
  });
});
