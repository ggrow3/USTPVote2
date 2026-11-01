import { describe, expect, it } from 'vitest';
import { areaLookupSchema, orderPositions, positionText, PROFILE_LIMITS, shortened, yearSpan, type ProfilePosition } from '../index.js';

const HOUSE = 'member of the United States House of Representatives';
const at = (title: string, start: string | null, end: string | null, place: string | null = null): ProfilePosition => ({ title, place, start, end });

describe('profiles', () => {
  it('write the years of an office without calling one with no end current', () => {
    expect(yearSpan(at(HOUSE, '2013', '2019'))).toBe('2013–2019');
    expect(yearSpan(at(HOUSE, '2019', '2019'))).toBe('2019');
    expect(yearSpan(at(HOUSE, '2019', null))).toBe('from 2019');
    expect(yearSpan(at(HOUSE, null, '2009'))).toBe('until 2009');
    expect(yearSpan(at(HOUSE, null, null))).toBeNull();
    expect(positionText(at(HOUSE, '2019', null, "California's 49th congressional district"))).toBe(
      "Member of the United States House of Representatives, California's 49th congressional district, from 2019",
    );
    expect(positionText(at('mayor', null, null))).toBe('Mayor');
  });

  it('put offices most recent first, each office in one place as one line across its terms', () => {
    const ordered = orderPositions([
      at('member of the State Assembly', '2010', '2014'),
      at(HOUSE, '2019', '2021', 'CA-49'),
      at(HOUSE, '2021', '2023', 'CA-49'),
      at(HOUSE, '2023', null, 'CA-49'),
      at('city council member', '2006', '2010'),
      at(HOUSE, '2015', '2017', 'CA-50'),
      at('House of Representatives', null, null),
      at('chair of the Rules Committee', null, null),
    ]);
    expect(ordered.map(positionText)).toEqual([
      'Member of the United States House of Representatives, CA-49, from 2019',
      'Member of the United States House of Representatives, CA-50, 2015–2017',
      'Member of the State Assembly, 2010–2014',
      'City council member, 2006–2010',
      'Chair of the Rules Committee',
    ]);
    const many = Array.from({ length: 12 }, (_, i) => at(`office ${i}`, String(2000 + i), String(2001 + i)));
    expect(orderPositions(many)).toHaveLength(PROFILE_LIMITS.positions);
    expect(orderPositions(many)[0]!.title).toBe('office 11');
  });

  it('cut a long biography at a sentence near the end, else at a word', () => {
    expect(shortened('  One.   Two.  ', 100)).toBe('One. Two.');
    expect(shortened('First sentence here. Second sentence that goes on and on.', 30)).toBe('First sentence here.');
    expect(shortened('First sentence here. Second sentence that goes on and on.', 40)).toBe('First sentence here. Second sentence…');
    expect(shortened('Averyveryverylongword and more words follow here', 30)).toBe('Averyveryverylongword and…');
  });
});

describe('a typed ZIP code', () => {
  it('is five digits, nothing else', () => {
    expect(areaLookupSchema.parse({ zip: ' 92130 ' })).toEqual({ zip: '92130' });
    for (const zip of ['9213', '92130-1234', 'abcde', '']) expect(areaLookupSchema.safeParse({ zip }).success).toBe(false);
    expect(areaLookupSchema.safeParse({ zip: '92130', state: 'CA' }).success).toBe(false);
  });
});
