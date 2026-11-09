import type { AccountRecord, LedgerEntry, MailMessageRecord, MemberImportRow, OutboxMessageRecord, WelcomeEmailRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addEmulatorMailEvent, sesEventBody } from './notifications/mail-transport.js';
import { resetEmulators, signIn, TestApi, TestWorker, type User } from './testing/emulator.js';

/**
 * Members a Membership Admin adds (design §5.13): one on the form or many from a file, Active at once with no login,
 * welcomed by email, and theirs once they sign in with a verified address.
 */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let admin: Member;
let systemAdmin: Member;

beforeEach(async () => {
  await resetEmulators();
  const [sa1] = await api.systemAdmins();
  systemAdmin = sa1;
  admin = await api.member('membership.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1);
  const published = await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'USTP Bylaws', text: 'Article I. Name.\n' });
  expect(published.status).toBe(201);
});

const db = () => api.firebase.db;
const account = async (accountId: string) => (await db().collection('accounts').doc(accountId).get()).data() as AccountRecord;
const welcome = async (accountId: string) => (await db().collection('welcome_emails').doc(accountId).get()).data() as WelcomeEmailRecord | undefined;
const ledger = async (type: string, subject: string) =>
  (await db().collection('audit_events').where('type', '==', type).where('subject', '==', subject).get()).docs.map((d) => d.data() as LedgerEntry);
const ada = { email: 'Ada@Example.test', legalName: 'Ada Lovelace', preferredName: 'Ada', state: 'NY', city: 'Albany', postalCode: '12207' };
const add = (body: object, as: User = admin) => api.call('POST', '/v1/admin/members', as, body);

describe('adding one member', () => {
  it('makes an Active member with an account that has no login, and queues the welcome email', async () => {
    const res = await add({ ...ada, reason: 'Joined at the convention' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ added: [{ line: 1, email: 'ada@example.test', legalName: 'Ada Lovelace' }], skipped: [], welcome: 'mail' });
    const { accountId } = res.body.added[0];

    expect(await account(accountId)).toMatchObject({
      primaryEmail: 'ada@example.test',
      emailVerified: false,
      displayName: 'Ada',
      addedBy: admin.accountId,
      claimedAt: null,
    });
    expect((await db().collection('account_identities').where('accountId', '==', accountId).get()).size).toBe(0);
    const profile = await api.call('GET', `/v1/admin/members/${accountId}`, admin);
    expect(profile.body).toMatchObject({
      member: { status: 'active', legalName: 'Ada Lovelace', state: 'NY', contact: { city: 'Albany', postalCode: '12207' }, communications: null, bylawsVersion: '2026.1' },
      history: [{ from: null, to: 'active', reason: 'Joined at the convention', actor: admin.accountId }],
      added: { by: admin.accountId, signedInAt: null, welcome: { status: 'pending', outcome: null } },
    });
    expect(await ledger('member.status_changed', accountId)).toMatchObject([
      { actor: admin.accountId, payload: { from: null, to: 'active', reason: 'Joined at the convention', applicationId: null } },
    ]);
    expect(await welcome(accountId)).toMatchObject({ status: 'pending', requestedBy: admin.accountId });
  });

  it('records a member living abroad by country', async () => {
    const res = await add({ email: 'eve@example.test', legalName: 'Eve', country: 'Germany', postalCode: '10115', usVoteEligible: 'no', reason: 'Roster' });
    expect(res.status).toBe(201);
    const profile = await api.call('GET', `/v1/admin/members/${res.body.added[0].accountId}`, admin);
    expect(profile.body.member).toMatchObject({ country: 'DE', state: null, region: null, contact: { city: null, postalCode: '10115' }, usVoteEligible: false, agreesWithCoreIdeals: null });
  });

  it('refuses bad fields by name, an address already on the site, and anyone but a Membership Admin', async () => {
    const bad = await add({ email: 'nope', legalName: '', state: 'Ontario', reason: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e: { path: string }) => e.path)).toEqual(['email', 'legalName', 'state']);
    expect((await add({ ...ada })).status).toBe(400); // no reason

    expect((await add({ ...ada, reason: 'x' })).status).toBe(201);
    const twice = await add({ ...ada, reason: 'x' });
    expect(twice).toMatchObject({ status: 409, body: { detail: 'ada@example.test already added, and has not set a password yet' } });
    // The admin has a login and no membership, so cannot add themselves.
    const self = await add({ ...ada, email: 'membership.admin@example.test', reason: 'x' });
    expect(self).toMatchObject({ status: 409, body: { detail: expect.stringContaining('already has a login on the site') } });

    const someone = await api.member('someone@example.test');
    expect((await add({ ...ada, email: 'x@example.test', reason: 'x' }, someone)).status).toBe(403);
  });

  it('needs published bylaws', async () => {
    await resetEmulators();
    const [sa1] = await api.systemAdmins();
    admin = await api.member('membership.admin@example.test');
    await api.grant(admin.accountId, 'membership_admin', sa1);
    expect(await add({ ...ada, reason: 'x' })).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/publish the bylaws/) } });
  });
});

