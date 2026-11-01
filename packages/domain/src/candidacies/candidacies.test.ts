import { describe, expect, it } from 'vitest';
import {
  adminCandidacy,
  candidacyContent,
  candidacyDecisionSchema,
  candidacyInputSchema,
  candidacyStage,
  changeCandidacy,
  checkElectionDate,
  compareAdminCandidacies,
  comparePublicCandidacies,
  decideCandidacy,
  declareCandidacy,
  districtIdProblem,
  inCandidateArea,
  publicCandidacy,
  removeCandidacy,
  stateOfDistrict,
  withdrawCandidacy,
  type CandidacyContent,
  type CandidateArea,
  type CandidacyRecord,
  type District,
  type PublicCandidacy,
} from '../index.js';

const AT = '2026-10-28T12:00:00.000Z';
const LATER = '2026-10-29T12:00:00.000Z';

const CA12: District = {
  kind: 'congressional',
  geoid: '0612',
  state: 'CA',
  name: 'Congressional District 12',
  point: { lat: 37.8, lng: -122.2 },
  vintage: '120th Congressional Districts',
};

const INPUT = {
  office: 'us_house',
  officeTitle: 'U.S. Representative',
  state: 'CA',
  districtId: '0612',
  electionDate: '2028-11-07',
  election: 'general',
  ballotLabel: 'Transhumanist',
  platform: 'Longevity research funding.\r\nOpen science.',
  website: 'https://ada.example',
};

const content = (over: Partial<CandidacyContent> = {}): CandidacyContent => ({
  ...candidacyContent(candidacyInputSchema.parse(INPUT), CA12),
  ...over,
});

const ids = (candidacyId = 'c1') => ({ candidacyId, accountId: 'ada' });

function declared(over: Partial<CandidacyContent> = {}): CandidacyRecord {
  const outcome = declareCandidacy(content(over), [], ids(), AT);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.value;
}

function approved(record = declared()): CandidacyRecord {
  const outcome = decideCandidacy(record, { decision: 'approve', note: null, basedOn: record.version }, 'ma', LATER);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.value.record;
}

describe('the declaration form', () => {
  it('takes a district office with its state and district, and keeps the platform’s paragraphs', () => {
    const parsed = candidacyInputSchema.parse(INPUT);
    expect(parsed).toMatchObject({ office: 'us_house', state: 'CA', districtId: '0612', website: 'https://ada.example' });
    expect(candidacyContent(parsed, CA12).platform).toBe('Longevity research funding.\nOpen science.');
  });

  it('needs a state for everything but the presidency, and a district in that state for district offices', () => {
    const issues = (over: Record<string, unknown>) =>
      candidacyInputSchema.safeParse({ ...INPUT, ...over }).error?.issues.map((i) => [i.path.join('.'), i.message]) ?? [];
    expect(issues({ districtId: null })).toEqual([['districtId', 'choose the district']]);
    expect(issues({ districtId: '3601' })).toEqual([['districtId', 'that district is not in the state you chose']]);
    expect(issues({ state: null })).toEqual([['state', 'choose a state or territory']]);
    expect(issues({ state: 'ZZ' })).toEqual([['state', 'choose a state or territory']]);
    expect(issues({ office: 'us_senate', districtId: null })).toEqual([]);
    expect(issues({ office: 'us_president', state: null, districtId: null })).toEqual([]);
    expect(issues({ office: 'us_president' })).toEqual([['state', 'a nationwide office has no state']]);
  });

  it('wants an https website, a platform and the office’s title', () => {
    const paths = (over: Record<string, unknown>) =>
      candidacyInputSchema.safeParse({ ...INPUT, ...over }).error?.issues.map((i) => [i.path.join('.'), i.message]) ?? [];
    expect(paths({ website: 'http://ada.example' })).toEqual([['website', 'use the https:// address']]);
    expect(paths({ website: '' })).toEqual([]);
    expect(paths({ platform: '  ' })).toEqual([['platform', 'say what you stand for']]);
    expect(paths({ officeTitle: '' })).toEqual([['officeTitle', 'enter the office as it appears on the ballot']]);
    expect(paths({ electionDate: '2028-02-30' })).toEqual([['electionDate', 'enter the election date as YYYY-MM-DD']]);
  });

  it('allows letters and dashes in a district code, never anything that could change a query', () => {
    expect(districtIdProblem('state_lower', 'VT', '50O-3')).toBeNull();
    expect(candidacyInputSchema.safeParse({ ...INPUT, districtId: "06' OR 1=1" }).success).toBe(false);
    expect(districtIdProblem('state', 'CA', '06')).toBeNull();
    expect(districtIdProblem('state', 'CA', '0612')).toBe('a statewide office has no district within the state');
    expect(stateOfDistrict('0612')).toBe('CA');
    expect(stateOfDistrict('99')).toBeNull();
  });

  it('a decline needs a note for the member', () => {
    expect(candidacyDecisionSchema.safeParse({ decision: 'decline', note: '', basedOn: 1 }).success).toBe(false);
    expect(candidacyDecisionSchema.safeParse({ decision: 'approve', note: '', basedOn: 1 }).success).toBe(true);
  });
});

