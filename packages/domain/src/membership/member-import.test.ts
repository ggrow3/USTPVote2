import { describe, expect, it } from 'vitest';
import { memberDetailsSchema } from '../api.js';
import { readCsv } from '../csv-read.js';
import { welcomeMessage } from '../notifications/message.js';
import { memberAddition, updateOwnDetails } from './member.js';
import {
  checkNewMember,
  MAX_MEMBER_IMPORT_ROWS,
  MEMBER_IMPORT_TEMPLATE,
  planMemberImport,
  readMemberImport,
  type ExistingEmail,
  type MemberImportRow,
} from './member-import.js';
import { countryCode, placeOf, usStateCode } from './places.js';

const AT = '2026-11-03T12:00:00.000Z';

describe('readCsv', () => {
  it('reads quoted fields, doubled quotes, line breaks in quotes and either line ending', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\n,last,\n';
    expect(readCsv(text)).toEqual([
      { line: 1, cells: ['a', 'b', 'c'] },
      { line: 2, cells: ['x, y', 'say "hi"', 'two\nlines'] },
      { line: 4, cells: ['', 'last', ''] },
    ]);
  });

  it('keeps a last record without a line break, and reads nothing from nothing', () => {
    expect(readCsv('a,b\n1,2')).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
    ]);
    expect(readCsv('')).toEqual([]);
  });
});

describe('places', () => {
  it('reads a country by code, name or a common other name', () => {
    expect(countryCode('gb')).toBe('GB');
    expect(countryCode('United Kingdom')).toBe('GB');
    expect(countryCode('UK')).toBe('GB');
    expect(countryCode('canada')).toBe('CA');
    expect(countryCode('USA')).toBe('US');
    expect(countryCode('Narnia')).toBeNull();
    expect(countryCode('ZZ')).toBeNull();
    expect(countryCode('Germany')).toBe('DE');
  });

  it('reads states by code or name', () => {
    expect(usStateCode('ny')).toBe('NY');
    expect(usStateCode('New York')).toBe('NY');
    expect(usStateCode('Puerto Rico')).toBe('PR');
    expect(usStateCode('Ontario')).toBeNull();
  });

  it('needs a US state, or a country other than the US', () => {
    expect(placeOf('CA', '', '')).toEqual({ country: 'US', state: 'CA', region: null });
    expect(placeOf('California', '', 'United States')).toEqual({ country: 'US', state: 'CA', region: null });
    expect(placeOf('', '', 'Germany')).toEqual({ country: 'DE', state: null, region: null });
    // Abroad, the region column, or else the state column, gives the state, province or county as written.
    expect(placeOf('', 'Bavaria', 'DE')).toEqual({ country: 'DE', state: null, region: 'Bavaria' });
    expect(placeOf('Ontario', '', 'Canada')).toEqual({ country: 'CA', state: null, region: 'Ontario' });
    // A territory with its own country code is the United States and that state.
    expect(placeOf('', '', 'PR')).toEqual({ country: 'US', state: 'PR', region: null });
    expect(placeOf('', '', '')).toEqual({ problem: 'no state, or country for a member living outside the US', missing: true });
    expect(placeOf('', '', 'US')).toEqual({ problem: 'the country is the United States, so give the state too', missing: true });
    expect(placeOf('Ontario', '', '')).toMatchObject({ problem: expect.stringContaining('not a US state') });
    expect(placeOf('', '', 'Narnia')).toMatchObject({ problem: expect.stringContaining('not a country') });
    expect(placeOf('NY', '', 'Guam')).toMatchObject({ problem: expect.stringContaining('not in Guam') });
  });
});