describe('importing a file', () => {
  const rows = (): MemberImportRow[] => [
    { line: 2, email: 'one@example.test', legalName: 'One', state: 'CA' },
    { line: 3, email: 'ONE@example.test', legalName: 'One again', state: 'CA' },
    { line: 4, email: 'two', legalName: 'Two', state: 'CA' },
    { line: 5, email: 'three@example.test', legalName: '', state: '' },
    { line: 6, email: 'membership.admin@example.test', legalName: 'Admin', state: 'CA' },
    { line: 7, email: 'four@example.test', legalName: 'Four', country: 'Canada' },
  ];

  it('previews each row as added or skipped with its reasons, writing nothing', async () => {
    const before = (await db().collection('accounts').get()).size;
    const res = await api.call('POST', '/v1/admin/member-imports/preview', admin, { rows: rows() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ adding: 2, skipping: 4, skippedBy: { missing: 1, bad_email: 1, invalid: 0, duplicate: 1, on_site: 1 } });
    expect(res.body.rows.map((r: { line: number; add: boolean; reasons: string[] }) => [r.line, r.add, r.reasons])).toEqual([
      [2, true, []],
      [3, false, ['the same email address as row 2']],
      [4, false, ['"two" is not an email address']],
      [5, false, ['no legal name', 'no state, or country for a member living outside the US']],
      [6, false, ['already has a login on the site, so they apply on the Register page']],
      [7, true, []],
    ]);
    expect((await db().collection('accounts').get()).size).toBe(before);
  });

  it('adds the rows the preview adds, in parts, and skips an address that signed up since', async () => {
    const many: MemberImportRow[] = Array.from({ length: 30 }, (_, i) => ({ line: i + 2, email: `m${i}@example.test`, legalName: `Member ${i}`, state: 'TX' }));
    await api.member('m5@example.test');
    const res = await api.call('POST', '/v1/admin/member-imports', admin, { rows: many, reason: '2026 roster' });
    expect(res.status).toBe(201);
    expect(res.body.added).toHaveLength(29);
    expect(res.body.skipped).toEqual([
      { line: 7, email: 'm5@example.test', legalName: 'Member 5', reasons: ['already has a login on the site, so they apply on the Register page'], cause: 'on_site' },
    ]);
    expect(res.body.skippedBy).toEqual({ missing: 0, bad_email: 0, invalid: 0, duplicate: 0, on_site: 1 });
    const active = await db().collection('members').where('status', '==', 'active').get();
    expect(active.size).toBe(29);
  });

  it('says how many it added and skipped, and why, the same as the preview', async () => {
    const preview = await api.call('POST', '/v1/admin/member-imports/preview', admin, { rows: rows() });
    const res = await api.call('POST', '/v1/admin/member-imports', admin, { rows: rows(), reason: 'Roster' });
    expect(res.status).toBe(201);
    expect(res.body.added.map((a: { line: number }) => a.line)).toEqual([2, 7]);
    expect(res.body.skipped.map((s: { line: number; cause: string }) => [s.line, s.cause])).toEqual([
      [3, 'duplicate'],
      [4, 'bad_email'],
      [5, 'missing'],
      [6, 'on_site'],
    ]);
    expect(res.body.skippedBy).toEqual(preview.body.skippedBy);
    expect(res.body.added.length).toBe(preview.body.adding);
    expect(res.body.skipped.length).toBe(preview.body.skipping);
  });

  it('needs a reason, and at most 500 rows', async () => {
    expect((await api.call('POST', '/v1/admin/member-imports', admin, { rows: rows() })).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ line: i + 2, email: `x${i}@example.test`, legalName: 'X', state: 'NY' }));
    expect((await api.call('POST', '/v1/admin/member-imports/preview', admin, { rows: tooMany })).status).toBe(400);
  });
});