describe('election dates', () => {
  it('accept an election today anywhere in the US, and up to ten years ahead', () => {
    expect(checkElectionDate('2026-10-27', AT).ok).toBe(true);
    expect(checkElectionDate('2026-10-26', AT)).toMatchObject({ ok: false, reason: 'that election is over; choose a date to come' });
    expect(checkElectionDate('2036-10-28', AT).ok).toBe(true);
    expect(checkElectionDate('2036-10-29', AT).ok).toBe(false);
  });
});

describe('declaring', () => {
  it('waits for review, not public', () => {
    const record = declared();
    expect(record).toMatchObject({ status: 'open', published: null, proposed: content(), public: false, version: 1 });
    expect(candidacyStage(record)).toBe('waiting');
  });

  it('refuses the same race twice, and more than five open at once', () => {
    const one = declared();
    expect(declareCandidacy(content(), [one], ids('c2'), AT)).toMatchObject({ ok: false, reason: 'you have already declared for this race' });
    const five = ['2027-01-05', '2027-02-05', '2027-03-05', '2027-04-05', '2027-05-05'].map((electionDate, i) => ({
      ...declared({ electionDate }),
      candidacyId: `c${i}`,
    }));
    expect(declareCandidacy(content(), five, ids('c9'), AT)).toMatchObject({ ok: false });
    const withdrawn = { ...five[0]!, status: 'withdrawn' as const };
    expect(declareCandidacy(content(), [withdrawn, ...five.slice(1)], ids('c9'), AT).ok).toBe(true);
    const past = { ...five[0]!, proposed: content({ electionDate: '2026-01-01' }) };
    expect(declareCandidacy(content(), [past, ...five.slice(1)], ids('c9'), AT).ok).toBe(true);
  });
});

describe('review', () => {
  it('approving publishes the version waiting, ledgered with its hash', () => {
    const record = declared();
    const outcome = decideCandidacy(record, { decision: 'approve', note: null, basedOn: 1 }, 'ma', LATER);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.record).toMatchObject({ published: content(), proposed: null, public: true, publishedBy: 'ma', version: 2 });
    expect(outcome.value.event).toMatchObject({
      type: 'candidacy.changed',
      actor: 'ma',
      subject: 'ada',
      payload: { candidacyId: 'c1', change: 'approved', office: 'us_house', districtGeoid: '0612', electionDate: '2028-11-07' },
    });
    expect(outcome.value.event.payload.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(candidacyStage(outcome.value.record)).toBe('public');
  });

  it('declining keeps the version for the member to change, with the note', () => {
    const outcome = decideCandidacy(declared(), { decision: 'decline', note: 'Add the district', basedOn: 1 }, 'ma', LATER);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.value.record).toMatchObject({ proposed: content(), declined: { note: 'Add the district', by: 'ma' }, public: false });
    expect(candidacyStage(outcome.value.record)).toBe('declined');
    expect(decideCandidacy(outcome.value.record, { decision: 'approve', note: null, basedOn: 2 }, 'ma', LATER)).toMatchObject({
      ok: false,
      reason: 'nothing is waiting for review',
    });
  });

  it('refuses a review of one’s own candidacy, or of an older version', () => {
    expect(decideCandidacy(declared(), { decision: 'approve', note: null, basedOn: 1 }, 'ada', LATER)).toMatchObject({ ok: false, refusal: 'forbidden' });
    expect(decideCandidacy(declared(), { decision: 'approve', note: null, basedOn: 2 }, 'ma', LATER)).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(decideCandidacy(null, { decision: 'approve', note: null, basedOn: 1 }, 'ma', LATER)).toMatchObject({ ok: false, refusal: 'not_found' });
  });
});

describe('changes', () => {
  it('a change to a public candidacy waits for review while the published version stays up', () => {
    const live = approved();
    const outcome = changeCandidacy(live, content({ platform: 'Longevity first.' }), live.version, 'ada', LATER);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.value).toMatchObject({ published: content(), proposed: { platform: 'Longevity first.' }, public: true, version: 3 });
    expect(candidacyStage(outcome.value)).toBe('public_change_waiting');
  });

  it('changing it back to the published version leaves nothing waiting', () => {
    const live = approved();
    const changed = changeCandidacy(live, content({ platform: 'Longevity first.' }), 2, 'ada', LATER);
    if (!changed.ok) throw new Error(changed.reason);
    const back = changeCandidacy(changed.value, content(), 3, 'ada', LATER);
    expect(back).toMatchObject({ ok: true, value: { proposed: null, declined: null, version: 4 } });
    expect(changeCandidacy(live, content(), 2, 'ada', LATER)).toMatchObject({ ok: false, reason: 'nothing changed' });
  });

  it('only the member changes it, from the version they saw', () => {
    const record = declared();
    expect(changeCandidacy(record, content({ platform: 'x' }), 1, 'bo', LATER)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(changeCandidacy(record, content({ platform: 'x' }), 7, 'ada', LATER)).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(changeCandidacy(record, content(), 1, 'ada', LATER)).toMatchObject({ ok: false, reason: 'nothing changed' });
  });

  it('sending a declined version again asks for review again', () => {
    const declined = decideCandidacy(declared(), { decision: 'decline', note: 'Why?', basedOn: 1 }, 'ma', LATER);
    if (!declined.ok) throw new Error(declined.reason);
    const again = changeCandidacy(declined.value.record, content(), 2, 'ada', LATER);
    expect(again).toMatchObject({ ok: true, value: { declined: null, version: 3 } });
  });
});

