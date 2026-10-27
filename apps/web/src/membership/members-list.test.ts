import { describe, expect, it } from 'vitest';
import type { MemberRecord, PositionsView } from 'ustp-domain';
import {
  filterRows,
  initials,
  memberRows,
  membersCsv,
  membersCsvFileName,
  noOfficeText,
  sinceText,
  sortRows,
  statusCounts,
  statusFilters,
  type MemberRow,
} from './members-list.js';

function member(accountId: string, legalName: string, over: Partial<MemberRecord> = {}): MemberRecord {
  return {
    accountId,
    status: 'active',
    legalName,
    preferredName: null,
    state: 'NY',
    contact: { city: 'Springfield', postalCode: '10001', phone: '+15551234567' },
    communications: null,
    bylawsVersion: '2026.1',
    memberSince: '2026-10-22T12:00:00.000Z',
    statusChangedAt: '2026-10-22T12:00:00.000Z',
    ...over,
  };
}

const view: PositionsView = {
  positions: [
    { positionId: 'chair', title: 'Chair', description: 'National committee', seats: 1, termMonths: 24, definedAt: '', approvalId: null },
    { positionId: 'dc', title: 'State Chair', description: 'District of Columbia', seats: 1, termMonths: 24, definedAt: '', approvalId: null },
  ],
  terms: [
    term('t1', 'dc', 'a2', 'active'),
    term('t2', 'chair', 'a2', 'active'),
    term('t3', 'chair', 'a3', 'ended'),
    term('t4', 'chair', null, 'active'),
  ],
};

function term(termId: string, positionId: string, accountId: string | null, status: 'active' | 'ended'): PositionsView['terms'][number] {
  return {
    termId,
    positionId,
    electionId: 'e',
    contestId: 'c',
    candidateId: 'k',
    holderName: 'Someone',
    accountId,
    startsAt: '',
    endsAt: '',
    resultsHash: '',
    status,
    endedAt: null,
    endReason: null,
  };
}

const rows: MemberRow[] = memberRows(
  [
    member('a1', 'Ada Brooks', { state: 'CA' }),
    member('a2', 'Ben Cruz', { state: 'DC', preferredName: 'Benji' }),
    member('a3', 'Cléo Dunn', { status: 'suspended', memberSince: '2025-01-05T00:00:00.000Z' }),
    member('a4', 'Dana Ito', { status: 'applicant', memberSince: null }),
  ],
  view,
);
const names = (list: readonly MemberRow[]) => list.map((r) => r.member.legalName);

describe('memberRows', () => {
  it('gives each member the offices their account holds now, by title', () => {
    expect(rows.map((r) => r.offices.map((o) => o.title))).toEqual([[], ['Chair', 'State Chair'], [], []]);
    expect(rows[1]!.offices[1]).toEqual({ title: 'State Chair', description: 'District of Columbia' });
  });
});

describe('noOfficeText', () => {
  it('says Member only while there is a membership', () => {
    expect(['active', 'lapsed', 'suspended', 'applicant', 'rejected', 'resigned'].map((s) => noOfficeText(s as never))).toEqual([
      'Member',
      'Member',
      'Member',
      '—',
      '—',
      '—',
    ]);
  });
});

describe('initials', () => {
  it('takes the first and last words that start with a letter', () => {
    expect(initials('Ada Brooks')).toBe('AB');
    expect(initials('Test Voter 10')).toBe('TV');
    expect(initials('test')).toBe('T');
    expect(initials('  Mary Ann  Smith ')).toBe('MS');
    expect(initials('Élodie de la Tour')).toBe('ÉT');
    expect(initials('42')).toBe('');
  });
});

describe('filterRows', () => {
  it('matches part of the legal or preferred name, ignoring case and accents', () => {
    expect(names(filterRows(rows, { search: 'CLEO', state: '' }))).toEqual(['Cléo Dunn']);
    expect(names(filterRows(rows, { search: 'benji', state: '' }))).toEqual(['Ben Cruz']);
    expect(names(filterRows(rows, { search: '  ', state: '' }))).toHaveLength(4);
  });

  it('keeps one state', () => {
    expect(names(filterRows(rows, { search: '', state: 'NY' }))).toEqual(['Cléo Dunn', 'Dana Ito']);
  });
});