describe('checkNewMember', () => {
  it('tidies a member as stored', () => {
    const checked = checkNewMember({
      email: '  Ada@Example.TEST ',
      legalName: ' Ada Lovelace ',
      preferredName: 'Ada',
      state: 'new york',
      city: 'Albany',
      postalCode: '122071234',
      phone: '(518) 555-0100',
      usVoteEligible: 'Yes',
    });
    expect(checked).toEqual({
      ok: true,
      member: {
        email: 'ada@example.test',
        legalName: 'Ada Lovelace',
        preferredName: 'Ada',
        country: 'US',
        state: 'NY',
        region: null,
        contact: { city: 'Albany', postalCode: '12207-1234', phone: '+15185550100' },
        usVoteEligible: true,
      },
    });
  });

  it('takes a member abroad with a postcode of their country, and no contact when none is given', () => {
    const abroad = checkNewMember({ email: 'b@example.test', legalName: 'B', country: 'Germany', postalCode: '10115', usVoteEligible: 'no' });
    expect(abroad).toMatchObject({
      ok: true,
      member: { country: 'DE', state: null, region: null, contact: { city: null, postalCode: '10115', phone: null }, usVoteEligible: false },
    });
    expect(checkNewMember({ email: 'u@example.test', legalName: 'U', country: 'UK', postalCode: 'sw1a  1aa' })).toMatchObject({
      ok: true,
      member: { country: 'GB', contact: { postalCode: 'SW1A 1AA' } },
    });
    const bare = checkNewMember({ email: 'c@example.test', legalName: 'C', state: 'VT' });
    expect(bare).toMatchObject({ ok: true, member: { contact: null, usVoteEligible: null, preferredName: null } });
  });

  it('names every problem with its field', () => {
    const checked = checkNewMember({ email: 'not-an-email', legalName: '', state: 'Ontario', postalCode: 'K1A', phone: '12', usVoteEligible: 'maybe' });
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.problems.map((p) => p.field)).toEqual(['email', 'legalName', 'state', 'postalCode', 'phone', 'usVoteEligible']);
    expect(checked.problems.map((p) => p.cause)).toEqual(['bad_email', 'missing', 'invalid', 'invalid', 'invalid', 'invalid']);
    expect(checked.problems[0]!.message).toBe('"not-an-email" is not an email address');
    expect(checkNewMember({ email: '', legalName: 'X', country: 'Narnia' })).toMatchObject({
      ok: false,
      problems: [
        { field: 'email', message: 'no email address', cause: 'missing' },
        { field: 'country', message: expect.stringContaining('not a country'), cause: 'invalid' },
      ],
    });
  });
});

describe('readMemberImport', () => {
  it('reads the columns by their headers, in any order, ignoring others', () => {
    const file = readMemberImport('Name,E-mail,State,Notes,ZIP\nAda Lovelace,ada@example.test,NY,likes math,12207\n\n,,,,\nBen,ben@example.test,CA,,\n');
    expect(file.problem).toBeNull();
    expect(file.columns).toEqual(['email', 'legalName', 'state', 'postalCode']);
    expect(file.ignored).toEqual(['Notes']);
    expect(file.rows).toEqual([
      { line: 2, email: 'ada@example.test', legalName: 'Ada Lovelace', state: 'NY', postalCode: '12207' },
      { line: 5, email: 'ben@example.test', legalName: 'Ben', state: 'CA', postalCode: '' },
    ]);
  });

  it('reads the template, and refuses a file it cannot import', () => {
    expect(MEMBER_IMPORT_TEMPLATE).toBe('email,legal_name,preferred_name,state,region,country,city,zip,phone,us_vote_eligible\r\n');
    expect(readMemberImport(`${MEMBER_IMPORT_TEMPLATE}a@example.test,A,,,Bavaria,DE,,,,\n`).rows).toEqual([
      {
        line: 2,
        email: 'a@example.test',
        legalName: 'A',
        preferredName: '',
        state: '',
        region: 'Bavaria',
        country: 'DE',
        city: '',
        postalCode: '',
        phone: '',
        usVoteEligible: '',
      },
    ]);
    expect(readMemberImport('').problem).toBe('the file is empty');
    expect(readMemberImport('email,phone\nx@example.test,1\n').problem).toMatch(/no legal_name, no state \(or country\) column/);
    expect(readMemberImport('email,legal_name,state\n').problem).toMatch(/no members/);
    const long = `email,legal_name,state\n${'x@example.test,X,NY\n'.repeat(MAX_MEMBER_IMPORT_ROWS + 1)}`;
    expect(readMemberImport(long).problem).toMatch(/at most 500/);
  });
});

describe('planMemberImport', () => {
  const row = (line: number, email: string, more: Partial<MemberImportRow> = {}): MemberImportRow => ({
    line,
    email,
    legalName: `Person ${line}`,
    state: 'NY',
    ...more,
  });

  it('adds valid new addresses and skips the rest with their reasons', () => {
    const existing = new Map<string, ExistingEmail>([
      ['login@example.test', { kind: 'login' }],
      ['member@example.test', { kind: 'member', status: 'active', waiting: false }],
      ['waiting@example.test', { kind: 'member', status: 'active', waiting: true }],
    ]);
    const plan = planMemberImport(
      [
        row(2, 'New@Example.test'),
        row(3, 'new@example.test'),
        row(4, 'login@example.test'),
        row(5, 'member@example.test'),
        row(6, 'waiting@example.test'),
        row(7, 'bad', { legalName: '' }),
      ],
      existing,
    );
    expect(plan.adding).toBe(1);
    expect(plan.skipping).toBe(5);
    // Each skipped row counts once, under its first cause: row 7 has a bad email and no legal name, so it is missing one.
    expect(plan.skippedBy).toEqual({ missing: 1, bad_email: 0, invalid: 0, duplicate: 1, on_site: 3 });
    expect(plan.rows.map((r) => r.cause)).toEqual([null, 'duplicate', 'on_site', 'on_site', 'on_site', 'missing']);
    expect(plan.rows.map((r) => [r.line, r.email, r.add, r.reasons])).toEqual([
      [2, 'new@example.test', true, []],
      [3, 'new@example.test', false, ['the same email address as row 2']],
      [4, 'login@example.test', false, ['already has a login on the site, so they apply on the Register page']],
      [5, 'member@example.test', false, ['already has a membership (active)']],
      [6, 'waiting@example.test', false, ['already added, and has not set a password yet']],
      [7, 'bad', false, ['"bad" is not an email address', 'no legal name']],
    ]);
    expect(plan.rows[0]!.member).toMatchObject({ email: 'new@example.test', state: 'NY' });
    expect(plan.rows[1]!.member).toBeNull();
  });
});

