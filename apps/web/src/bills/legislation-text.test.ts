import { describe, expect, it } from 'vitest';
import type { ScorecardRow } from 'ustp-domain';
import { billShareable, filterRows, memberShareable, positionLine, scoreColor, scorePercent } from './legislation-text.js';

const ROW: ScorecardRow = { memberId: 'C001131', name: 'Greg Casar', chamber: 'house', party: 'D', state: 'TX', district: 35, with: 4, against: 1, missed: 1, score: 0.8 };

describe('the Legislation page’s wording (design §5.14)', () => {
  it('says what the party’s position is, or that it took none', () => {
    expect(positionLine('nay')).toBe('The party’s position: Nay');
    expect(positionLine(null)).toMatch(/no position/);
  });

  it('shows a score as a percentage and a colour', () => {
    expect([scorePercent(0.8), scorePercent(1), scorePercent(null)]).toEqual(['80%', '100%', '–']);
    expect([scoreColor(0.8), scoreColor(0.5), scoreColor(0.1), scoreColor(null)]).toEqual(['positive', 'deep-orange-10', 'negative', 'grey-7']);
  });

  it('shares a bill’s public page with the team’s summary, or its title', () => {
    const bill = { id: '119-hr-10538', label: 'H.R. 10538', title: 'Ban Artificial Superintelligence Act of 2026', summary: '' };
    expect(billShareable(bill, 'https://example.org')).toEqual({
      text: 'H.R. 10538: Ban Artificial Superintelligence Act of 2026',
      url: 'https://example.org/legislation/119-hr-10538',
      hashtags: [],
      title: 'H.R. 10538: Ban Artificial Superintelligence Act of 2026',
    });
    expect(billShareable({ ...bill, summary: 'Why it matters.' }, 'https://example.org').text).toBe('Why it matters.');
  });

  it('shares a member’s scorecard with their score', () => {
    const shared = memberShareable(ROW, 'https://example.org');
    expect(shared.url).toBe('https://example.org/scorecard/C001131');
    expect(shared.text).toBe('Rep. Greg Casar (D-TX-35) voted with the U.S. Transhumanist Party’s position on 4 of 5 scored votes on science, AI and longevity bills.');
  });

  it('finds members by name, state and chamber', () => {
    const rows = [ROW, { ...ROW, memberId: 'S000033', name: 'Bernard Sanders', chamber: 'senate' as const, state: 'VT', district: null }];
    expect(filterRows(rows, 'casar', null, null).map((r) => r.memberId)).toEqual(['C001131']);
    expect(filterRows(rows, '', 'VT', null).map((r) => r.memberId)).toEqual(['S000033']);
    expect(filterRows(rows, '', null, 'house').map((r) => r.memberId)).toEqual(['C001131']);
    expect(filterRows(rows, '  ', null, null)).toHaveLength(2);
  });
});
