import { DEFAULT_HOME_QUOTE, type HomeQuote } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HomeQuoteService } from './administration/home-quote.js';
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
  api.app.get(HomeQuoteService).invalidate();
  [sa1, sa2] = await api.systemAdmins();
});

const LBJ: HomeQuote = {
  shown: true,
  text: 'The vote is the most powerful instrument ever devised by man for breaking down injustice and destroying the terrible walls which imprison men because they are different from other men.',
  attribution: 'Lyndon B. Johnson',
  source: 'Remarks in the Capitol Rotunda at the Signing of the Voting Rights Act, August 6, 1965',
};

const put = (by: User | undefined, quote: Partial<HomeQuote>, basedOn = 0) =>
  api.call('PUT', '/v1/admin/home-quote', by, { basedOn, ...DEFAULT_HOME_QUOTE, ...quote });
const ledger = async () => (await api.firebase.db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data());

describe('the home page quote (design §10.5)', () => {
  it('starts as the default, readable by anyone, with nothing saved', async () => {
    const res = await api.call('GET', '/v1/home-quote');
    expect(res).toMatchObject({ status: 200, body: { ...DEFAULT_HOME_QUOTE, version: 0 } });
    expect(res.body).not.toHaveProperty('updatedBy');
    expect((await api.call('GET', '/v1/admin/home-quote', sa1)).body).toEqual({
      ...DEFAULT_HOME_QUOTE,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('is changed by System Admins only', async () => {
    const pat = await api.member('pat@example.test');
    await api.grant(pat.accountId, 'membership_admin', sa1);
    const lee = await api.member('lee@example.test');
    expect((await put(pat, LBJ)).status).toBe(403);
    expect((await api.call('GET', '/v1/admin/home-quote', pat)).status).toBe(403);
    expect((await put(lee, LBJ)).status).toBe(403);
    expect((await put(undefined, LBJ)).status).toBe(401);
    expect((await api.call('GET', '/v1/home-quote')).body).toEqual({ ...DEFAULT_HOME_QUOTE, version: 0 });
  });

  it('saves the quote tidied, ledgering each changed part with the admin as actor', async () => {
    const res = await put(sa1, { ...LBJ, text: `  “${LBJ.text}”\n`, attribution: '— Lyndon B. Johnson' });
    expect(res).toMatchObject({ status: 200, body: { ...LBJ, version: 1, updatedBy: sa1.accountId } });
    expect((await api.call('GET', '/v1/home-quote')).body).toEqual({ ...LBJ, version: 1 });

    const events = await ledger();
    expect(events.at(-1)).toMatchObject({
      type: 'home_quote.changed',
      actor: sa1.accountId,
      subject: null,
      payload: {
        version: 1,
        changes: [
          { part: 'text', to: LBJ.text },
          { part: 'attribution', to: LBJ.attribution },
          { part: 'source', to: LBJ.source },
        ],
      },
    });
  });

  it('is switched off and on again, keeping its words', async () => {
    const off = await put(sa1, { shown: false });
    expect(off.body).toMatchObject({ ...DEFAULT_HOME_QUOTE, shown: false, version: 1 });
    expect((await ledger()).at(-1)!.payload).toEqual({ version: 1, changes: [{ part: 'shown', to: false }] });
    expect((await api.call('GET', '/v1/home-quote')).body.shown).toBe(false);
    expect((await put(sa2, { shown: true }, 1)).body).toMatchObject({ ...DEFAULT_HOME_QUOTE, version: 2, updatedBy: sa2.accountId });
  });

  it('records nothing when nothing changed', async () => {
    const before = (await ledger()).length;
    expect((await put(sa1, { text: `"${DEFAULT_HOME_QUOTE.text}"` })).body.version).toBe(0);
    expect(await ledger()).toHaveLength(before);
  });

  it("refuses an edit made from an older copy, so one admin does not undo another's", async () => {
    expect((await put(sa1, LBJ)).body.version).toBe(1);
    const stale = await put(sa2, { shown: false }, 0);
    expect(stale).toMatchObject({ status: 409, body: { detail: expect.stringMatching(/someone else changed/) } });
    expect((await api.call('GET', '/v1/home-quote')).body).toEqual({ ...LBJ, version: 1 });
  });

  it('refuses a shown quote without its words or who said them, and a part over its limit', async () => {
    const noWords = await put(sa1, { text: '  “ ”  ' });
    expect(noWords).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/needs its words/) } });
    const noOne = await put(sa1, { attribution: '—' });
    expect(noOne).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/needs who said it/) } });
    const long = await put(sa1, { shown: false, source: 'x'.repeat(161) });
    expect(long).toMatchObject({ status: 400, body: { detail: expect.stringMatching(/at most 160 characters/) } });
    expect((await put(sa1, { shown: false, text: '', attribution: '' })).body).toMatchObject({ shown: false, text: '', version: 1 });
  });

  it('validates the body: every part, and the version it was edited from', async () => {
    const { source: _, ...noSource } = DEFAULT_HOME_QUOTE;
    expect((await api.call('PUT', '/v1/admin/home-quote', sa1, { basedOn: 0, ...noSource })).status).toBe(400);
    expect((await api.call('PUT', '/v1/admin/home-quote', sa1, { ...DEFAULT_HOME_QUOTE })).status).toBe(400);
    expect((await api.call('PUT', '/v1/admin/home-quote', sa1, { basedOn: 0, ...DEFAULT_HOME_QUOTE, link: 'x' })).status).toBe(400);
    expect((await api.call('GET', '/v1/home-quote')).body.version).toBe(0);
  });
});
