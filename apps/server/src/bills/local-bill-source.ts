import {
  BILL_LIMITS,
  BILL_TYPES,
  billId,
  billLabel,
  STAGE_VERSIONS,
  versionLabel,
  versionStage,
  type BillHit,
  type BillRecentPage,
  type BillRecord,
  type BillRef,
  type BillSearch,
  type BillSearchPage,
  type BillText,
  type BillVersionRef,
} from 'ustp-domain';
import type { BillRecentQuery, BillSource } from './bill-source.js';

/** A fixture bill: its record as Congress.gov describes it, and the text of each version GovInfo has. */
interface Fixture {
  readonly record: BillRecord;
  /** Members named on it (sponsor and cosponsors), as GovInfo's `member:` matches them. */
  readonly members: readonly string[];
  readonly texts: Readonly<Record<string, string>>;
}

const HR10538_TEXT = `[Congressional Bills 119th Congress]
[From the U.S. Government Publishing Office]
[H.R. 10538 Introduced in House (IH)]

119th CONGRESS
  2d Session
                               H. R. 10538

 To establish the Department of Artificial Intelligence and to provide
for the regulation of advanced artificial intelligence systems, and for
                            other purposes.

                    IN THE HOUSE OF REPRESENTATIVES

                           September 24, 2026

Mr. Casar introduced the following bill; which was referred to the
           Committee on Oversight and Government Reform

                                 A BILL

    Be it enacted by the Senate and House of Representatives of the
United States of America in Congress assembled,

SECTION 1. SHORT TITLE.

    This Act may be cited as the "Ban Artificial Superintelligence Act
of 2026".
                                 <all>`;

const action = (date: string, text: string, type: string) => ({ date, text, type, source: 'Library of Congress' });

/**
 * Real bills of the 119th Congress as Congress.gov and GovInfo described them on 2026-11-07, trimmed, and one made up
 * with roll calls: enough for the integration tests and local development to search, sort, open, watch and show bills
 * publicly without the internet.
 */
