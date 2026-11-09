import { describe, expect, it } from 'vitest';
import {
  billId,
  billLabel,
  billSearchSchema,
  billStatus,
  checkNoteChange,
  checkTags,
  cleanSearchWords,
  congressGovUrl,
  congressLabel,
  currentCongress,
  lawLabel,
  ordinal,
  packageId,
  parseBillId,
  parseBillReference,
  parsePackageId,
  settleSearch,
  sortWatchlist,
  tidyTags,
  versionLabel,
  versionStage,
  type BillAction,
  type BillNoteRecord,
} from './bills.js';

const LATEST = 119;

describe('currentCongress', () => {
  it('counts two-year Congresses from 1789, each starting on 3 January of an odd year', () => {
    expect(currentCongress(new Date('2026-11-07T12:00:00Z'))).toBe(119);
    expect(currentCongress(new Date('2025-01-03T12:00:00Z'))).toBe(119);
    expect(currentCongress(new Date('2025-01-02T12:00:00Z'))).toBe(118);
    expect(currentCongress(new Date('2027-01-02T23:00:00Z'))).toBe(119);
    expect(currentCongress(new Date('2027-01-03T12:00:00Z'))).toBe(120);
    expect(currentCongress(new Date('1993-06-01T00:00:00Z'))).toBe(103);
  });

  it('names Congresses with their ordinal', () => {
    expect([101, 102, 103, 111, 112, 113, 119, 121].map(ordinal)).toEqual(['101st', '102nd', '103rd', '111th', '112th', '113th', '119th', '121st']);
    expect(congressLabel(119)).toBe('119th Congress');
  });
});

describe('bill references', () => {
  const hr10538 = { congress: 119, type: 'hr', number: 10538 } as const;

  it('labels, identifies and links a bill', () => {
    expect(billLabel(hr10538)).toBe('H.R. 10538');
    expect(billLabel({ type: 'sconres', number: 2 })).toBe('S.Con.Res. 2');
    expect(billId(hr10538)).toBe('119-hr-10538');
    expect(congressGovUrl(hr10538)).toBe('https://www.congress.gov/bill/119th-congress/house-bill/10538');
    expect(parseBillId('119-hr-10538', LATEST)).toEqual(hr10538);
  });

  it('refuses ids outside the covered Congresses, unknown types and impossible numbers', () => {
    expect(parseBillId('102-hr-1', LATEST)).toBeNull();
    expect(parseBillId('120-hr-1', LATEST)).toBeNull();
    expect(parseBillId('119-hx-1', LATEST)).toBeNull();
    expect(parseBillId('119-hr-0', LATEST)).toBeNull();
    expect(parseBillId('119-hr-10538 ', LATEST)).toBeNull();
  });

  it.each([
    ['H.R. 10538', hr10538],
    ['hr10538', hr10538],
    ['HR 10538', hr10538],
    ['h. r. 10538', hr10538],
    ['119-hr-10538', hr10538],
    ['H.R. 10538 (119th Congress)', hr10538],
    ['https://www.congress.gov/bill/119th-congress/house-bill/10538/text', hr10538],
    ['congress.gov/bill/119th-congress/house-bill/10538', hr10538],
    ['https://www.congress.gov/bill/119th-congress/house-bill/10538?q=x', hr10538],
    ['S 12', { congress: 119, type: 's', number: 12 }],
    ['S.5493', { congress: 119, type: 's', number: 5493 }],
    ['H.Res. 5', { congress: 119, type: 'hres', number: 5 }],
    ['H. Res. 5', { congress: 119, type: 'hres', number: 5 }],
    ['HJRES 3', { congress: 119, type: 'hjres', number: 3 }],
    ['S.Con.Res. 2', { congress: 119, type: 'sconres', number: 2 }],
    ['S.Res. 918', { congress: 119, type: 'sres', number: 918 }],
    ['118th H.R. 1', { congress: 118, type: 'hr', number: 1 }],
    ['https://www.congress.gov/bill/118th-congress/senate-joint-resolution/7', { congress: 118, type: 'sjres', number: 7 }],
  ])('reads %s', (text, expected) => {
    expect(parseBillReference(text, LATEST, LATEST)).toEqual(expected);
  });

  it('uses the Congress picked when the text names none', () => {
    expect(parseBillReference('H.R. 1', 117, LATEST)).toEqual({ congress: 117, type: 'hr', number: 1 });
  });

  it.each(['', 'superintelligence', 'H.R.', 'HR 123456', 'X 12', '120th H.R. 1', '102nd H.R. 1', 'https://www.congress.gov/member/x/1', 'H.R. 1 and S. 2'])(
    'refuses %j',
    (text) => {
      expect(parseBillReference(text, LATEST, LATEST)).toBeNull();
    },
  );

  it('reads GovInfo package IDs, the type matched longest first', () => {
    expect(parsePackageId('BILLS-119hr10538ih', LATEST)).toEqual({ congress: 119, type: 'hr', number: 10538, version: 'ih' });
    expect(parsePackageId('BILLS-119hres1646ih', LATEST)).toEqual({ congress: 119, type: 'hres', number: 1646, version: 'ih' });
    expect(parsePackageId('BILLS-119sres918is', LATEST)).toEqual({ congress: 119, type: 'sres', number: 918, version: 'is' });
    expect(parsePackageId('BILLS-119s5493is', LATEST)).toEqual({ congress: 119, type: 's', number: 5493, version: 'is' });
    expect(parsePackageId('BILLS-119hr997enr', LATEST)).toEqual({ congress: 119, type: 'hr', number: 997, version: 'enr' });
    expect(parsePackageId('PLAW-119publ12', LATEST)).toBeNull();
    expect(packageId({ congress: 119, type: 'hr', number: 10538, version: 'ih' })).toBe('BILLS-119hr10538ih');
  });

  it('names versions and the stage each marks', () => {
    expect(versionLabel('ih')).toBe('Introduced in House');
    expect(versionLabel('xyz')).toBe('XYZ');
    expect(versionStage('ih')).toBe('introduced');
    expect(versionStage('rs')).toBe('reported');
    expect(versionStage('eh')).toBe('passed_one');
    expect(versionStage('rfs')).toBe('passed_one');
    expect(versionStage('enr')).toBe('passed_both');
    expect(versionStage('rcs')).toBeNull();
  });
});