describe('ending', () => {
  it('a withdrawal takes it off the page, ledgered only when it was public', () => {
    const quiet = withdrawCandidacy(declared(), 'ada', LATER);
    expect(quiet).toMatchObject({ ok: true, value: { record: { status: 'withdrawn', public: false }, event: null } });
    const loud = withdrawCandidacy(approved(), 'ada', LATER);
    expect(loud).toMatchObject({ ok: true, value: { event: { payload: { change: 'withdrawn', contentHash: null } } } });
    if (loud.ok) expect(withdrawCandidacy(loud.value.record, 'ada', LATER)).toMatchObject({ ok: false, reason: 'this candidacy was withdrawn' });
  });

  it('a Membership Admin takes one down with a reason the member sees', () => {
    const outcome = removeCandidacy(approved(), 'Not a real campaign', 'ma2', LATER);
    expect(outcome).toMatchObject({
      ok: true,
      value: { record: { status: 'removed', public: false, ended: { by: 'ma2', reason: 'Not a real campaign' } }, event: { payload: { change: 'removed' } } },
    });
    if (outcome.ok) expect(candidacyStage(outcome.value.record)).toBe('removed');
  });
});

describe('views', () => {
  const member = { legalName: 'Ada Brooks', preferredName: 'Ada B.', status: 'active' as const, state: 'CA' };

  it('show the public the approved version while the member is Active', () => {
    const live = changeCandidacy(approved(), content({ platform: 'Pending text' }), 2, 'ada', LATER);
    if (!live.ok) throw new Error(live.reason);
    expect(publicCandidacy(live.value, member)).toMatchObject({ candidacyId: 'c1', name: 'Ada B.', platform: content().platform });
    expect(publicCandidacy(live.value, { ...member, status: 'lapsed' })).toBeNull();
    expect(publicCandidacy(declared(), member)).toBeNull();
  });

  it('list upcoming elections soonest first, then past ones', () => {
    const card = (electionDate: string, name: string): PublicCandidacy => ({ ...content({ electionDate }), candidacyId: name, name, publishedAt: AT });
    const sorted = [card('2025-11-04', 'old'), card('2028-11-07', 'later'), card('2026-11-03', 'soon'), card('2024-11-05', 'older')].sort(
      comparePublicCandidacies('2026-10-28'),
    );
    expect(sorted.map((c) => c.name)).toEqual(['soon', 'later', 'old', 'older']);
  });

  it('put what waits for review first for Membership Admins', () => {
    const live = { ...adminCandidacy(approved(), member), candidacyId: 'live' };
    const waiting = { ...adminCandidacy(declared(), member), candidacyId: 'waiting' };
    expect([live, waiting].sort(compareAdminCandidacies).map((c) => c.candidacyId)).toEqual(['waiting', 'live']);
    expect(adminCandidacy(declared(), null)).toMatchObject({ name: 'Unknown member', memberStatus: null, stage: 'waiting' });
  });
});

describe('a member’s area', () => {
  const district = (kind: District['kind'], geoid: string, state: string | null = 'CA') => ({ kind, geoid, state });
  const area: CandidateArea = { state: 'CA', districts: [CA12, { ...CA12, kind: 'county', geoid: '06001', name: 'Alameda County' }], basis: 'zip' };

  it('holds nationwide offices, the state’s own and the districts the ZIP code reaches into', () => {
    expect(inCandidateArea(district('nation', 'US', null), area)).toBe(true);
    expect(inCandidateArea(district('state', '06'), area)).toBe(true);
    expect(inCandidateArea(district('congressional', '0612'), area)).toBe(true);
    expect(inCandidateArea(district('county', '06001'), area)).toBe(true);
    expect(inCandidateArea(district('congressional', '0611'), area)).toBe(false);
    expect(inCandidateArea(district('state_lower', '0612'), area)).toBe(false);
    expect(inCandidateArea(district('state', '41', 'OR'), area)).toBe(false);
  });

  it('is the whole state when the ZIP code could not be placed', () => {
    for (const basis of ['no_zip', 'unplaced', 'unavailable'] as const) {
      const statewide: CandidateArea = { state: 'CA', districts: [], basis };
      expect(inCandidateArea(district('congressional', '0611'), statewide)).toBe(true);
      expect(inCandidateArea(district('place', '0644000'), statewide)).toBe(true);
      expect(inCandidateArea(district('county', '41051', 'OR'), statewide)).toBe(false);
    }
  });
});