const FIXTURES: readonly Fixture[] = [
  {
    record: {
      congress: 119,
      type: 'hr',
      number: 10538,
      title: 'Ban Artificial Superintelligence Act of 2026',
      chamber: 'House',
      introducedDate: '2026-09-24',
      updatedAt: '2026-10-14T18:28:57Z',
      policyArea: 'Government Operations and Politics',
      sponsors: [{ bioguideId: 'C001131', fullName: 'Rep. Casar, Greg [D-TX-35]', party: 'D', state: 'TX', district: 35 }],
      cosponsors: 12,
      latestAction: { date: '2026-09-24', text: 'Referred to the House Committee on Oversight and Government Reform.' },
      laws: [],
      actions: [
        { date: '2026-09-24', text: 'Referred to the House Committee on Oversight and Government Reform.', type: 'IntroReferral', source: 'House floor actions' },
        action('2026-09-24', 'Introduced in House', 'IntroReferral'),
      ],
      summaries: [],
      textVersions: [
        {
          version: 'ih',
          label: 'Introduced in House',
          date: '2026-09-24',
          pdfUrl: 'https://www.congress.gov/119/bills/hr10538/BILLS-119hr10538ih.pdf',
          xmlUrl: 'https://www.congress.gov/119/bills/hr10538/BILLS-119hr10538ih.xml',
          htmlUrl: 'https://www.congress.gov/119/bills/hr10538/BILLS-119hr10538ih.htm',
        },
      ],
    },
    members: ['Casar', 'Khanna'],
    texts: { ih: HR10538_TEXT },
  },
  {
    record: {
      congress: 119,
      type: 's',
      number: 5493,
      title: 'Ban Artificial Superintelligence Act of 2026',
      chamber: 'Senate',
      introducedDate: '2026-09-23',
      updatedAt: '2026-10-14T18:29:03Z',
      policyArea: 'Government Operations and Politics',
      sponsors: [{ bioguideId: 'S000033', fullName: 'Sen. Sanders, Bernard [I-VT]', party: 'I', state: 'VT', district: null }],
      cosponsors: 0,
      latestAction: { date: '2026-09-23', text: 'Read twice and referred to the Committee on Commerce, Science, and Transportation.' },
      laws: [],
      actions: [action('2026-09-23', 'Introduced in Senate', 'IntroReferral')],
      summaries: [],
      textVersions: [{ version: 'is', label: 'Introduced in Senate', date: '2026-09-23', pdfUrl: null, xmlUrl: null, htmlUrl: null }],
    },
    members: ['Sanders'],
    texts: { is: 'A BILL To ban the development of artificial superintelligence, and for other purposes.' },
  },
  {
    record: {
      congress: 119,
      type: 'hr',
      number: 10515,
      title: 'Artificial Intelligence Education and Workforce Readiness Act of 2026',
      chamber: 'House',
      introducedDate: '2026-09-21',
      updatedAt: '2026-09-29T14:58:13Z',
      policyArea: 'Education',
      sponsors: [{ bioguideId: 'B001278', fullName: 'Rep. Bonamici, Suzanne [D-OR-1]', party: 'D', state: 'OR', district: 1 }],
      cosponsors: 8,
      latestAction: { date: '2026-09-21', text: 'Referred to the Committee on Education and Workforce.' },
      laws: [],
      actions: [action('2026-09-21', 'Introduced in House', 'IntroReferral')],
      summaries: [],
      textVersions: [{ version: 'ih', label: 'Introduced in House', date: '2026-09-21', pdfUrl: null, xmlUrl: null, htmlUrl: null }],
    },
    members: ['Bonamici'],
    texts: { ih: 'A BILL To support artificial intelligence education and workforce readiness, and for other purposes.' },
  },
  {
    record: {
      congress: 119,
      type: 'sres',
      number: 918,
      title: 'A resolution establishing the Select Committee on Artificial Intelligence.',
      chamber: 'Senate',
      introducedDate: '2026-09-29',
      updatedAt: '2026-10-09T16:30:12Z',
      policyArea: 'Congress',
      sponsors: [{ bioguideId: 'G000574', fullName: 'Sen. Gallego, Ruben [D-AZ]', party: 'D', state: 'AZ', district: null }],
      cosponsors: 0,
      latestAction: { date: '2026-09-29', text: 'Referred to the Committee on Rules and Administration. (text: CR S5172-5174)' },
      laws: [],
      actions: [action('2026-09-29', 'Submitted in the Senate', 'IntroReferral')],
      summaries: [],
      textVersions: [{ version: 'is', label: 'Introduced in Senate', date: '2026-09-29', pdfUrl: null, xmlUrl: null, htmlUrl: null }],
    },
    members: ['Gallego'],
    texts: { is: 'RESOLUTION Establishing the Select Committee on Artificial Intelligence.' },
  },
  {
    record: {
      congress: 119,
      type: 'hr',
      number: 997,
      title: 'National Taxpayer Advocate Enhancement Act of 2025',
      chamber: 'House',
      introducedDate: '2025-02-05',
      updatedAt: '2026-10-14T12:00:00Z',
      policyArea: 'Taxation',
      sponsors: [{ bioguideId: 'F000446', fullName: 'Rep. Feenstra, Randy [R-IA-4]', party: 'R', state: 'IA', district: 4 }],
      cosponsors: 1,
      latestAction: { date: '2026-10-14', text: 'Message on Senate action sent to the House.' },
      laws: [],
      actions: [
        { date: '2026-10-14', text: 'Message on Senate action sent to the House.', type: 'Floor', source: 'Senate' },
        action('2026-09-28', 'Passed/agreed to in Senate: Passed Senate without amendment by Unanimous Consent', 'Floor'),
        action('2025-03-31', 'Passed/agreed to in House: On motion to suspend the rules and pass the bill, as amended Agreed to by the Yeas and Nays', 'Floor'),
        action('2025-03-27', 'Reported (Amended) by the Committee on Ways and Means. H. Rept. 119-46.', 'Committee'),
        action('2025-02-05', 'Introduced in House', 'IntroReferral'),
      ],
      summaries: [
        {
          versionLabel: 'Introduced in House',
          date: '2025-02-05',
          paragraphs: [
            'National Taxpayer Advocate Enhancement Act of 2025',
            'This bill authorizes the National Taxpayer Advocate to appoint legal counsel within the Taxpayer Advocate Service to report directly to the National Taxpayer Advocate.',
          ],
        },
      ],
      textVersions: [
        { version: 'enr', label: 'Enrolled Bill', date: null, pdfUrl: null, xmlUrl: null, htmlUrl: null },
        { version: 'eh', label: 'Engrossed in House', date: '2025-03-31', pdfUrl: null, xmlUrl: null, htmlUrl: null },
        { version: 'rh', label: 'Reported in House', date: '2025-03-27', pdfUrl: null, xmlUrl: null, htmlUrl: null },
        { version: 'ih', label: 'Introduced in House', date: '2025-02-05', pdfUrl: null, xmlUrl: null, htmlUrl: null },
      ],
    },
    members: ['Feenstra'],
    texts: {
      ih: 'A BILL To amend the Internal Revenue Code of 1986 to provide the National Taxpayer Advocate with legal counsel.',
      rh: 'A BILL To amend the Internal Revenue Code of 1986 to provide the National Taxpayer Advocate with legal counsel (reported).',
      eh: 'AN ACT To amend the Internal Revenue Code of 1986 to provide the National Taxpayer Advocate with legal counsel.',
      enr: 'AN ACT To amend the Internal Revenue Code of 1986 to provide the National Taxpayer Advocate with legal counsel. (enrolled)',
    },
  },
  {
    // Made up, unlike the others: a bill with House and Senate roll calls, for the scorecard (design §5.14,
    // "Legislation and the scorecard"). LocalRollCallSource has its roll calls' votes.
    record: {
      congress: 119,
      type: 'hr',
      number: 6100,
      title: 'Longevity Research Acceleration Act (a local fixture)',
      chamber: 'House',
      introducedDate: '2026-03-02',
      updatedAt: '2026-10-20T20:00:00Z',
      policyArea: 'Health',
      sponsors: [{ bioguideId: 'K000389', fullName: 'Rep. Khanna, Ro [D-CA-17]', party: 'D', state: 'CA', district: 17 }],
      cosponsors: 3,
      latestAction: { date: '2026-10-20', text: 'Passed Senate without amendment by Yea-Nay Vote. 3 - 1. Record Vote Number: 250.' },
      laws: [],
      actions: [
        {
          date: '2026-10-20',
          text: 'Passed Senate without amendment by Yea-Nay Vote. 3 - 1. Record Vote Number: 250.',
          type: 'Floor',
          source: 'Senate',
          votes: [{ chamber: 'senate', congress: 119, session: 2, roll: 250, date: '2026-10-20T19:30:00Z' }],
        },
        {
          ...action('2026-10-20', 'Passed/agreed to in Senate: Passed Senate without amendment by Yea-Nay Vote. 3 - 1. Record Vote Number: 250.', 'Floor'),
          votes: [{ chamber: 'senate', congress: 119, session: 2, roll: 250, date: '2026-10-20T19:30:00Z' }],
        },
        {
          ...action('2026-06-10', 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 3 - 2 (Roll no. 301).', 'Floor'),
          votes: [{ chamber: 'house', congress: 119, session: 2, roll: 301, date: '2026-06-10T21:00:00Z' }],
        },
        {
          date: '2026-06-10',
          text: 'On motion to recommit Failed by the Yeas and Nays: 2 - 3 (Roll no. 300).',
          type: 'Floor',
          source: 'House floor actions',
          votes: [{ chamber: 'house', congress: 119, session: 2, roll: 300, date: '2026-06-10T20:40:00Z' }],
        },
        action('2026-05-01', 'Reported by the Committee on Energy and Commerce.', 'Committee'),
        action('2026-03-02', 'Introduced in House', 'IntroReferral'),
      ],
      summaries: [
        {
          versionLabel: 'Introduced in House',
          date: '2026-03-02',
          paragraphs: ['This made-up bill stands in for a real one in local development and tests: it would fund research into the biology of aging.'],
        },
      ],
      textVersions: [{ version: 'ih', label: 'Introduced in House', date: '2026-03-02', pdfUrl: null, xmlUrl: null, htmlUrl: null }],
    },
    members: ['Khanna'],
    texts: { ih: 'A BILL To accelerate research into the biology of aging, and for other purposes. (A local fixture.)' },
  },
];

const PUBLISHED: Readonly<Record<string, string>> = { 'hr-997-enr': '2026-10-01' };

/** Each printed version of each fixture, as GovInfo's search lists them. */
const versions = () =>
  FIXTURES.flatMap((f) =>
    Object.keys(f.texts).map((version) => {
      const listed = f.record.textVersions.find((v) => v.version === version);
      return { fixture: f, version, date: listed?.date ?? PUBLISHED[`${f.record.type}-${f.record.number}-${version}`] ?? null };
    }),
  );

/** Words in a search, phrases kept whole, lower case. */
function terms(words: string): string[] {
  return [...words.toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2])!);
}

