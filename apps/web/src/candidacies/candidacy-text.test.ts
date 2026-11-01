import { describe, expect, it } from 'vitest';
import { OFFICE_DISTRICTS, PUBLIC_OFFICES, templateProblem, type District } from 'ustp-domain';
import {
  areaText,
  BLANK_EMAIL,
  districtPeopleText,
  districtText,
  feedNote,
  localToday,
  mailtoLink,
  OFFICE_CHOICES,
  profilesNote,
  stateName,
  templateSuitsText,
  websiteText,
} from './candidacy-text.js';

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

  it('says where the member’s area comes from, and when changing the ZIP code would help', () => {
    expect(areaText({ state: 'CA', basis: 'zip' })).toMatchObject({
      text: expect.stringMatching(/^Nationwide and California offices, and the districts the ZIP code on your/),
      link: expect.stringMatching(/^Moved\?/),
    });
    expect(areaText({ state: 'TX', basis: 'no_zip' }).text).toBe('Nationwide offices and all of Texas: your membership record has no ZIP code.');
    expect(areaText({ state: 'TX', basis: 'unplaced' }).text).toMatch(/no area for the ZIP code on your membership record in Texas/);
    expect(areaText({ state: 'TX', basis: 'unavailable' })).toMatchObject({ text: expect.stringMatching(/not answering/), link: null });
  });

  it('names a ZIP code someone typed, with no link to an account', () => {
    expect(areaText({ state: 'CA', basis: 'zip' }, '92130')).toMatchObject({ text: expect.stringMatching(/the districts ZIP code 92130 reaches into/), link: null });
    expect(areaText({ state: 'CA', basis: 'unplaced' }, '92130').text).toBe('Nationwide offices and all of California: the Census draws no area for ZIP code 92130.');
  });

  it('opens the member’s email app with the email filled in, and says which public record is missing', () => {
    expect(mailtoLink('ana@senate.example', 'Hi & bye', 'Line one\nLine two?')).toBe(
      'mailto:ana@senate.example?subject=Hi%20%26%20bye&body=Line%20one%0ALine%20two%3F',
    );
    expect(feedNote('fec', 'ok')).toBeNull();
    expect(feedNote('openstates', 'off')).toMatch(/not connected to Open States/);
    expect(feedNote('congress', 'unavailable')).toMatch(/^The list of members of Congress did not answer/);
    expect([feedNote('civic', 'off'), feedNote('civic', 'unavailable')]).toEqual([null, expect.stringMatching(/^Google’s ballot data, which lists state and local contests, did not/)]);
    expect([profilesNote('ok'), profilesNote('unavailable')]).toEqual([null, expect.stringMatching(/^Wikipedia and Wikidata did not answer/)]);
  });

  it('says whom each email template suits; the blank email has only placeholders the page fills in', () => {
    expect(templateSuitsText({ offices: [], audience: 'anyone' })).toBe('Every office · Anyone listed');
    expect(templateSuitsText({ offices: ['county', 'local'], audience: 'candidate' })).toBe('County offices, City or town offices · People running');
    expect(templateProblem(BLANK_EMAIL.body)).toBeNull();
  });

  it('says on a district’s pin who is in office there and who is running', () => {
    const cd49 = { kind: 'congressional', geoid: '0649', state: 'CA', name: 'Congressional District 49' } as const;
    const people = [
      { role: 'holder', name: 'Mike Levin', district: cd49 },
      { role: 'candidate', name: 'Mike Levin', district: cd49 },
      { role: 'candidate', name: 'Armen Kurdian', district: cd49 },
      { role: 'candidate', name: 'Mike Levin', district: cd49 },
      { role: 'holder', name: 'Alex Padilla', district: { kind: 'state', geoid: '06', state: 'CA', name: 'CA' } },
    ] as const;
    expect(districtPeopleText(people, cd49)).toBe('In office: Mike Levin · Running: Mike Levin, Armen Kurdian');
    expect(districtPeopleText(people, { kind: 'county', geoid: '06073' })).toBe('No one is listed here yet.');
  });
});
