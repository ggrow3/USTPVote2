import type { BillSearch } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  BillSourceError,
  decodeEntities,
  govInfoQuery,
  groupHits,
  htmlParagraphs,
  plainBillText,
  PublicBillSource,
  TtlCache,
  versionFromUrl,
} from './bills/bill-source.js';

const SEARCH: BillSearch = { words: null, congress: 119, type: null, stage: null, member: null, from: null, to: null, sort: 'newest', cursor: null };
const KEY = 'k'.repeat(40);

describe('the GovInfo query (design §5.14)', () => {
  it('asks for bills of the Congress, then each filter, then the words', () => {
    expect(govInfoQuery(SEARCH, '2026-11-08')).toBe('collection:(BILLS) AND congress:(119)');
    expect(
      govInfoQuery({ ...SEARCH, words: '"artificial superintelligence" ban', type: 'hr', stage: 'introduced', member: "O'Brien", from: '2026-09-01' }, '2026-11-08'),
    ).toBe(
      'collection:(BILLS) AND congress:(119) AND docclass:(hr) AND billversion:(ih OR is) AND member:("O\'Brien") AND publishdate:range(2026-09-01,2026-11-08) AND ("artificial superintelligence" ban)',
    );
    expect(govInfoQuery({ ...SEARCH, to: '2025-06-30', stage: 'passed_both' }, '2026-11-08')).toBe(
      'collection:(BILLS) AND congress:(119) AND billversion:(enr) AND publishdate:range(1993-01-01,2025-06-30)',
    );
  });
});

describe('grouping GovInfo results by bill', () => {
  it('shows each bill once, as its furthest version on the page, in the order it first appears', () => {
    const hits = groupHits(
      [
        { packageId: 'BILLS-119hr997ih', title: 'National Taxpayer Advocate Enhancement Act of 2025', dateIssued: '2025-02-05', governmentAuthor: ['Congress', 'House of Representatives'] },
        { packageId: 'BILLS-119s5493is', title: 'Ban Artificial Superintelligence Act of 2026 ', dateIssued: '2026-09-23', governmentAuthor: ['Congress', 'Senate'] },
        { packageId: 'BILLS-119hr997enr', title: 'National Taxpayer Advocate Enhancement Act of 2025', dateIssued: '2026-10-01' },
        { packageId: 'BILLS-119hr997rcs', title: 'National Taxpayer Advocate Enhancement Act of 2025' },
        { packageId: 'PLAW-119publ12', title: 'not a bill' },
      ],
      119,
    );
    expect(hits).toEqual([
      {
        congress: 119,
        type: 'hr',
        number: 997,
        id: '119-hr-997',
        label: 'H.R. 997',
        title: 'National Taxpayer Advocate Enhancement Act of 2025',
        chamber: 'House',
        version: 'enr',
        versionLabel: 'Enrolled bill',
        stage: 'passed_both',
        date: '2026-10-01',
        otherVersions: ['ih', 'rcs'],
      },
      {
        congress: 119,
        type: 's',
        number: 5493,
        id: '119-s-5493',
        label: 'S. 5493',
        title: 'Ban Artificial Superintelligence Act of 2026',
        chamber: 'Senate',
        version: 'is',
        versionLabel: 'Introduced in Senate',
        stage: 'introduced',
        date: '2026-09-23',
        otherVersions: [],
      },
    ]);
  });
});

describe('text from elsewhere', () => {
  it('decodes character references and leaves unknown ones', () => {
    expect(decodeEntities('&lt;DOC&gt; &amp; &#8212; &#x2014; &sect;2 &bogus; &#0;')).toBe('<DOC> & — — §2 &bogus; &#0;');
  });

  it('reduces a CRS summary to plain paragraphs, list items marked, scripts and tags gone', () => {
    const html =
      '<![CDATA[<p><strong>Ban Act </strong></p><p>This bill&nbsp;does <em>two</em> things:</p><ul><li>bans <a href="javascript:x">X</a>;</li><li>funds Y.</li></ul><script>alert(1)</script><p></p>]]>';
    expect(htmlParagraphs(html)).toEqual(['Ban Act', 'This bill does two things:', '• bans X;', '• funds Y.']);
  });

  it('takes a printed version from inside its <pre>, as printed', () => {
    const html = '<html><body><pre>\n[Congressional Bills 119th Congress]\n\n&lt;DOC&gt;\n    Be it enacted\n                                 &lt;all&gt;\n</pre></body></html>';
    expect(plainBillText(html)).toBe('[Congressional Bills 119th Congress]\n\n<DOC>\n    Be it enacted\n                                 <all>');
  });

  it('reads the version from a congress.gov file name', () => {
    expect(versionFromUrl('https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr.htm')).toBe('enr');
    expect(versionFromUrl('https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr_uslm.xml')).toBe('enr');
    expect(versionFromUrl('https://www.congress.gov/119/bills/sres918/BILLS-119sres918is.pdf')).toBe('is');
    expect(versionFromUrl('https://example.com/x.pdf')).toBeNull();
  });
});