/**
 * The emulator-only stand-in (`BILLS=local`, design §5.14): a few real bills, searched, sorted and opened in memory, so
 * the integration tests and local development send nothing anywhere.
 */
export class LocalBillSource implements BillSource {
  async search(search: BillSearch): Promise<BillSearchPage> {
    const wanted = search.words ? terms(search.words) : [];
    const matches = versions().filter(({ fixture, version, date }) => {
      const r = fixture.record;
      if (r.congress !== search.congress) return false;
      if (search.type && r.type !== search.type) return false;
      if (search.stage && !STAGE_VERSIONS[search.stage].includes(version)) return false;
      if (search.member && !fixture.members.some((m) => m.toLowerCase() === search.member!.toLowerCase())) return false;
      if (search.from && (!date || date < search.from)) return false;
      if (search.to && (!date || date > search.to)) return false;
      const haystack = `${r.title}\n${fixture.texts[version]}`.toLowerCase();
      return wanted.every((t) => haystack.includes(t));
    });
    const score = (m: (typeof matches)[number]) => wanted.reduce((n, t) => n + (m.fixture.record.title.toLowerCase().includes(t) ? 2 : 1), 0);
    const sorted = [...matches].sort((a, b) => {
      switch (search.sort) {
        case 'relevance':
          return score(b) - score(a);
        case 'newest':
          return (b.date ?? '').localeCompare(a.date ?? '');
        case 'oldest':
          return (a.date ?? '').localeCompare(b.date ?? '');
        case 'title':
          return a.fixture.record.title.localeCompare(b.fixture.record.title);
        case 'title_desc':
          return b.fixture.record.title.localeCompare(a.fixture.record.title);
      }
    });
    const offset = search.cursor ? Number(search.cursor) || 0 : 0;
    const page = sorted.slice(offset, offset + BILL_LIMITS.pageSize);
    const seen = new Map<string, BillHit>();
    for (const { fixture, version, date } of page) {
      const r = fixture.record;
      const ref: BillRef = { congress: r.congress, type: r.type, number: r.number };
      const id = billId(ref);
      const hit = seen.get(id);
      if (hit) {
        seen.set(id, { ...hit, otherVersions: [...hit.otherVersions, version] });
        continue;
      }
      seen.set(id, { ...ref, id, label: billLabel(ref), title: r.title, chamber: r.chamber, version, versionLabel: versionLabel(version), stage: versionStage(version), date, otherVersions: [] });
    }
    return { search, total: matches.length, hits: [...seen.values()], next: offset + BILL_LIMITS.pageSize < sorted.length ? String(offset + BILL_LIMITS.pageSize) : null };
  }

