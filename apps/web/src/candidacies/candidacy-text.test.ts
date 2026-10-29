import { describe, expect, it } from 'vitest';
import { OFFICE_DISTRICTS, PUBLIC_OFFICES, type District } from 'ustp-domain';
import { districtText, localToday, OFFICE_CHOICES, stateName, websiteText } from './candidacy-text.js';

const district = (over: Partial<District>): Pick<{ district: District }, 'district'> => ({
  district: { kind: 'congressional', geoid: '0612', state: 'CA', name: 'Congressional District 12', point: null, vintage: null, ...over },
});

describe('candidacy wording', () => {
  it('names the district with its state, or just the state or country for offices elected across one', () => {
    expect(districtText(district({}))).toBe('Congressional District 12, California');
    expect(districtText(district({ kind: 'state', geoid: '06', name: 'California' }))).toBe('California');
    expect(districtText(district({ kind: 'nation', geoid: 'US', state: null, name: 'United States' }))).toBe('United States');
    expect(stateName('PR')).toBe('Puerto Rico');
  });

  it('offers every office with a title to suggest', () => {
    for (const office of PUBLIC_OFFICES) expect(OFFICE_CHOICES[office].title).not.toBe('');
    expect(OFFICE_DISTRICTS.us_senate).toBe('state');
  });

  it('shows a website without its scheme, and today in the reader’s calendar', () => {
    expect(websiteText('https://ada.example/')).toBe('ada.example');
    expect(localToday(new Date(2026, 10, 3, 23, 30))).toBe('2026-11-03');
  });
});
