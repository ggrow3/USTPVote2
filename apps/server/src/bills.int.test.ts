import type { BillDetail, BillSearchPage, BillsAccess, BillWatchEntry, LedgerEntry } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, type User } from './testing/emulator.js';

/**
 * The legislative team's Bills tool (design §5.14), against the emulators with `BILLS=local`: a few real bills held in
 * memory, so nothing goes to Congress.gov or GovInfo.
 */
let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

type Member = User & { accountId: string };
let sa1: Member;
let ma: Member;
let lea: Member;
let bo: Member;
let ada: Member;
let cy: Member;

async function memberRecord(user: Member, legalName: string, status = 'active', preferredName: string | null = null) {
  await api.firebase.db.collection('members').doc(user.accountId).set({ accountId: user.accountId, status, legalName, preferredName, state: 'TX' });
}

async function entries(type: string): Promise<LedgerEntry[]> {
  const snap = await api.firebase.db.collection('audit_events').where('type', '==', type).orderBy('seq').get();
  return snap.docs.map((d) => d.data() as LedgerEntry);
}

const TEAM = {
  description: 'Reads bills in Congress',
  joinPolicy: 'closed',
  joinQuestion: null,
  capacity: null,
  memberLink: null,
  color: 'indigo',
  icon: 'gavel',
};

async function team(teamId: string, name: string, lead: Member, members: Member[] = []) {
  const res = await api.call('POST', '/v1/admin/teams', ma, { ...TEAM, teamId, name, leadAccountId: lead.accountId });
  expect(res.status).toBe(201);
  for (const m of members) expect((await api.call('POST', `/v1/admin/teams/${teamId}/members`, ma, { accountId: m.accountId, role: 'member' })).status).toBe(201);
}

const settings = async () => (await api.call('GET', '/v1/admin/bills', sa1)).body;
const name = async (teamIds: string[]) => api.call('PUT', '/v1/admin/bills', sa1, { teamIds, basedOn: (await settings()).version });
const access = async (by: User) => (await api.call('GET', '/v1/bills/access', by)).body as BillsAccess;
const search = (by: User, query = '') => api.call('GET', `/v1/bills/search${query}`, by);

beforeEach(async () => {
  await resetEmulators();
  [sa1] = await api.systemAdmins();
  ma = await api.member('membership.admin@example.test');
  lea = await api.member('lea@example.test');
  bo = await api.member('bo@example.test');
  ada = await api.member('ada@example.test');
  cy = await api.member('cy@example.test');
  await api.grant(ma.accountId, 'membership_admin', sa1);
  await memberRecord(lea, 'Lea Ortiz');
  await memberRecord(bo, 'Robert Lee', 'active', 'Bo');
  await memberRecord(ada, 'Ada Brooks');
  await memberRecord(cy, 'Cy Park');
  await team('legislative', 'Legislative', lea, [bo, cy]);
  await team('outreach', 'Outreach', ada);
});