  async recent(query: BillRecentQuery): Promise<BillRecentPage> {
    const day = (r: BillRecord) => (r.updatedAt ?? '').slice(0, 10);
    const all = FIXTURES.map((f) => f.record)
      .filter((r) => r.congress === query.congress && (!query.type || r.type === query.type))
      .filter((r) => (!query.from || day(r) >= query.from) && (!query.to || day(r) <= query.to))
      .sort((a, b) => (query.sort === 'updated' ? -1 : 1) * (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '') || BILL_TYPES.indexOf(a.type) - BILL_TYPES.indexOf(b.type));
    const offset = (query.page - 1) * BILL_LIMITS.pageSize;
    const items = all.slice(offset, offset + BILL_LIMITS.pageSize).map((r) => {
      const ref: BillRef = { congress: r.congress, type: r.type, number: r.number };
      return { ...ref, id: billId(ref), label: billLabel(ref), title: r.title, chamber: r.chamber, introducedDate: r.introducedDate, updatedAt: r.updatedAt, latestAction: r.latestAction };
    });
    return { congress: query.congress, total: all.length, page: query.page, items, hasMore: offset + items.length < all.length };
  }

  async bill(ref: BillRef): Promise<BillRecord | null> {
    return FIXTURES.find((f) => billId(f.record) === billId(ref))?.record ?? null;
  }

  async text(ref: BillVersionRef): Promise<BillText | null> {
    const fixture = FIXTURES.find((f) => billId(f.record) === billId(ref));
    const text = fixture?.texts[ref.version];
    if (text === undefined) return null;
    const id = `BILLS-${ref.congress}${ref.type}${ref.number}${ref.version}`;
    return { ...ref, label: versionLabel(ref.version), text, truncated: false, pdfUrl: `https://www.govinfo.gov/content/pkg/${id}/pdf/${id}.pdf` };
  }
}