describe('the added member signs in', () => {
  let added: string;
  beforeEach(async () => {
    added = (await add({ ...ada, reason: 'Roster' })).body.added[0].accountId;
  });

  it('gets the added account once the address is verified, and no account before', async () => {
    const unverified = await api.user('ada@example.test', { emailVerified: false });
    const refused = await api.call('POST', '/v1/accounts', unverified);
    expect(refused).toMatchObject({ status: 403, body: { detail: expect.stringMatching(/Confirm the address first/) } });
    expect((await db().collection('account_identities').doc(unverified.uid).get()).exists).toBe(false);
    expect((await db().collection('accounts').where('primaryEmail', '==', 'ada@example.test').get()).size).toBe(1);

    await api.firebase.auth.updateUser(unverified.uid, { emailVerified: true });
    const verified = { ...unverified, token: await signIn('ada@example.test') };
    const claimed = await api.call('POST', '/v1/accounts', verified);
    expect(claimed).toMatchObject({ status: 200, body: { created: false, accountId: added, claimed: true } });
    expect(await account(added)).toMatchObject({ emailVerified: true, claimedAt: expect.any(String), displayName: 'Ada' });
    expect(await ledger('identity.linked', added)).toMatchObject([{ actor: added, payload: { uid: unverified.uid, provider: 'password', claimed: true } }]);

    const me = await api.call('GET', '/v1/me', verified);
    expect(me.body).toMatchObject({ account: { accountId: added }, member: { status: 'active', legalName: 'Ada Lovelace' } });
    // Signing in again is the ordinary path.
    expect((await api.call('POST', '/v1/accounts', verified)).body).toEqual({ created: false, accountId: added });
    expect((await api.call('GET', `/v1/admin/members/${added}`, admin)).body.added.signedInAt).toEqual(expect.any(String));
  });

  it('is welcomed by the worker, once, unless signed in meanwhile', async () => {
    expect((await worker.tick()).body).toMatchObject({ welcomeEmailsSent: 1 });
    const outbox = (await db().collection('notice_outbox').where('accountId', '==', added).get()).docs.map((d) => d.data() as OutboxMessageRecord);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: 'ada@example.test', subject: 'Welcome to the US Transhumanist Party: set your password' });
    expect(outbox[0]!.text).toContain('Hello Ada,');
    expect(outbox[0]!.text).toContain('http://localhost:5173/set-password');
    expect(await welcome(added)).toMatchObject({ status: 'done', outcome: null, messageId: expect.any(String) });
    expect((await worker.tick()).body).toMatchObject({ welcomeEmailsSent: 0 });

    // Asked again: queued while the member has not signed in, refused while one is on its way.
    const again = await api.call('POST', `/v1/admin/members/${added}/welcome`, admin);
    expect(again).toMatchObject({ status: 200, body: { welcome: 'mail', email: 'ada@example.test' } });
    expect((await api.call('POST', `/v1/admin/members/${added}/welcome`, admin)).status).toBe(409);

    const ada2 = await api.user('ada@example.test');
    expect((await api.call('POST', '/v1/accounts', ada2)).body).toMatchObject({ claimed: true });
    expect((await worker.tick()).body).toMatchObject({ welcomeEmailsSent: 0 });
    expect(await welcome(added)).toMatchObject({ status: 'done', outcome: 'signed_in' });
    expect((await api.call('POST', `/v1/admin/members/${added}/welcome`, admin)).status).toBe(409);
  });

  it('can change their details abroad, keeping the country', async () => {
    const eve = (await add({ email: 'eve@example.test', legalName: 'Eve', country: 'GB', reason: 'Roster' })).body.added[0].accountId;
    const user = await api.user('eve@example.test');
    expect((await api.call('POST', '/v1/accounts', user)).body).toMatchObject({ accountId: eve, claimed: true });
    const changed = await api.call('POST', '/v1/me/details', user, {
      country: 'GB',
      city: 'London',
      postalCode: 'SW1A 1AA',
      newsletter: true,
      announcements: false,
    });
    expect(changed).toMatchObject({ status: 201, body: { country: 'GB', contact: { city: 'London', postalCode: 'SW1A 1AA' } } });
  });
});