describe('who has the tool', () => {
  it('only System Admins until a System Admin names a team', async () => {
    expect(await access(sa1)).toMatchObject({ allowed: true, systemAdmin: true, teams: [], currentCongress: expect.any(Number), keySource: 'demo' });
    expect(await access(lea)).toMatchObject({ allowed: false, keySource: null });
    const refused = await search(lea);
    expect(refused.status).toBe(403);
    expect(refused.body.detail).toMatch(/for the legislative team/);
    expect((await search(sa1)).status).toBe(200);
  });

  it('the named teams’ Active members, ledgered; not other teams, not someone no longer Active, not an archived team', async () => {
    const saved = await name(['legislative']);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      teamIds: ['legislative'],
      version: 1,
      updatedBy: { accountId: sa1.accountId },
      keySource: 'demo',
      teams: [
        { teamId: 'legislative', name: 'Legislative', archived: false, members: 3 },
        { teamId: 'outreach', name: 'Outreach', archived: false, members: 1 },
      ],
    });
    expect((await entries('bills.settings_changed')).map((e) => [e.actor, e.payload])).toEqual([[sa1.accountId, { before: [], after: ['legislative'] }]]);

    expect(await access(lea)).toMatchObject({ allowed: true, systemAdmin: false, teams: [{ teamId: 'legislative', name: 'Legislative' }], keySource: 'demo' });
    expect((await search(bo)).status).toBe(200);
    expect((await search(ada)).status).toBe(403);

    await memberRecord(cy, 'Cy Park', 'lapsed');
    expect((await search(cy)).status).toBe(403);

    expect((await api.call('POST', '/v1/admin/teams/legislative/archive', ma, { archived: true })).status).toBe(201);
    expect((await search(lea)).status).toBe(403);
    expect((await access(sa1)).allowed).toBe(true);
  });

  it('refuses a stale save, an unknown team and newly naming an archived one, and leaves an unchanged save unledgered', async () => {
    expect((await api.call('PUT', '/v1/admin/bills', sa1, { teamIds: ['legislative'], basedOn: 3 })).status).toBe(409);
    expect((await name(['nope'])).status).toBe(404);
    await api.call('POST', '/v1/admin/teams/outreach/archive', ma, { archived: true });
    const archived = await name(['outreach']);
    expect(archived.status).toBe(409);
    expect(archived.body.detail).toMatch(/Outreach is archived/);
    await name(['legislative']);
    expect((await name(['legislative'])).body.version).toBe(1);
    expect(await entries('bills.settings_changed')).toHaveLength(1);
  });

  it('keeps Admin › Bills to System Admins', async () => {
    expect((await api.call('GET', '/v1/admin/bills', ma)).status).toBe(403);
    expect((await api.call('PUT', '/v1/admin/bills', lea, { teamIds: [], basedOn: 0 })).status).toBe(403);
  });
});

describe('finding bills', () => {
  beforeEach(async () => {
    await name(['legislative']);
  });

  it('by words in their text, best match first, grouped by bill', async () => {
    const res = await search(lea, '?q=superintelligence');
    expect(res.status).toBe(200);
    const page = res.body as BillSearchPage;
    expect(page.search).toMatchObject({ words: 'superintelligence', sort: 'relevance', congress: 119 });
    expect(page.hits.map((h) => h.label)).toEqual(['H.R. 10538', 'S. 5493']);
    expect(page.hits[0]).toMatchObject({ id: '119-hr-10538', title: 'Ban Artificial Superintelligence Act of 2026', version: 'ih', stage: 'introduced', chamber: 'House' });
    expect(page.next).toBeNull();
  });

  it('by type, stage, member and date, sorted by title', async () => {
    expect((await search(lea, '?type=s&q=superintelligence')).body.hits.map((h: { label: string }) => h.label)).toEqual(['S. 5493']);
    expect((await search(lea, '?stage=passed_both')).body.hits.map((h: { label: string; version: string }) => [h.label, h.version])).toEqual([['H.R. 997', 'enr']]);
    expect((await search(lea, '?member=Casar')).body.hits.map((h: { label: string }) => h.label)).toEqual(['H.R. 10538']);
    expect((await search(lea, '?from=2026-09-22&to=2026-09-23')).body.hits.map((h: { label: string }) => h.label)).toEqual(['S. 5493']);
    const byTitle = (await search(lea, '?q=artificial&sort=title')).body.hits.map((h: { label: string }) => h.label);
    expect(byTitle).toEqual(['S.Res. 918', 'H.R. 10515', 'H.R. 10538', 'S. 5493']);
  });

  it('refuses what cannot be searched', async () => {
    expect((await search(lea, '?sort=relevance')).body.detail).toMatch(/needs words/);
    expect((await search(lea, '?congress=102')).status).toBe(400);
    expect((await search(lea, '?congress=999')).status).toBe(400);
    expect((await search(lea, '?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await search(lea, '?member=collection:(x)')).status).toBe(400);
    expect((await search(lea, '?nonsense=1')).status).toBe(400);
  });

  it('lists the latest activity by update date', async () => {
    const res = await api.call('GET', '/v1/bills/recent', lea);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { label: string }) => i.label)).toEqual(['S. 5493', 'H.R. 10538', 'H.R. 997', 'S.Res. 918', 'H.R. 10515']);
    const houseOldest = await api.call('GET', '/v1/bills/recent?type=hr&sort=updated_oldest', lea);
    expect(houseOldest.body.items.map((i: { label: string }) => i.label)).toEqual(['H.R. 10515', 'H.R. 997', 'H.R. 10538']);
  });

  it('opens a bill with its status, actions, summaries and text versions, and its text', async () => {
    const res = await api.call('GET', '/v1/bills/119/hr/997', lea);
    expect(res.status).toBe(200);
    const bill = res.body as BillDetail;
    expect(bill).toMatchObject({
      id: '119-hr-997',
      label: 'H.R. 997',
      status: 'passed_both',
      url: 'https://www.congress.gov/bill/119th-congress/house-bill/997',
      sponsors: [{ fullName: 'Rep. Feenstra, Randy [R-IA-4]' }],
      watch: null,
      notes: [],
    });
    expect(bill.textVersions.map((v) => v.version)).toEqual(['enr', 'eh', 'rh', 'ih']);
    expect(bill.summaries[0]!.paragraphs[0]).toBe('National Taxpayer Advocate Enhancement Act of 2025');

    const text = await api.call('GET', '/v1/bills/119/hr/10538/text/ih', lea);
    expect(text.status).toBe(200);
    expect(text.body).toMatchObject({ version: 'ih', label: 'Introduced in House', truncated: false });
    expect(text.body.text).toContain('Ban Artificial Superintelligence Act');

    expect((await api.call('GET', '/v1/bills/119/hr/99999', lea)).status).toBe(404);
    expect((await api.call('GET', '/v1/bills/102/hr/1', lea)).status).toBe(404);
    expect((await api.call('GET', '/v1/bills/119/xx/1', lea)).status).toBe(404);
    expect((await api.call('GET', '/v1/bills/119/hr/10538/text/eh', lea)).status).toBe(404);
    expect((await api.call('GET', '/v1/bills/119/hr/10538/text/IH1', lea)).status).toBe(400);
    expect((await api.call('GET', '/v1/bills/119/hr/997', ada)).status).toBe(403);
  });
});

