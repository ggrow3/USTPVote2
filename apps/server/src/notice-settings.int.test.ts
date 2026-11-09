import { DEFAULT_NOTICE_SETTINGS, type MyEmailView, type NoticeSettings, type OutboxMessageRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoticeSettingsService } from './notifications/notice-settings.js';
import { minutes, seedElection, type SeededElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/**
 * System Admins' settings for the site's emails (design §6.8): who may change them, and that the worker and the api follow
 * them: the election emails, and the switches for welcome and test emails.
 */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let electionAdmin: Member;
let voters: Member[];

beforeEach(async () => {
  await resetEmulators();
  for (const app of [api.app, worker.app]) app.get(NoticeSettingsService).invalidate();
  [sa1] = await api.systemAdmins();
  electionAdmin = await api.member('ea@example.test');
  await api.grant(electionAdmin.accountId, 'election_admin', sa1);
  voters = [];
  for (let i = 0; i < 3; i++) voters.push(await api.member(`v${i}@example.test`));
});

const URL = '/v1/admin/notice-settings';
const save = (settings: NoticeSettings, basedOn: number, as: User = sa1) => api.call('PUT', URL, as, { basedOn, ...settings });
/** The worker caches the settings for a minute, as another instance would; tests do not wait for that. */
const workerSees = () => worker.app.get(NoticeSettingsService).invalidate();
const outbox = async (e: SeededElection) =>
  (await api.firebase.db.collection('notice_outbox').where('electionId', '==', e.electionId).get()).docs.map((d) => d.data() as OutboxMessageRecord);
const noticeExists = async (e: SeededElection, kind: string) =>
  (await api.firebase.db.collection('notices').doc(`${e.electionId}_${kind}`).get()).exists;
const settingsOf = (over: Partial<NoticeSettings> & { votingOpen?: Partial<NoticeSettings['kinds']['voting_open']>; closingSoon?: Partial<NoticeSettings['kinds']['closing_soon']> }): NoticeSettings => {
  const { votingOpen, closingSoon, ...rest } = over;
  return {
    ...DEFAULT_NOTICE_SETTINGS,
    allEmails: true, // as `resetEmulators` leaves it; these tests are about what each setting does while email is on
    ...rest,
    kinds: {
      voting_open: { ...DEFAULT_NOTICE_SETTINGS.kinds.voting_open, ...votingOpen },
      closing_soon: { ...DEFAULT_NOTICE_SETTINGS.kinds.closing_soon, ...closingSoon },
      voted: DEFAULT_NOTICE_SETTINGS.kinds.voted,
    },
  };
};

describe('the election email settings', () => {
  it('are the defaults until a System Admin saves, and only a System Admin may read or change them', async () => {
    const read = await api.call('GET', URL, sa1);
    expect(read.status).toBe(200);
    // `resetEmulators` leaves email on; a new site's is off (mail-preferences.int.test.ts).
    expect(read.body).toEqual({ ...DEFAULT_NOTICE_SETTINGS, allEmails: true, version: 0, updatedAt: null, updatedBy: null });
    expect((await api.call('GET', URL, electionAdmin)).status).toBe(403);
    expect((await api.call('GET', URL, voters[0]!)).status).toBe(403);
    expect((await save(settingsOf({ reminderHours: 48 }), 0, electionAdmin)).status).toBe(403);
  });

  it('save every change in one version, ledger each with its old and new value, and refuse a stale or invalid save', async () => {
    const next = settingsOf({ reminderHours: 48, contact: 'elections@example.org', votingOpen: { subject: 'Time to vote: {title}' } });
    const saved = await save(next, 0);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ...next, version: 1, updatedBy: sa1.accountId });

    const entries = (await api.firebase.db.collection('audit_events').where('type', '==', 'notice.settings_changed').get()).docs.map((d) => d.data());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: sa1.accountId,
      payload: {
        version: 1,
        changes: [
          { field: 'voting_open.subject', from: null, to: 'Time to vote: {title}' },
          { field: 'reminderHours', from: 24, to: 48 },
          { field: 'contact', from: null, to: 'elections@example.org' },
        ],
      },
    });

    expect((await save(settingsOf({ reminderHours: 12 }), 0)).status).toBe(409); // edited from version 0
    expect((await save(settingsOf({ votingOpen: { intro: 'Hello {name}' } }), 1)).status).toBe(400);
    expect((await api.call('PUT', URL, sa1, { basedOn: 1, ...next, from: 'me@example.org' })).status).toBe(400);
    // Saving what is already there changes nothing and ledgers nothing.
    expect((await save(next, 1)).body.version).toBe(1);
    expect((await api.firebase.db.collection('audit_events').where('type', '==', 'notice.settings_changed').get()).size).toBe(1);
  });

  it('show in each election’s notices view, with the contact the emails will give', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    expect((await api.call('GET', `/v1/admin/elections/${election.electionId}/notices`, electionAdmin)).body).toMatchObject({
      contact: null,
      settings: { ...DEFAULT_NOTICE_SETTINGS, allEmails: true },
    });
    await save(settingsOf({ contact: 'https://transhumanist-party.org/contact/' }), 0);
    expect((await api.call('GET', `/v1/admin/elections/${election.electionId}/notices`, electionAdmin)).body).toMatchObject({
      contact: 'https://transhumanist-party.org/contact/',
      settings: { contact: 'https://transhumanist-party.org/contact/' },
    });
  });
});

