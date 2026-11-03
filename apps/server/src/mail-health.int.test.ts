import type { MailHealthRecord } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedElection } from './testing/elections.js';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

/** The email setup check (design §10.12), with the emulators' outbox standing in for SES. */

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let electionAdmin: Member;

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  electionAdmin = await api.member('ea@example.test');
  await api.grant(electionAdmin.accountId, 'election_admin', sa1);
});

const health = (as: User = sa1) => api.call('GET', '/v1/admin/mail/health', as);
const ask = (as: User = sa1) => api.call('POST', '/v1/admin/mail/health/check', as);
const status = (record: MailHealthRecord, id: string) => record.checks.find((c) => c.id === id)?.status;

describe('the email setup check', () => {
  it('runs where mail is not sent through SES only when a System Admin asks, once at a time', async () => {
    expect((await health()).body).toEqual({ health: null, requested: null });
    expect((await worker.tick()).body).toMatchObject({ mailChecked: false });

    expect((await ask(electionAdmin)).status).toBe(403);
    const asked = await ask();
    expect(asked.status).toBe(202);
    expect(asked.body.requested).toMatchObject({ requestedBy: sa1.accountId, status: 'pending' });
    expect((await ask()).status).toBe(409); // one waits already

    expect((await worker.tick()).body).toMatchObject({ mailChecked: true });
    const first = (await health()).body.health as MailHealthRecord;
    expect(first).toMatchObject({ trigger: 'request', requestedBy: sa1.accountId, transport: 'outbox', domain: 'transhumanist-party.org' });
    expect(status(first, 'transport')).toBe('ok');
    expect(status(first, 'web_origin')).toBe('ok');
    // No NOTICE_CONTACT with the emulators, and no contact set in the app.
    expect(status(first, 'contact')).toBe('fail');
    // SES itself is not checked where the outbox stands in for it.
    expect(status(first, 'production_access')).toBe('skipped');
    expect(status(first, 'dkim')).toBe('skipped');
    expect(status(first, 'bounce_rate')).toBe('ok');
    expect(first.probe!.messages.map((m) => m.address)).toEqual(['success', 'bounce', 'complaint']);
    expect(status(first, 'probe')).toBe('pending');
    expect((await health()).body.requested).toBeNull();
    expect((await ask()).status).toBe(429); // it just ran

    // The next tick records the simulator's reports, which the check then finds.
    expect((await worker.tick()).body).toMatchObject({ mailEventsRecorded: 4, mailChecked: false });
    const followed = (await health()).body.health as MailHealthRecord;
    expect(status(followed, 'probe')).toBe('ok');
    expect(followed.probe!.messages.map((m) => m.status)).toEqual(['delivered', 'bounced', 'complained']);
    expect(followed.overall).toBe('fail'); // the contact is still missing
  });

  it('never counts or suppresses the simulator’s messages', async () => {
    await ask();
    await worker.tick();
    await worker.tick();
    const messages = (await api.firebase.db.collection('mail_messages').where('kind', '==', 'probe').get()).docs.map((d) => d.data());
    expect(messages).toHaveLength(3);
    expect(messages.every((m) => m.counted === false && m.accountId === null)).toBe(true);
    expect((await api.firebase.db.collection('mail_suppressions').get()).size).toBe(0);
  });

  it('tells Election Admins in a word how the last run went, with their election’s emails', async () => {
    const election = await seedElection(api, { voters: [electionAdmin.accountId], state: 'scheduled', opensAt: new Date(Date.now() + 3_600_000).toISOString(), closesAt: new Date(Date.now() + 86_400_000).toISOString() });
    const view = () => api.call('GET', `/v1/admin/elections/${election.electionId}/notices`, electionAdmin);
    expect((await view()).body.setup).toBeNull();
    await ask();
    await worker.tick();
    expect((await view()).body.setup).toBe('fail');
    expect((await health(electionAdmin)).status).toBe(403);
  });
});