describe('the search', () => {
  it('keeps words and phrases but drops field operators, brackets and an unpaired quote', () => {
    expect(cleanSearchWords('artificial  intelligence')).toBe('artificial intelligence');
    expect(cleanSearchWords('"artificial superintelligence" ban')).toBe('"artificial superintelligence" ban');
    expect(cleanSearchWords('collection:(USCOURTS) fraud')).toBe('collection USCOURTS fraud');
    expect(cleanSearchWords('“smart quotes”')).toBe('"smart quotes"');
    expect(cleanSearchWords('"unfinished phrase')).toBe('unfinished phrase');
    expect(cleanSearchWords('a\\b * ? ~ ^')).toBe('a b');
    expect(cleanSearchWords('()')).toBe('');
  });

  it('settles the Congress, the dates and the sort', () => {
    const parse = (q: Record<string, string>) => settleSearch(billSearchSchema.parse(q), LATEST);
    expect(parse({})).toEqual({
      ok: true,
      search: { words: null, congress: 119, type: null, stage: null, member: null, from: null, to: null, sort: 'newest', cursor: null },
    });
    expect(parse({ q: 'superintelligence' })).toMatchObject({ ok: true, search: { words: 'superintelligence', sort: 'relevance' } });
    expect(parse({ q: 'ai', sort: 'title', congress: '118', type: 'hr', stage: 'passed_both', member: "O'Brien", from: '2025-01-01', to: '2025-12-31' })).toMatchObject({
      ok: true,
      search: { congress: 118, type: 'hr', stage: 'passed_both', member: "O'Brien", from: '2025-01-01', to: '2025-12-31', sort: 'title' },
    });
    expect(parse({ congress: '120' })).toEqual({ ok: false, reason: 'the 119th Congress is the latest' });
    expect(parse({ from: '2026-02-01', to: '2026-01-01' })).toEqual({ ok: false, reason: 'the first date is after the second' });
    expect(parse({ sort: 'relevance' })).toMatchObject({ ok: false, reason: /needs words/ });
    expect(parse({ q: '()' })).toMatchObject({ ok: false, reason: /nothing to search/ });
  });

  it('refuses parameters it does not know, a Congress before GovInfo, bad dates and odd member names', () => {
    expect(billSearchSchema.safeParse({ congress: '102' }).success).toBe(false);
    expect(billSearchSchema.safeParse({ from: '2026-13-01' }).success).toBe(false);
    expect(billSearchSchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(billSearchSchema.safeParse({ member: 'member:(x)' }).success).toBe(false);
    expect(billSearchSchema.safeParse({ query: 'x' }).success).toBe(false);
    expect(billSearchSchema.safeParse({ q: '' }).data).toEqual({});
  });
});

describe('billStatus', () => {
  const a = (text: string, type: string | null = null): BillAction => ({ date: '2026-01-01', text, type, source: 'Library of Congress' });

  it('reads how far a bill has gone from the Library of Congress actions', () => {
    expect(billStatus([a('Introduced in House', 'IntroReferral')], [])).toBe('introduced');
    expect(billStatus([a('Reported (Amended) by the Committee on Ways and Means. H. Rept. 119-46.', 'Committee')], [])).toBe('reported');
    expect(billStatus([a('Placed on the Union Calendar, Calendar No. 33.', 'Calendars')], [])).toBe('reported');
    expect(billStatus([a('Passed/agreed to in House: On motion to suspend the rules and pass the bill', 'Floor')], [])).toBe('passed_house');
    expect(billStatus([a('Passed/agreed to in Senate: Passed Senate without amendment by Unanimous Consent', 'Floor')], [])).toBe('passed_senate');
    expect(
      billStatus([a('Passed/agreed to in Senate: Passed Senate without amendment', 'Floor'), a('Passed/agreed to in House: On passage Passed', 'Floor')], []),
    ).toBe('passed_both');
    expect(billStatus([a('Presented to President.', 'Floor')], [])).toBe('to_president');
    expect(billStatus([a('Vetoed by President.', 'Veto')], [])).toBe('vetoed');
    expect(billStatus([a('Became Public Law No: 119-12.', 'BecameLaw')], [])).toBe('law');
    expect(billStatus([], [{ type: 'Public Law', number: '119-12' }])).toBe('law');
  });

  it('labels laws', () => {
    expect(lawLabel({ type: 'Public Law', number: '119-12' })).toBe('Public Law 119-12');
    expect(lawLabel({ type: 'Private Law', number: '119-1' })).toBe('Private Law 119-1');
  });
});

describe('the watchlist', () => {
  it('keeps tags trimmed, once each in any case, within the limits', () => {
    expect(tidyTags([' AI ', 'ai', 'oppose  now', '', 'Oppose now'])).toEqual(['AI', 'oppose now']);
    expect(checkTags(['a'])).toEqual({ ok: true });
    expect(checkTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toMatchObject({ ok: false, reason: /at most 10 tags/ });
    expect(checkTags(['x'.repeat(31)])).toMatchObject({ ok: false, reason: /at most 30 characters/ });
  });

  it('sorts by latest action, added, number or title', () => {
    const e = (type: 'hr' | 's', number: number, title: string, addedAt: string, action: string | null) => ({
      congress: 119,
      type,
      number,
      title,
      addedAt,
      latestAction: action ? { date: action, text: '' } : null,
    });
    const list = [e('s', 2, 'banana', '2026-01-02', '2026-03-01'), e('hr', 10, 'Apple', '2026-01-03', null), e('hr', 3, 'cherry', '2026-01-01', '2026-05-01')];
    const ids = (sorted: typeof list) => sorted.map((x) => `${x.type}${x.number}`);
    expect(ids(sortWatchlist(list, 'latest_action'))).toEqual(['hr3', 's2', 'hr10']);
    expect(ids(sortWatchlist(list, 'added'))).toEqual(['hr10', 's2', 'hr3']);
    expect(ids(sortWatchlist(list, 'number'))).toEqual(['hr3', 'hr10', 's2']);
    expect(ids(sortWatchlist(list, 'title'))).toEqual(['hr10', 's2', 'hr3']);
  });

  it('lets a note be edited by its author and deleted by its author or a System Admin', () => {
    const note: BillNoteRecord = { noteId: 'n', billId: '119-hr-1', text: 't', author: 'a', createdAt: '', editedAt: null };
    expect(checkNoteChange(note, 'a', 'edit', false)).toEqual({ ok: true });
    expect(checkNoteChange(note, 'b', 'edit', true)).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(checkNoteChange(note, 'b', 'delete', true)).toEqual({ ok: true });
    expect(checkNoteChange(note, 'b', 'delete', false)).toMatchObject({ ok: false, refusal: 'forbidden' });
  });
});
