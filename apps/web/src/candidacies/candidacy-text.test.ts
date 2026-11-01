import { describe, expect, it } from 'vitest';
import { OFFICE_DISTRICTS, PUBLIC_OFFICES, templateProblem, type District } from 'ustp-domain';
import {
  areaText,
  ballotLabelText,
  BLANK_EMAIL,
  districtPeopleText,
  districtText,
  electionDay,
  emptyOfficeText,
  feedNote,
  localToday,
  mailtoLink,
  notUpText,
  OFFICE_CHOICES,
  officesText,
  officeShown,
  personCaption,
  profilesNote,
  recordsCredit,
  runningGapsText,
  runningText,
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
    expect([feedNote('sos', 'off'), feedNote('sos', 'unavailable')]).toEqual([null, expect.stringMatching(/^The Secretary of State’s list of who is on the ballot did not answer/)]);
    expect(feedNote('congress', 'off')).toBeNull();
    expect([profilesNote('ok'), profilesNote('unavailable')]).toEqual([null, expect.stringMatching(/^Wikipedia and Wikidata did not answer/)]);
  });

  it('says whom each email template suits; the blank email has only placeholders the page fills in', () => {
    expect(templateSuitsText({ offices: [], audience: 'anyone' })).toBe('Every office · Anyone listed');
    expect(templateSuitsText({ offices: ['county', 'local'], audience: 'candidate' })).toBe('County offices, City or town offices · People running');
    expect(templateProblem(BLANK_EMAIL.body)).toBeNull();
  });

  it('says on a district’s pin who is the party’s candidate there, who represents the member and who else runs', () => {
    const cd49 = { kind: 'congressional', geoid: '0649' } as const;
    const ca = { kind: 'state', geoid: '06' } as const;
    const people = {
      party: [{ name: 'Ada Brooks', district: cd49 }],
      holders: [
        { name: 'Mike Levin', district: cd49 },
        { name: 'Alex Padilla', district: ca },
        { name: 'Adam Schiff', district: ca },
      ],
      others: [
        { name: 'Mike Levin', district: cd49 },
        { name: 'Armen Kurdian', district: cd49 },
        { name: 'Mike Levin', district: cd49 },
      ],
    };
    expect(districtPeopleText(people, cd49)).toBe('Transhumanist Party: Ada Brooks · Your representative: Mike Levin · Others running: Mike Levin, Armen Kurdian');
    expect(districtPeopleText(people, ca)).toBe('Your representatives: Alex Padilla, Adam Schiff');
    expect(districtPeopleText(people, { kind: 'county', geoid: '06073' })).toBe('No one is listed here yet.');
  });

  it('says a party candidate’s ballot label only when it is not the party’s', () => {
    expect(ballotLabelText('Independent')).toBe('on the ballot as Independent');
    expect(ballotLabelText('Transhumanist')).toBeNull();
    expect(ballotLabelText('U.S. Transhumanist Party')).toBeNull();
    expect(ballotLabelText(null)).toBeNull();
  });

  it('names the offices nobody else runs for, and the seats not up, in a line each', () => {
    const president = { office: 'us_president', district: { kind: 'nation', name: 'United States' } } as const;
    const sd39 = { office: 'state_upper', district: { kind: 'state_upper', name: 'State Senate District 39' } } as const;
    const senate = { office: 'us_senate', district: { kind: 'state', name: 'CA' } } as const;
    expect(officesText([president, sd39])).toBe('President; State Senate (State Senate District 39)');
    expect(runningGapsText([senate], [president, sd39], 2026)).toEqual([
      'No election in 2026 for: U.S. Senate.',
      'No one else is listed as running for: President; State Senate (State Senate District 39).',
    ]);
    expect(runningGapsText([], [], 2026)).toEqual([]);
  });

  it('puts a person on one line: their title only where the office’s heading does not say it, party, source and election', () => {
    const levin = { office: 'us_house', officeTitle: 'U.S. Representative', party: 'Democratic Party', source: 'fec', role: 'candidate', election: '2026' } as const;
    expect(personCaption(levin)).toBe('Democratic Party · Filed with the FEC · Running in 2026');
    expect(personCaption({ ...levin, officeTitle: 'Delegate to the U.S. House', party: null })).toBe('Delegate to the U.S. House · Filed with the FEC · Running in 2026');
    expect(personCaption({ ...levin, office: 'statewide', officeTitle: 'Governor', source: 'admin', election: '2026-11-03' })).toBe(
      `Governor · Democratic Party · Added by the communications team · Election ${electionDay('2026-11-03')}`,
    );
    expect(personCaption({ ...levin, office: 'us_senate', officeTitle: 'U.S. Senator', source: 'congress', role: 'holder', election: null })).toBe(
      'Democratic Party · Member of Congress',
    );
    expect(runningText(null)).toBe('Running in the next election');
  });

  it('lists every office of an area, but the presidency with nobody listed only in a presidential year', () => {
    const empty = { holders: [], candidates: [] };
    expect(officeShown({ office: 'state_lower', ...empty }, 2026)).toBe(true);
    expect(officeShown({ office: 'us_president', ...empty }, 2026)).toBe(false);
    expect(officeShown({ office: 'us_president', ...empty }, 2028)).toBe(true);
    expect(officeShown({ office: 'us_president', holders: [], candidates: [{}] }, 2026)).toBe(true);
  });

  it('says when nobody is listed for an office, and who adds the people no public record lists', () => {
    expect(emptyOfficeText('state_upper', false)).toBe('No one is listed for this office yet.');
    expect(emptyOfficeText('us_house', true)).toBe('Nobody running is listed yet.');
    expect(emptyOfficeText('local', true)).toMatch(/^Nobody running is listed yet\. No public record this site reads lists city and town officials, such as the mayor and council members: the party’s communications team adds them\.$/);
  });

  it('says when a seat is not up this year, and credits each record the people come from', () => {
    expect(notUpText(2026)).toBe('No election for this seat in 2026.');
    expect(recordsCredit(false, false)).toBe('Candidates for Congress and President from the FEC; biographies from Wikipedia and Wikidata, by FEC and Congress ID.');
    expect(recordsCredit(true, true)).toBe(
      'Candidates for Congress and President from the FEC; candidates on California’s ballot from its Secretary of State; members of Congress from the congress-legislators project; state legislators from Open States; biographies from Wikipedia and Wikidata, by FEC and Congress ID.',
    );
  });
});