describe('the watchlist', () => {
  beforeEach(async () => {
    await name(['legislative']);
  });

  const watch = (by: User, id: string, tags: string[], basedOn: number | null) => api.call('PUT', `/v1/bills/watchlist/${id}`, by, { tags, basedOn });
  const list = async (by: User, query = '') => (await api.call('GET', `/v1/bills/watchlist${query}`, by)).body as BillWatchEntry[];

  it('is shared: one adds a bill with tags, another sees it and changes them from the version they saw', async () => {
    const added = await watch(lea, '119-hr-10538', [' AI ', 'ai', 'oppose'], null);
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({
      billId: '119-hr-10538',
      label: 'H.R. 10538',
      title: 'Ban Artificial Superintelligence Act of 2026',
      sponsor: 'Rep. Casar, Greg [D-TX-35]',
      status: 'introduced',
      tags: ['AI', 'oppose'],
      addedBy: { accountId: lea.accountId, name: 'Lea Ortiz' },
      notes: 0,
      stale: false,
      version: 1,
    });
    expect((await list(bo)).map((e) => e.billId)).toEqual(['119-hr-10538']);
    expect((await watch(bo, '119-hr-10538', ['AI'], 1)).body).toMatchObject({ tags: ['AI'], version: 2 });
    const stale = await watch(lea, '119-hr-10538', ['AI', 'support'], 1);
    expect(stale.status).toBe(409);
    expect((await watch(lea, '119-hr-10538', ['x'], null)).status).toBe(409);
  });

  it('sorts and filters by tag, and refuses too many tags, an unknown bill and a malformed id', async () => {
    await watch(lea, '119-hr-10538', ['AI'], null);
    await watch(lea, '119-hr-997', ['tax'], null);
    await watch(bo, '119-s-5493', ['ai', 'senate'], null);
    expect((await list(lea)).map((e) => e.label)).toEqual(['H.R. 997', 'H.R. 10538', 'S. 5493']);
    expect((await list(lea, '?sort=number')).map((e) => e.label)).toEqual(['H.R. 997', 'H.R. 10538', 'S. 5493']);
    expect((await list(lea, '?sort=added')).map((e) => e.label)).toEqual(['S. 5493', 'H.R. 997', 'H.R. 10538']);
    expect((await list(lea, '?tag=ai')).map((e) => e.label)).toEqual(['H.R. 10538', 'S. 5493']);
    expect((await watch(lea, '119-hr-10515', Array.from({ length: 11 }, (_, i) => `t${i}`), null)).status).toBe(409);
    expect((await watch(lea, '119-hr-99999', [], null)).status).toBe(404);
    expect((await watch(lea, 'hr10538', [], null)).status).toBe(404);
    expect((await watch(ada, '119-hr-10515', [], null)).status).toBe(403);
  });

  it('reads stale entries again from Congress.gov, keeping their tags', async () => {
    await watch(lea, '119-hr-997', ['tax'], null);
    await api.firebase.db.collection('bill_watch').doc('119-hr-997').update({ checkedAt: '2026-01-01T00:00:00.000Z', status: 'introduced', latestAction: null });
    const [entry] = await list(lea);
    expect(entry).toMatchObject({ status: 'passed_both', tags: ['tax'], latestAction: { date: '2026-10-14' }, stale: false, version: 1 });
    expect(Date.parse(entry!.checkedAt)).toBeGreaterThan(Date.parse('2026-01-01'));
  });

  it('keeps notes: anyone with the tool adds one, its author edits it, its author or a System Admin deletes it', async () => {
    expect((await api.call('POST', '/v1/bills/watchlist/119-hr-10538/notes', lea, { text: 'Not watched yet' })).status).toBe(404);
    await watch(lea, '119-hr-10538', [], null);
    const note = await api.call('POST', '/v1/bills/watchlist/119-hr-10538/notes', lea, { text: '  Ask the sponsor\r\nabout section 3.  ' });
    expect(note.status).toBe(201);
    expect(note.body).toMatchObject({ text: 'Ask the sponsor\nabout section 3.', author: { name: 'Lea Ortiz' }, mine: true, deletable: true, editedAt: null });
    const id = note.body.noteId as string;

    const seen = (await api.call('GET', '/v1/bills/119/hr/10538', bo)).body as BillDetail;
    expect(seen.watch).toMatchObject({ notes: 1 });
    expect(seen.notes).toEqual([expect.objectContaining({ noteId: id, mine: false, deletable: false })]);
    expect((await list(bo))[0]).toMatchObject({ notes: 1 });

    expect((await api.call('PUT', `/v1/bills/notes/${id}`, bo, { text: 'mine now' })).status).toBe(403);
    expect((await api.call('DELETE', `/v1/bills/notes/${id}`, bo)).status).toBe(403);
    const edited = await api.call('PUT', `/v1/bills/notes/${id}`, lea, { text: 'Ask about section 4.' });
    expect(edited.body).toMatchObject({ text: 'Ask about section 4.', editedAt: expect.any(String) });
    expect((await api.call('POST', '/v1/bills/watchlist/119-hr-10538/notes', lea, { text: '   ' })).status).toBe(400);
    expect((await api.call('POST', '/v1/bills/watchlist/119-hr-10538/notes', lea, { text: 'x'.repeat(2001) })).status).toBe(400);

    expect((await api.call('DELETE', `/v1/bills/notes/${id}`, sa1)).status).toBe(200);
    expect((await api.call('DELETE', `/v1/bills/notes/${id}`, lea)).status).toBe(404);
  });

  it('takes a bill off with its notes', async () => {
    await watch(lea, '119-hr-10538', [], null);
    await api.call('POST', '/v1/bills/watchlist/119-hr-10538/notes', lea, { text: 'one' });
    await api.call('POST', '/v1/bills/watchlist/119-hr-10538/notes', bo, { text: 'two' });
    const removed = await api.call('DELETE', '/v1/bills/watchlist/119-hr-10538', bo);
    expect(removed.body).toEqual({ removed: true, notes: 2 });
    expect(await list(lea)).toEqual([]);
    expect((await api.firebase.db.collection('bill_notes').get()).size).toBe(0);
    expect((await api.call('DELETE', '/v1/bills/watchlist/119-hr-10538', bo)).status).toBe(404);
  });
});