describe('without mail', () => {
  const messagesTo = async (accountId: string) =>
    (await db().collection('mail_messages').where('accountId', '==', accountId).get()).docs.map((d) => d.data() as MailMessageRecord);
  /** Identity Platform's report of the sign-in link it sent through SES. */
  const report = (eventType: string, messageId: string, to: string, sentAt: string) =>
    addEmulatorMailEvent(db(), sesEventBody({ eventType, messageId, to, sentAt, at: new Date().toISOString(), tags: {}, subject: 'Sign in to USTP Vote requested at 10:04 AM' }));

  /** An api that sends no mail, so welcomes go as Identity Platform's sign-in links. */
  const withoutMail = async (run: (quiet: TestApi) => Promise<void>) => {
    process.env.MAIL_TRANSPORT = 'off';
    const quiet = await TestApi.start();
    try {
      await run(quiet);
    } finally {
      delete process.env.MAIL_TRANSPORT;
      await quiet.close();
    }
  };

  it('logs the sign-in link the admin’s browser had Identity Platform send, as the admin’s welcome', () =>
    withoutMail(async (quiet) => {
      const accountId = (await quiet.call('POST', '/v1/admin/members', admin, { ...ada, reason: 'Roster' })).body.added[0].accountId;
      expect(await messagesTo(accountId)).toEqual([]);

      expect((await quiet.call('POST', `/v1/admin/members/${accountId}/welcome-link`, admin)).status).toBe(204);
      const [logged] = await messagesTo(accountId);
      expect(logged).toMatchObject({ kind: 'welcome', sender: 'identity_platform', handOff: true, causedBy: admin.accountId, ref: accountId, status: 'sent', counted: false });
      expect(JSON.stringify(logged)).not.toContain('@');
      expect(await welcome(accountId)).toMatchObject({ via: 'identity_platform', status: 'done', outcome: null, requestedBy: admin.accountId, messageId: logged!.messageId, delivery: null });

      const log = await quiet.call('GET', `/v1/admin/mail/log?account=${accountId}`, systemAdmin);
      expect(log.body.rows).toEqual([
        expect.objectContaining({ kind: 'welcome', sender: 'identity_platform', handOff: true, causedBy: admin.accountId, accountEmail: 'ada@example.test' }),
      ]);
      expect((await quiet.call('GET', `/v1/admin/members/${accountId}`, admin)).body.added.welcome).toMatchObject({ via: 'identity_platform', status: 'done' });

      // Sending it again logs it again.
      expect((await quiet.call('POST', `/v1/admin/members/${accountId}/welcome-link`, admin)).status).toBe(204);
      expect(await messagesTo(accountId)).toHaveLength(2);
    }));

  it('is only for Membership Admins, and only of a member one added', () =>
    withoutMail(async (quiet) => {
      const accountId = (await quiet.call('POST', '/v1/admin/members', admin, { ...ada, reason: 'Roster' })).body.added[0].accountId;
      const ben = await quiet.member('ben@example.test');
      expect((await quiet.call('POST', `/v1/admin/members/${accountId}/welcome-link`, ben)).status).toBe(403);
      expect((await quiet.call('POST', `/v1/admin/members/${ben.accountId}/welcome-link`, admin)).status).toBe(404);
      expect((await quiet.call('POST', '/v1/admin/members/nobody/welcome-link', admin)).status).toBe(404);
      expect(await messagesTo(accountId)).toEqual([]);
    }));

  it('shows the link once when Identity Platform sends through SES, with its reports, whichever comes first', () =>
    withoutMail(async (quiet) => {
      const sentAt = new Date().toISOString();
      // The browser says so first, then the reports come.
      const first = (await quiet.call('POST', '/v1/admin/members', admin, { ...ada, reason: 'Roster' })).body.added[0].accountId;
      await quiet.call('POST', `/v1/admin/members/${first}/welcome-link`, admin);
      await report('Send', 'ses-1', 'ADA@example.test', sentAt);
      await report('Delivery', 'ses-1', 'ADA@example.test', sentAt);
      await worker.tick();
      expect(await messagesTo(first)).toEqual([
        expect.objectContaining({ messageId: 'ses-1', kind: 'welcome', sender: 'identity_platform', causedBy: admin.accountId, ref: first, status: 'delivered', counted: true }),
      ]);
      expect((await messagesTo(first))[0]).not.toHaveProperty('handOff');
      expect(await welcome(first)).toMatchObject({ messageId: 'ses-1', delivery: 'delivered', via: 'identity_platform' });

      // A report that came first is claimed by the browser's word.
      const second = (await quiet.call('POST', '/v1/admin/members', admin, { email: 'bea@example.test', legalName: 'Bea Ortiz', state: 'CA', reason: 'Roster' })).body.added[0].accountId;
      await report('Delivery', 'ses-2', 'bea@example.test', new Date().toISOString());
      await worker.tick();
      expect(await messagesTo(second)).toEqual([expect.objectContaining({ messageId: 'ses-2', kind: 'sign_in_link', causedBy: null })]);
      await quiet.call('POST', `/v1/admin/members/${second}/welcome-link`, admin);
      expect(await messagesTo(second)).toEqual([expect.objectContaining({ messageId: 'ses-2', kind: 'welcome', causedBy: admin.accountId, status: 'delivered' })]);
      expect(await welcome(second)).toMatchObject({ messageId: 'ses-2', delivery: 'delivered' });
      // The member asking for a link of their own later is theirs, not another welcome.
      await report('Delivery', 'ses-3', 'bea@example.test', new Date().toISOString());
      await worker.tick();
      expect((await messagesTo(second)).map((m) => [m.messageId, m.kind])).toEqual(expect.arrayContaining([['ses-2', 'welcome'], ['ses-3', 'sign_in_link']]));
    }));

  it('leaves the welcome to Identity Platform, queueing nothing', async () => {
    process.env.MAIL_TRANSPORT = 'off';
    const quiet = await TestApi.start();
    try {
      const res = await quiet.call('POST', '/v1/admin/members', admin, { ...ada, reason: 'Roster' });
      expect(res).toMatchObject({ status: 201, body: { welcome: 'identity_platform' } });
      const accountId = res.body.added[0].accountId;
      expect(await welcome(accountId)).toBeUndefined();
      expect((await quiet.call('POST', `/v1/admin/members/${accountId}/welcome`, admin)).body).toEqual({ welcome: 'identity_platform', email: 'ada@example.test' });
      expect(await welcome(accountId)).toBeUndefined();
    } finally {
      delete process.env.MAIL_TRANSPORT;
      await quiet.close();
    }
  });
});
