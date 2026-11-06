import { mailAddressKey, type MemberMailFlag, type MyEmailView } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** A member's own email, and the Membership Admins' flag (design §10.12), with the outbox standing in for SES. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let membershipAdmin: Member;
let electionAdmin: Member;

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  membershipAdmin = await api.member('ma@example.test');
  electionAdmin = await api.member('ea@example.test');
  await api.grant(membershipAdmin.accountId, 'membership_admin', sa1);
  await api.grant(electionAdmin.accountId, 'election_admin', sa1);
});

const mine = (as: User) => api.call('GET', '/v1/me/email', as);
const ask = (as: User, kind: 'test' | 'retry') => api.call('POST', `/v1/me/email/${kind}`, as);
const flags = (as: User = membershipAdmin) => api.call('GET', '/v1/admin/mail/members', as);

describe('a member’s own email', () => {
  it('lists what was sent to them and what became of it, theirs alone', async () => {
    const ada = await api.member('ada@example.test');
    const ben = await api.member('ben@example.test');
    await seedElection(api, { voters: [ada.accountId, ben.accountId] });
    await worker.tick();

    const view = (await mine(ada)).body as MyEmailView;
    expect(view).toMatchObject({ address: 'ada@example.test', state: 'ok', since: null });
    expect(view.messages).toEqual([expect.objectContaining({ kind: 'voting_open', electionTitle: 'Officers', status: 'delivered' })]);
    expect(JSON.stringify(view.messages)).not.toContain('ben@');
    expect(((await mine(ben)).body as MyEmailView).messages).toHaveLength(1);
    expect((await api.call('GET', '/v1/me', ada)).body.mail).toEqual({ state: 'ok', since: null });
  });

  it('sends a test email on request, a few a day, one at a time', async () => {
    const ada = await api.member('ada@example.test');
    expect((await ask(ada, 'retry')).status).toBe(409); // nothing to try again
    const asked = await ask(ada, 'test');
    expect(asked.status).toBe(202);
    expect((asked.body as MyEmailView).requests[0]).toMatchObject({ kind: 'test', status: 'pending' });
    expect((await ask(ada, 'test')).status).toBe(409); // one waits already
    expect((await worker.tick()).body).toMatchObject({ memberEmailsSent: 1 });
    await worker.tick(); // its delivery report
    const view = (await mine(ada)).body as MyEmailView;
    expect(view.requests[0]).toMatchObject({ status: 'done', outcome: null, messageId: expect.any(String) });
    expect(view.messages[0]).toMatchObject({ kind: 'member_test', status: 'delivered' });
    await ask(ada, 'test');
    await worker.tick();
    await ask(ada, 'test');
    await worker.tick();
    expect((await ask(ada, 'test')).status).toBe(429);
  });

  it('shows a bounced address, stops mailing it, and tries it again when asked', async () => {
    const gone = await api.member('gone@bounce.test');
    await ask(gone, 'test');
    await worker.tick(); // sent, and bounced
    await worker.tick();
    const bounced = (await mine(gone)).body as MyEmailView;
    expect(bounced).toMatchObject({ state: 'bounced', since: expect.any(String) });
    expect(bounced.messages[0]).toMatchObject({ kind: 'member_test', status: 'bounced' });
    expect((await api.call('GET', '/v1/me', gone)).body.mail).toMatchObject({ state: 'bounced' });
    expect((await ask(gone, 'test')).status).toBe(409); // not mailed now

    // They try again: the address comes off the list, a test goes to it, and here it bounces again.
    const suppressed = () => api.firebase.db.collection('mail_suppressions').doc(mailAddressKey('gone@bounce.test')).get();
    const first = (await suppressed()).get('messageId') as string;
    expect((await ask(gone, 'retry')).status).toBe(202);
    await worker.tick();
    expect((await suppressed()).get('messageId')).not.toBe(first); // a new suppression, from the new test's bounce
    const again = (await mine(gone)).body as MyEmailView;
    expect(again.requests[0]).toMatchObject({ kind: 'retry', status: 'done', outcome: null });
  });

  it('flags for Membership Admins the members who cannot be emailed, and nobody else', async () => {
    const gone = await api.member('gone@bounce.test');
    const fine = await api.member('fine@example.test');
    const unconfirmed = await api.user('later@example.test', { emailVerified: false });
    const later = (await api.call('POST', '/v1/accounts', unconfirmed)).body.accountId as string;
    for (const m of [gone.accountId, fine.accountId, later]) await api.firebase.db.collection('members').doc(m).set({ accountId: m, status: 'active' });
    await ask(gone, 'test');
    await worker.tick();
    await worker.tick();

    expect((await flags(electionAdmin)).status).toBe(403);
    const found = (await flags()).body as MemberMailFlag[];
    expect(found.map((f) => [f.accountId, f.state]).sort()).toEqual(
      [
        [gone.accountId, 'bounced'],
        [later, 'unverified'],
      ].sort(),
    );
  });

  it('is forgotten with the account', async () => {
    const ada = await api.member('ada@example.test');
    await ask(ada, 'test');
    await worker.tick();
    await api.app.get((await import('./accounts/accounts.service.js')).AccountsService).forgetActivity(ada.accountId, []);
    for (const collection of ['mail_messages', 'mail_requests']) {
      expect((await api.firebase.db.collection(collection).where('accountId', '==', ada.accountId).get()).size).toBe(0);
    }
  });
});