describe('skipped rows by cause', () => {
  it('add up to the rows skipped, a missing field counting before the rest', () => {
    const plan = planMemberImport(
      [
        { line: 2, email: '', legalName: 'No Email', state: 'NY' },
        { line: 3, email: 'x@example.test', legalName: 'No Place', state: '' },
        { line: 4, email: 'United States', legalName: 'Two Problems', state: 'Ontario' },
        { line: 5, email: 'y@example.test', legalName: 'Bad Phone', state: 'NY', phone: '12' },
        { line: 6, email: 'z@example.test', legalName: 'US With No State', country: 'USA' },
        { line: 7, email: 'ok@example.test', legalName: 'Fine', state: 'NY' },
      ],
      new Map(),
    );
    expect(plan).toMatchObject({ adding: 1, skipping: 5, skippedBy: { missing: 3, bad_email: 1, invalid: 1, duplicate: 0, on_site: 0 } });
    expect(Object.values(plan.skippedBy).reduce((a, b) => a + b, 0)).toBe(plan.skipping);
  });
});

describe('memberAddition', () => {
  it('makes an Active member on the bylaws in force, with no opt-ins and the Core Ideals not asked', () => {
    const checked = checkNewMember({ email: 'a@example.test', legalName: 'Ada', country: 'GB', usVoteEligible: 'no' });
    if (!checked.ok) throw new Error('expected a member');
    const added = memberAddition({ accountId: 'acc', member: checked.member, actor: 'admin', reason: 'Roster', bylawsVersion: '2026.1', at: AT });
    expect(added.member).toEqual({
      accountId: 'acc',
      status: 'active',
      legalName: 'Ada',
      preferredName: null,
      country: 'GB',
      state: null,
      region: null,
      contact: null,
      communications: null,
      usVoteEligible: false,
      agreesWithCoreIdeals: null,
      bylawsVersion: '2026.1',
      memberSince: AT,
      statusChangedAt: AT,
    });
    expect(added.event).toEqual({
      type: 'member.status_changed',
      actor: 'admin',
      subject: 'acc',
      payload: { from: null, to: 'active', reason: 'Roster', applicationId: null },
    });
    expect(added.history(7)).toMatchObject({ from: null, to: 'active', actor: 'admin', ledgerSeq: 7 });
  });

  it('lets a member abroad keep their country when they change their details', () => {
    const checked = checkNewMember({ email: 'a@example.test', legalName: 'Ada', country: 'GB' });
    if (!checked.ok) throw new Error('expected a member');
    const { member } = memberAddition({ accountId: 'acc', member: checked.member, actor: 'admin', reason: 'Roster', bylawsVersion: '1', at: AT });
    const input = memberDetailsSchema.parse({ country: 'GB', city: 'London', postalCode: 'sw1a 1aa', newsletter: false, announcements: false });
    const changed = updateOwnDetails(member, { input, at: AT });
    expect(changed).toMatchObject({
      ok: true,
      value: {
        member: { country: 'GB', state: null, contact: { city: 'London', postalCode: 'SW1A 1AA' } },
        event: { payload: { fields: ['contact.city', 'contact.postalCode'] } },
      },
    });
  });
});

describe('welcomeMessage', () => {
  it('greets the member, leads to the set-password page and carries no sign-in link', () => {
    const message = welcomeMessage({ origin: 'https://vote.example.org', name: 'Ada <b>', contact: 'members@example.org' });
    expect(message.subject).toBe('Welcome to the US Transhumanist Party: set your password');
    expect(message.text).toContain('Hello Ada <b>,');
    expect(message.text).toContain('Set your password: https://vote.example.org/set-password');
    expect(message.text).toContain('Questions about your membership? Replies to this email are not read; write to members@example.org.');
    expect(message.html).toContain('Hello Ada &lt;b&gt;,');
    expect(message.html).toContain('href="https://vote.example.org/set-password"');
    expect(message.html).not.toContain('oobCode');
  });
});
