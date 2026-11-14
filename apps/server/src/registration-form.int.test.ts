import { Collections, DEFAULT_REGISTRATION_FIELDS, DEFAULT_REGISTRATION_FORM, type RegistrationForm } from 'ustp-domain';
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
      title: '  Join the\n USTP ',
      intro: '  Join the party.\n\n\n  It is   free. ',
      ideals: [...DEFAULT_REGISTRATION_FORM.ideals, ' A fourth ideal.\n', ''],
      tipsAddress: TIPS,
    });
    const saved = {
      ...DEFAULT_REGISTRATION_FORM,
      title: 'Join the USTP',
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
          { part: 'title', to: 'Join the USTP' },
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

  it('serves wording saved before the heading could be changed with the default heading', async () => {
    const { title: _, ...older } = { ...DEFAULT_REGISTRATION_FORM, intro: 'Join us.' };
    await api.firebase.db
      .collection(Collections.registrationForm)
      .doc('current')
      .set({ ...older, version: 1, updatedAt: new Date().toISOString(), updatedBy: admin.accountId });
    expect((await api.call('GET', '/v1/registration/form')).body).toEqual({ ...DEFAULT_REGISTRATION_FORM, intro: 'Join us.', version: 1 });
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

  it('refuses wording without its heading, questions or ideals, and a bonus link that is not https', async () => {
    expect(await put(admin, { title: ' \n ' })).toMatchObject({ status: 400, body: { detail: /page needs a heading/ } });
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

  describe('the fields it asks', () => {
    const fields = (change: object) => ({ ...DEFAULT_REGISTRATION_FIELDS, ...change });
    let robin: Member;
    let base: object;
    beforeEach(async () => {
      const published = await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'USTP Bylaws', text: 'Article I.\n' });
      robin = await api.member('robin@example.test');
      base = {
        bylawsVersion: published.body.version,
        bylawsHash: published.body.contentHash,
        legalName: 'Robin Applicant',
        attestsAge: true,
        usVoteEligible: true,
        agreesWithCoreIdeals: true,
      };
    });
    const apply = (answers: object) => api.call('POST', '/v1/registration/applications', robin, { ...base, ...answers });

    it('are saved with the wording, ledgered as the fields that changed, and left alone by a request without them', async () => {
      const res = await put(admin, { fields: fields({ city: 'optional', phone: 'hidden' }) });
      expect(res).toMatchObject({ status: 200, body: { version: 1, fields: fields({ city: 'optional', phone: 'hidden' }) } });
      expect((await ledger()).at(-1)).toMatchObject({
        type: 'registration_form.changed',
        payload: { version: 1, changes: [{ part: 'fields', to: { city: 'optional', phone: 'hidden' } }] },
      });
      expect((await api.call('GET', '/v1/registration/form')).body.fields).toMatchObject({ city: 'optional', phone: 'hidden', state: 'required' });

      // A page loaded before fields could be set saves the wording only.
      const { fields: _, ...wording } = DEFAULT_REGISTRATION_FORM;
      const old = await api.call('PUT', '/v1/admin/registration-form', admin, { basedOn: 1, ...wording, intro: 'Join us.' });
      expect(old).toMatchObject({ status: 200, body: { version: 2, intro: 'Join us.', fields: fields({ city: 'optional', phone: 'hidden' }) } });

      expect((await put(admin, { fields: fields({ country: 'optional' }) }, 2)).status).toBe(400);
      expect((await put(admin, { fields: fields({ volunteer: 'required' }) }, 2)).status).toBe(400);
    });

    it('hold an application to what they require, naming each field', async () => {
      const missing = await apply({ formVersion: 0, state: 'CA' });
      expect(missing.status).toBe(400);
      expect(missing.body.errors.map((e: { path: string }) => e.path)).toEqual(['dateOfBirth', 'city', 'postalCode']);

      await put(admin, { fields: fields({ dateOfBirth: 'optional', city: 'optional', postalCode: 'optional', phone: 'required' }) });
      const phone = await apply({ formVersion: 1, state: 'CA' });
      expect(phone).toMatchObject({ status: 400, body: { errors: [{ path: 'phone', message: 'enter your phone number' }] } });
      // What is given is still checked.
      expect((await apply({ formVersion: 1, state: 'CA', phone: '415 555 0100', postalCode: '9461' })).body.errors).toEqual([
        { path: 'postalCode', message: 'enter a 5-digit ZIP code' },
      ]);
      const res = await apply({ formVersion: 1, state: 'CA', phone: '415 555 0100' });
      expect(res).toMatchObject({ status: 201, body: { dateOfBirth: null, state: 'CA', contact: { city: null, postalCode: null } } });
    });

    it('keep nothing for a field that is not shown, and take everyone as in the United States without the country', async () => {
      await put(admin, {
        fields: fields({ country: 'hidden', state: 'hidden', city: 'hidden', postalCode: 'hidden', dateOfBirth: 'hidden', phone: 'hidden', volunteer: 'hidden', keepInTouch: 'hidden' }),
      });
      const res = await apply({
        formVersion: 1,
        country: 'DE',
        region: 'Berlin',
        city: 'Berlin',
        postalCode: '10115',
        dateOfBirth: '1990-04-01',
        phone: '+49 30 1234567',
        volunteer: true,
        newsletter: true,
        announcements: true,
        statement: 'To help.',
      });
      expect(res).toMatchObject({
        status: 201,
        body: {
          country: 'US',
          state: null,
          region: null,
          dateOfBirth: null,
          contact: { city: null, postalCode: null, phone: null },
          volunteer: false,
          communications: { newsletter: null, announcements: null },
          statement: 'To help.',
        },
      });
    });

    it("hold a member's own details to the same rules afterwards", async () => {
      const details = (where: object) => api.call('POST', '/v1/me/details', robin, { ...where, newsletter: false, announcements: false });
      expect((await apply({ formVersion: 0, dateOfBirth: '1990-04-01', state: 'CA', city: 'Oakland', postalCode: '94612' })).status).toBe(201);
      const refused = await details({ state: 'CA' });
      expect(refused.status).toBe(400);
      expect(refused.body.errors.map((e: { path: string }) => e.path)).toEqual(['city', 'postalCode']);

      await put(admin, { fields: fields({ city: 'optional', postalCode: 'hidden' }) });
      expect(await details({ state: 'CA' })).toMatchObject({ status: 201, body: { state: 'CA', contact: { city: null, postalCode: null } } });
      // Not shown on the application, still theirs to give later, and checked when given.
      expect((await details({ state: 'CA', postalCode: '9461' })).status).toBe(400);
      expect(await details({ state: 'CA', postalCode: '94612' })).toMatchObject({ status: 201, body: { contact: { postalCode: '94612' } } });
      expect((await details({})).body.errors).toEqual([{ path: 'state', message: 'choose your state or territory (two-letter code)' }]);
    });
  });
});