describe('statusCounts and statusFilters', () => {
  it('counts every status', () => {
    expect(statusCounts(rows)).toEqual({ applicant: 1, active: 2, lapsed: 0, suspended: 1, resigned: 0, rejected: 0 });
  });

  it('always offers Active, Lapsed, Suspended and Resigned; Applicant and Rejected only when someone has them', () => {
    expect(statusFilters(statusCounts(rows), null)).toEqual(['applicant', 'active', 'lapsed', 'suspended', 'resigned']);
    expect(statusFilters(statusCounts(rows.slice(0, 3)), null)).toEqual(['active', 'lapsed', 'suspended', 'resigned']);
    expect(statusFilters(statusCounts(rows.slice(0, 3)), 'rejected')).toEqual(['active', 'lapsed', 'suspended', 'resigned', 'rejected']);
  });
});

describe('sortRows', () => {
  it('sorts by name either way', () => {
    expect(names(sortRows(rows, 'name', false))).toEqual(['Ada Brooks', 'Ben Cruz', 'Cléo Dunn', 'Dana Ito']);
    expect(names(sortRows(rows, 'name', true))).toEqual(['Dana Ito', 'Cléo Dunn', 'Ben Cruz', 'Ada Brooks']);
  });

  it('keeps members without an office or a member-since date last, ties by name', () => {
    expect(names(sortRows(rows, 'position', true))).toEqual(['Ben Cruz', 'Ada Brooks', 'Cléo Dunn', 'Dana Ito']);
    expect(names(sortRows(rows, 'since', false))).toEqual(['Cléo Dunn', 'Ada Brooks', 'Ben Cruz', 'Dana Ito']);
    expect(names(sortRows(rows, 'since', true))).toEqual(['Ada Brooks', 'Ben Cruz', 'Cléo Dunn', 'Dana Ito']);
  });

  it('sorts by state and by status label', () => {
    expect(names(sortRows(rows, 'state', false))).toEqual(['Ada Brooks', 'Ben Cruz', 'Cléo Dunn', 'Dana Ito']);
    expect(names(sortRows(rows, 'status', false))).toEqual(['Ada Brooks', 'Ben Cruz', 'Dana Ito', 'Cléo Dunn']);
  });
});

describe('sinceText', () => {
  const now = new Date('2026-10-26T15:00:00.000Z');

  it('gives the date and how long ago', () => {
    expect(sinceText('2026-10-22T12:00:00.000Z', now, 'en-US')).toEqual({ date: 'Oct 22, 2026', ago: '4 days ago' });
    expect(sinceText('2026-10-26T09:00:00.000Z', now, 'en-US')?.ago).toBe('today');
    expect(sinceText('2026-10-25T09:00:00.000Z', now, 'en-US')?.ago).toBe('yesterday');
    expect(sinceText('2026-07-01T00:00:00.000Z', now, 'en-US')?.ago).toBe('3 months ago');
    expect(sinceText('2024-01-01T00:00:00.000Z', now, 'en-US')?.ago).toBe('2 years ago');
    expect(sinceText('2026-10-27T00:00:00.000Z', now, 'en-US')?.ago).toBe('today');
  });

  it('is null for someone never Active', () => {
    expect(sinceText(null, now)).toBeNull();
  });
});

describe('membersCsv', () => {
  it('has the table columns and the account ID, never contact details', () => {
    expect(membersCsv(rows.slice(0, 2))).toBe(
      'Name,Account ID,Offices,State,Status,Member since\r\n' +
        'Ada Brooks,a1,,CA,Active,2026-10-22\r\n' +
        'Ben Cruz,a2,Chair; State Chair,DC,Active,2026-10-22\r\n',
    );
    expect(membersCsv(rows)).not.toMatch(/Springfield|10001|5551234567/);
  });

  it('quotes and defuses what a spreadsheet would misread', () => {
    const csv = membersCsv(memberRows([member('x', '=HYPERLINK("http://evil")'), member('y', 'Doe, Jane')], view));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"Doe, Jane"');
  });

  it('is named by the date', () => {
    expect(membersCsvFileName(new Date(2026, 9, 6))).toBe('ustp-members-2026-10-06.csv');
  });
});