describe('the other emails’ switches', () => {
  const off = { welcome: false, electionTests: false, memberTests: false };

  it('are on until a System Admin switches one off, each switch ledgered, and kept by a save that leaves them out', async () => {
    expect((await api.call('GET', URL, sa1)).body.emails).toEqual({ welcome: true, electionTests: true, memberTests: true });
    expect((await save(settingsOf({ emails: { ...DEFAULT_NOTICE_SETTINGS.emails, memberTests: false } }), 0)).status).toBe(200);
    const entries = (await api.firebase.db.collection('audit_events').where('type', '==', 'notice.settings_changed').get()).docs.map((d) => d.data());
    expect(entries[0]!.payload.changes).toEqual([{ field: 'emails.memberTests', from: true, to: false }]);

    // A page opened before the switches existed saves without them, and changes none.
    const { emails: _emails, ...older } = settingsOf({ reminderHours: 36 });
    const saved = await api.call('PUT', URL, sa1, { basedOn: 1, ...older });
    expect(saved.body).toMatchObject({ version: 2, reminderHours: 36, emails: { welcome: true, electionTests: true, memberTests: false } });
  });

  it('switched off, leave a Membership Admin’s new member to Identity Platform’s sign-in link', async () => {
    const membershipAdmin = await api.member('ma@example.test');
    await api.grant(membershipAdmin.accountId, 'membership_admin', sa1);
    await api.call('POST', '/v1/admin/bylaws', membershipAdmin, { version: '2026.1', title: 'USTP Bylaws', text: 'Article I. Name.\n' });
    await save(settingsOf({ emails: { ...DEFAULT_NOTICE_SETTINGS.emails, welcome: false } }), 0);

    const added = await api.call('POST', '/v1/admin/members', membershipAdmin, { email: 'ada@example.test', legalName: 'Ada Lovelace', state: 'NY', city: 'Albany', postalCode: '12207', reason: 'Roster' });
    expect(added).toMatchObject({ status: 201, body: { welcome: 'identity_platform' } });
    const accountId = added.body.added[0].accountId as string;
    const queued = async () => (await api.firebase.db.collection('welcome_emails').doc(accountId).get()).exists;
    expect(await queued()).toBe(false);
    const again = await api.call('POST', `/v1/admin/members/${accountId}/welcome`, membershipAdmin);
    expect(again.body).toEqual({ welcome: 'identity_platform', email: 'ada@example.test' });
    expect(await queued()).toBe(false);

    // Back on, asking again queues one for the worker.
    await save(settingsOf({}), 1);
    expect((await api.call('POST', `/v1/admin/members/${accountId}/welcome`, membershipAdmin)).body).toEqual({ welcome: 'mail', email: 'ada@example.test' });
    expect(await queued()).toBe(true);
  });

  it('switched off, refuse Election Admins’ test emails, and say so in the notices view', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId), state: 'scheduled', opensAt: minutes(60), closesAt: minutes(60 * 24 * 3) });
    const askTest = () => api.call('POST', `/v1/admin/elections/${election.electionId}/notices/voting_open/test`, electionAdmin);
    await save(settingsOf({ emails: { ...DEFAULT_NOTICE_SETTINGS.emails, electionTests: false } }), 0);

    const refused = await askTest();
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toMatch(/switched test emails off/);
    expect((await api.call('GET', `/v1/admin/elections/${election.electionId}/notices`, electionAdmin)).body.settings.emails.electionTests).toBe(false);
    expect((await api.firebase.db.collection('notice_tests').get()).size).toBe(0);

    await save(settingsOf({}), 1);
    expect((await askTest()).status).toBe(202);
  });

  it('switched off, refuse members’ test emails and retries, while one already asked for still goes', async () => {
    const ada = await api.member('ada@example.test');
    const mine = async () => (await api.call('GET', '/v1/me/email', ada)).body as MyEmailView;
    expect((await mine()).requestsEnabled).toBe(true);
    expect((await api.call('POST', '/v1/me/email/test', ada)).status).toBe(202);

    await save(settingsOf({ emails: off }), 0);
    workerSees();
    expect((await mine()).requestsEnabled).toBe(false);
    expect((await worker.tick()).body).toMatchObject({ memberEmailsSent: 1 });
    const refused = await api.call('POST', '/v1/me/email/test', ada);
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toMatch(/switched these emails off/);
    expect((await api.call('POST', '/v1/me/email/retry', ada)).status).toBe(409);
  });
});

