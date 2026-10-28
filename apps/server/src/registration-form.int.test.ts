import { DEFAULT_REGISTRATION_FORM, type RegistrationForm } from 'ustp-domain';
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
let other: Member;

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  admin = await api.member('membership.admin@example.test');
  await api.grant(admin.accountId, 'membership_admin', sa1);
  other = await api.member('other.admin@example.test');
  await api.grant(other.accountId, 'membership_admin', sa1);
});

const put = (by: User | undefined, change: Partial<RegistrationForm>, basedOn = 0) =>
  api.call('PUT', '/v1/admin/registration-form', by, { basedOn, ...DEFAULT_REGISTRATION_FORM, ...change });
const ledger = async () => (await api.firebase.db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());

const TIPS = 'https://example.org/tips-for-advancing-a-brighter-future';

describe('the registration form (design §5.2)', () => {
  it('starts as the default, readable by anyone, with nothing saved', async () => {
    const res = await api.call('GET', '/v1/registration/form');
    expect(res).toMatchObject({ status: 200, body: { ...DEFAULT_REGISTRATION_FORM, version: 0 } });
    expect(res.body).not.toHaveProperty('updatedBy');
    expect((await api.call('GET', '/v1/registration/form/0')).body).toEqual({ ...DEFAULT_REGISTRATION_FORM, version: 0 });
    expect((await api.call('GET', '/v1/admin/registration-form', admin)).body).toEqual({
      ...DEFAULT_REGISTRATION_FORM,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('is changed by Membership Admins only', async () => {
    const lee = await api.member('lee@example.test');
    expect((await put(sa1, { intro: 'Join us.' })).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/registration-form', sa1)).status).toBe(403);
    expect((await put(lee, { intro: 'Join us.' })).status).toBe(403);
    expect((await put(undefined, { intro: 'Join us.' })).status).toBe(401);
    expect((await api.call('GET', '/v1/registration/form')).body.version).toBe(0);
  });

  it('saves the wording tidied, keeps each version, and ledgers each changed part', async () => {
    const res = await put(admin, {
      intro: '  Join the party.\n\n\n  It is   free. ',
      ideals: [...DEFAULT_REGISTRATION_FORM.ideals, ' A fourth ideal.\n', ''],
      tipsAddress: TIPS,
    });
    const saved = {
      ...DEFAULT_REGISTRATION_FORM,
      intro: 'Join the party.\n\nIt is free.',
      ideals: [...DEFAULT_REGISTRATION_FORM.ideals, 'A fourth ideal.'],
      tipsAddress: TIPS,
    };
    expect(res).toMatchObject({ status: 200, body: { ...saved, version: 1, updatedBy: admin.accountId } });
    expect((await api.call('GET', '/v1/registration/form')).body).toEqual({ ...saved, version: 1 });
    expect((await api.call('GET', '/v1/registration/form/1')).body).toEqual({ ...saved, version: 1 });

    expect((await ledger()).at(-1)).toMatchObject({
      type: 'registration_form.changed',
      actor: admin.accountId,
      subject: null,
      payload: {
        version: 1,
        changes: [
          { part: 'intro', to: saved.intro },
          { part: 'ideals', to: saved.ideals },
          { part: 'tipsAddress', to: TIPS },
        ],
      },
    });

    // An earlier version stays readable as it was.
    expect((await put(other, { usVoterQuestion: 'Can you vote in a US election?' }, 1)).body.version).toBe(2);
    expect((await api.call('GET', '/v1/registration/form/1')).body.usVoterQuestion).toBe(DEFAULT_REGISTRATION_FORM.usVoterQuestion);
    expect((await api.call('GET', '/v1/registration/form/3')).status).toBe(404);
    expect((await api.call('GET', '/v1/registration/form/latest')).status).toBe(404);
  });

  it('records nothing when nothing changed', async () => {
    const before = (await ledger()).length;
    expect((await put(admin, { usVoterQuestion: `  ${DEFAULT_REGISTRATION_FORM.usVoterQuestion}\n` })).body.version).toBe(0);
    expect(await ledger()).toHaveLength(before);
  });

  it("refuses an edit made from an older copy, so one admin does not undo another's", async () => {
    expect((await put(admin, { intro: 'Join us.' })).body.version).toBe(1);
    const stale = await put(other, { intro: '' }, 0);
    expect(stale).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/someone else changed/) } });
    expect((await api.call('GET', '/v1/registration/form')).body.intro).toBe('Join us.');
  });

  it('refuses wording without its questions or ideals, and a bonus link that is not https', async () => {
    expect(await put(admin, { usVoterQuestion: '  ' })).toMatchObject({ status: 400, body: { detail: /first question/ } });
    expect(await put(admin, { ideals: [' '] })).toMatchObject({ status: 400, body: { detail: /at least one Core Ideal/ } });
    expect(await put(admin, { tipsAddress: 'http://example.org' })).toMatchObject({ status: 400, body: { detail: /https/ } });
    expect((await api.call('PUT', '/v1/admin/registration-form', admin, { ...DEFAULT_REGISTRATION_FORM })).status).toBe(400);
    expect((await api.call('GET', '/v1/registration/form')).body.version).toBe(0);
  });

  it('is answered as it stands: an application made against an older version is refused', async () => {
    const published = await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'USTP Bylaws', text: 'Article I.\n' });
    const robin = await api.member('robin@example.test');
    const application = (formVersion: number) => ({
      bylawsVersion: published.body.version,
      bylawsHash: published.body.contentHash,
      legalName: 'Robin Applicant',
      dateOfBirth: '1990-04-01',
      attestsAge: true,
      formVersion,
      usVoteEligible: false,
      agreesWithCoreIdeals: true,
      state: 'CA',
      city: 'Oakland',
      postalCode: '94612',
    });
    expect((await put(admin, { intro: 'Join us.' })).body.version).toBe(1);

    const stale = await api.call('POST', '/v1/registration/applications', robin, application(0));
    expect(stale).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/application form has changed/) } });
    const res = await api.call('POST', '/v1/registration/applications', robin, application(1));
    expect(res).toMatchObject({ status: 201, body: { formVersion: 1, usVoteEligible: false, agreesWithCoreIdeals: true } });
  });
});