describe('TtlCache', () => {
  it('keeps an answer for its time, forgets failures, and holds at most its size', async () => {
    let now = 0;
    const cache = new TtlCache<number>(1000, 2, () => now);
    let loads = 0;
    const load = (v: number) => () => (loads++, Promise.resolve(v));
    expect(await cache.get('a', load(1))).toBe(1);
    expect(await cache.get('a', load(2))).toBe(1);
    now = 1001;
    expect(await cache.get('a', load(3))).toBe(3);
    await expect(cache.get('b', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await Promise.resolve();
    expect(await cache.get('b', load(4))).toBe(4);
    await cache.get('c', load(5));
    expect(await cache.get('a', load(6))).toBe(6);
    expect(loads).toBe(5);
  });
});

type Call = { url: string; init: RequestInit | undefined };

/** A fetch answering from a table of URL patterns, recording each call. */
function fakeFetch(routes: [RegExp, (call: Call) => Response][]) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    const route = routes.find(([pattern]) => pattern.test(call.url));
    if (!route) throw new Error(`unexpected ${call.url}`);
    return route[1](call);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('PublicBillSource', () => {
  it('searches GovInfo with the key in a header, never the address, and pages with its cursor', async () => {
    const results = Array.from({ length: 20 }, (_, i) => ({ packageId: `BILLS-119hr${i + 1}ih`, title: `Bill ${i + 1}`, dateIssued: '2026-01-01' }));
    const { fetchFn, calls } = fakeFetch([[/govinfo\.gov\/search$/, () => json({ count: 161, offsetMark: 'NEXT', results })]]);
    const source = new PublicBillSource(async () => KEY, fetchFn);
    const page = await source.search({ ...SEARCH, words: 'superintelligence', sort: 'relevance' }, 119);
    expect(page).toMatchObject({ total: 161, next: 'NEXT' });
    expect(page.hits).toHaveLength(20);
    const call = calls[0]!;
    expect(call.url).not.toContain(KEY);
    expect((call.init?.headers as Record<string, string>)['X-Api-Key']).toBe(KEY);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      query: 'collection:(BILLS) AND congress:(119) AND (superintelligence)',
      pageSize: 20,
      offsetMark: '*',
      sorts: [{ field: 'score', sortOrder: 'DESC' }],
    });
    await source.search({ ...SEARCH, words: 'superintelligence', sort: 'relevance' }, 119);
    expect(calls).toHaveLength(1);
  });

  it('has no next page when GovInfo gave fewer than a page', async () => {
    const { fetchFn } = fakeFetch([[/search$/, () => json({ count: 2, offsetMark: 'X', results: [{ packageId: 'BILLS-119hr1ih', title: 't' }] })]]);
    expect((await new PublicBillSource(async () => KEY, fetchFn).search(SEARCH, 119)).next).toBeNull();
  });

  it('lists a Congress by update date from Congress.gov', async () => {
    const { fetchFn, calls } = fakeFetch([
      [
        /api\.congress\.gov\/v3\/bill\/119\/hr\?/,
        () =>
          json({
            bills: [
              { congress: 119, type: 'HR', number: '3100', title: 'A bill', originChamber: 'House', updateDate: '2026-11-07', latestAction: { actionDate: '2026-11-05', text: 'Placed on the Union Calendar.' } },
              { congress: 119, type: 'XX', number: '1', title: 'unknown type' },
            ],
            pagination: { count: 45 },
          }),
      ],
    ]);
    const page = await new PublicBillSource(async () => KEY, fetchFn).recent({ congress: 119, type: 'hr', from: '2026-11-01', to: null, sort: 'updated', page: 2 });
    const url = new URL(calls[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ format: 'json', limit: '20', offset: '20', sort: 'updateDate desc', fromDateTime: '2026-11-01T00:00:00Z' });
    expect(page).toEqual({
      congress: 119,
      total: 45,
      page: 2,
      hasMore: true,
      items: [
        {
          congress: 119,
          type: 'hr',
          number: 3100,
          id: '119-hr-3100',
          label: 'H.R. 3100',
          title: 'A bill',
          chamber: 'House',
          introducedDate: null,
          updatedAt: '2026-11-07',
          latestAction: { date: '2026-11-05', text: 'Placed on the Union Calendar.' },
        },
      ],
    });
  });

  it('reads a bill with its actions, text versions and summaries; a missing one is null', async () => {
    const base = /api\.congress\.gov\/v3\/bill\/119\/hr\/997/;
    const { fetchFn } = fakeFetch([
      [/\/hr\/99999/, () => json({ error: 'No Bill matches the given query.' }, 404)],
      [new RegExp(`${base.source}/actions`), () => json({ actions: [{ actionDate: '2025-03-31', text: 'Passed/agreed to in House: On motion', type: 'Floor', sourceSystem: { code: 9, name: 'Library of Congress' } }] })],
      [
        new RegExp(`${base.source}/text`),
        () =>
          json({
            textVersions: [
              {
                type: 'Enrolled Bill',
                date: null,
                formats: [
                  { type: 'Formatted Text', url: 'https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr.htm' },
                  { type: 'PDF', url: 'https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr.pdf' },
                  { type: 'United States Legislative Markup', url: 'https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr_uslm.xml' },
                  { type: 'Formatted XML', url: 'https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr.xml' },
                ],
              },
              { type: 'Odd', date: null, formats: [{ type: 'PDF', url: 'javascript:alert(1)//BILLS-119hr997eh.pdf' }] },
            ],
          }),
      ],
      [
        new RegExp(`${base.source}/summaries`),
        () =>
          json({
            summaries: [
              { versionCode: '00', actionDate: '2025-02-05', actionDesc: 'Introduced in House', text: '<p>Old.</p>' },
              { versionCode: '49', actionDate: '2026-10-01', actionDesc: 'Passed Senate', text: '<p>New.</p>' },
            ],
          }),
      ],
      [
        base,
        () =>
          json({
            bill: {
              title: 'National Taxpayer Advocate Enhancement Act of 2025',
              originChamber: 'House',
              introducedDate: '2025-02-05',
              updateDate: '2026-10-14',
              policyArea: { name: 'Taxation' },
              sponsors: [{ bioguideId: 'F000446', fullName: 'Rep. Feenstra, Randy [R-IA-4]', party: 'R', state: 'IA', district: 4 }],
              cosponsors: { count: 1 },
              latestAction: { actionDate: '2026-10-14', text: 'Message on Senate action sent to the House.' },
            },
          }),
      ],
    ]);
    const source = new PublicBillSource(async () => KEY, fetchFn);
    expect(await source.bill({ congress: 119, type: 'hr', number: 99999 })).toBeNull();
    const bill = await source.bill({ congress: 119, type: 'hr', number: 997 });
    expect(bill).toMatchObject({
      title: 'National Taxpayer Advocate Enhancement Act of 2025',
      chamber: 'House',
      policyArea: 'Taxation',
      sponsors: [{ bioguideId: 'F000446', fullName: 'Rep. Feenstra, Randy [R-IA-4]', party: 'R', state: 'IA', district: 4 }],
      cosponsors: 1,
      laws: [],
      actions: [{ date: '2025-03-31', text: 'Passed/agreed to in House: On motion', type: 'Floor', source: 'Library of Congress' }],
      textVersions: [
        {
          version: 'enr',
          label: 'Enrolled Bill',
          date: null,
          htmlUrl: 'https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr.htm',
          pdfUrl: 'https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr.pdf',
          xmlUrl: 'https://www.congress.gov/119/bills/hr997/BILLS-119hr997enr.xml',
        },
      ],
      summaries: [
        { versionLabel: 'Passed Senate', date: '2026-10-01', paragraphs: ['New.'] },
        { versionLabel: 'Introduced in House', date: '2025-02-05', paragraphs: ['Old.'] },
      ],
    });
  });

  it('reads a version’s text from GovInfo, cut at the limit', async () => {
    const big = `<pre>${'x'.repeat(2_000_010)}</pre>`;
    const { fetchFn, calls } = fakeFetch([
      [/BILLS-119hr10538ih\/htm$/, () => new Response('<html><body><pre>A BILL &lt;all&gt;</pre></body></html>', { status: 200 })],
      [/BILLS-119hr1ih\/htm$/, () => new Response(big, { status: 200 })],
      [/BILLS-119hr10538eh\/htm$/, () => new Response('Not found', { status: 404 })],
    ]);
    const source = new PublicBillSource(async () => KEY, fetchFn);
    expect(await source.text({ congress: 119, type: 'hr', number: 10538, version: 'ih' })).toEqual({
      congress: 119,
      type: 'hr',
      number: 10538,
      version: 'ih',
      label: 'Introduced in House',
      text: 'A BILL <all>',
      truncated: false,
      pdfUrl: 'https://www.govinfo.gov/content/pkg/BILLS-119hr10538ih/pdf/BILLS-119hr10538ih.pdf',
    });
    expect(calls[0]!.url).toBe('https://api.govinfo.gov/packages/BILLS-119hr10538ih/htm');
    expect(await source.text({ congress: 119, type: 'hr', number: 10538, version: 'eh' })).toBeNull();
    const cut = await source.text({ congress: 119, type: 'hr', number: 1, version: 'ih' });
    expect(cut).toMatchObject({ truncated: true });
    expect(cut!.text).toHaveLength(2_000_000);
  });

  it.each([
    [429, 'rate_limited', /too many requests with this key this hour/],
    [403, 'key_refused', /refused the api\.data\.gov key/],
    [500, 'unreachable', /could not be reached/],
  ] as const)('says which service failed and how (%i)', async (status, kind, message) => {
    const { fetchFn } = fakeFetch([[/search$/, () => json({ message: 'no' }, status)]]);
    const error = await new PublicBillSource(async () => KEY, fetchFn).search(SEARCH, 119).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BillSourceError);
    expect(error).toMatchObject({ kind, service: 'GovInfo', message: expect.stringMatching(message) });
  });

  it('treats a network failure as unreachable', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(new PublicBillSource(async () => KEY, fetchFn).bill({ congress: 119, type: 'hr', number: 1 })).rejects.toMatchObject({
      kind: 'unreachable',
      service: 'Congress.gov',
    });
  });
});