describe('the worker', () => {
  it('sends neither email a System Admin switched off', async () => {
    await save(settingsOf({ votingOpen: { enabled: false }, closingSoon: { enabled: false } }), 0);
    workerSees();
    const election = await seedElection(api, {
      voters: voters.map((v) => v.accountId),
      state: 'open',
      secrecy: 'open',
      opensAt: minutes(-60 * 48),
      closesAt: minutes(60 * 23),
    });
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 0 });
    expect(await noticeExists(election, 'voting_open')).toBe(false);
    expect(await noticeExists(election, 'closing_soon')).toBe(false);
  });

  it('holds a notice already going out when it is switched off, and goes on when it is switched back on', async () => {
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId), state: 'open', secrecy: 'open' });
    await worker.app.get((await import('./notifications/notice-sender.js')).NoticeSender).sendDue(0); // prepared, nothing sent
    const off = await save(settingsOf({ votingOpen: { enabled: false } }), 0);
    workerSees();
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 0 });
    await save(settingsOf({}), off.body.version);
    workerSees();
    expect((await worker.tick()).body).toMatchObject({ noticesSent: 3 });
    expect(await outbox(election)).toHaveLength(3);
  });

  it('writes the System Admins’ subject, opening and contact, with the election filled in', async () => {
    await save(
      settingsOf({
        contact: 'elections@example.org',
        votingOpen: { subject: 'Time to vote: {title}', intro: 'The polls are open until {closes}.' },
      }),
      0,
    );
    workerSees();
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    await worker.tick();
    const [message] = await outbox(election);
    expect(message!.subject).toBe('Time to vote: Officers');
    expect(message!.text).toMatch(/^Hello,\n\nThe polls are open until \w+day, .+ \(Eastern Time\)\.\n\nVote by /);
    expect(message!.text).toContain('Replies to this email are not read; write to elections@example.org.');
    expect(message!.from).toBe('USTP Elections <noreply@transhumanist-party.org>');
  });

  it('sends from the name the System Admins set, at the deployment’s address, and keeps it when a page that predates it saves', async () => {
    const named = await save(settingsOf({ senderName: 'U.S. Transhumanist Party, Elections' }), 0);
    expect(named.body).toMatchObject({ version: 1, senderName: 'U.S. Transhumanist Party, Elections' });
    const entries = (await api.firebase.db.collection('audit_events').where('type', '==', 'notice.settings_changed').get()).docs.map((d) => d.data());
    expect(entries[0]!.payload.changes).toEqual([{ field: 'senderName', from: null, to: 'U.S. Transhumanist Party, Elections' }]);
    expect((await save(settingsOf({ senderName: 'Elections <boss@example.org>' }), 1)).status).toBe(400);
    const { senderName: _name, ...older } = settingsOf({ reminderHours: 36 });
    expect((await api.call('PUT', URL, sa1, { basedOn: 1, ...older })).body).toMatchObject({ version: 2, senderName: 'U.S. Transhumanist Party, Elections' });

    workerSees();
    const election = await seedElection(api, { voters: voters.map((v) => v.accountId) });
    await worker.tick();
    const messages = await outbox(election);
    expect(messages).toHaveLength(3);
    for (const m of messages) expect(m.from).toBe('"U.S. Transhumanist Party, Elections" <noreply@transhumanist-party.org>');

    // Emptied, the deployment's name is back.
    await save({ ...settingsOf({ reminderHours: 36 }), senderName: null }, 2);
    workerSees();
    const ada = await api.member('ada@example.test');
    expect((await api.call('POST', '/v1/me/email/test', ada)).status).toBe(202);
    await worker.tick();
    const test = (await api.firebase.db.collection('notice_outbox').where('accountId', '==', ada.accountId).get()).docs.map((d) => d.data() as OutboxMessageRecord);
    expect(test.map((m) => m.from)).toEqual(['USTP Elections <noreply@transhumanist-party.org>']);
  });

  it('reminds as long before the close as the System Admins set', async () => {
    await save(settingsOf({ reminderHours: 48 }), 0);
    workerSees();
    const election = await seedElection(api, {
      voters: voters.map((v) => v.accountId),
      state: 'open',
      secrecy: 'open',
      opensAt: minutes(-60 * 72),
      closesAt: minutes(60 * 47),
    });
    await worker.tick(); // voting is open
    await worker.tick(); // the reminder, due 48 hours before the close
    expect(await noticeExists(election, 'closing_soon')).toBe(true);
    expect((await outbox(election)).filter((m) => m.subject.startsWith('Voting closes soon'))).toHaveLength(3);
  });
});
