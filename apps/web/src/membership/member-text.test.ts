import { describe, expect, it } from 'vitest';
import type { MemberRecord } from 'ustp-domain';
import { COUNTRY_OPTIONS, detailsForm, localityText, placeFacts, placeInput } from './member-text.js';

const member: MemberRecord = {
  accountId: 'a1',
  status: 'active',
  legalName: 'Ada Brooks',
  preferredName: null,
  state: 'NY',
  contact: { city: 'Albany', postalCode: '12207', phone: null },
  communications: null,
  usVoteEligible: true,
  agreesWithCoreIdeals: true,
  bylawsVersion: '2026.1',
  memberSince: null,
  statusChangedAt: '2026-10-22T12:00:00.000Z',
};
const abroad: MemberRecord = { ...member, country: 'CA', state: null, region: 'Ontario', contact: { city: null, postalCode: 'K1A 0B1', phone: null } };

describe('where a member lives', () => {
  it('offers the United States first, then every other country by name', () => {
    expect(COUNTRY_OPTIONS[0]).toEqual({ label: 'United States', value: 'US' });
    const rest = COUNTRY_OPTIONS.slice(1).map((o) => o.label);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')));
    expect(rest).toContain('Canada');
    expect(rest).not.toContain('Puerto Rico');
  });

  it('lists a US member’s state, city and ZIP code, a record without a country being in the US', () => {
    expect(placeFacts(member)).toEqual([
      { label: 'Country', value: 'United States' },
      { label: 'State or territory', value: 'New York (NY)' },
      { label: 'City', value: 'Albany' },
      { label: 'ZIP code', value: '12207' },
    ]);
    expect(placeFacts({ ...member, contact: null }).slice(2).map((f) => f.value)).toEqual([null, null]);
  });

  it('lists the region, city and postcode elsewhere, null where none was given', () => {
    expect(placeFacts(abroad)).toEqual([
      { label: 'Country', value: 'Canada' },
      { label: 'State, province or region', value: 'Ontario' },
      { label: 'City', value: null },
      { label: 'Postcode', value: 'K1A 0B1' },
    ]);
    expect(localityText(abroad)).toBe('Ontario K1A 0B1');
    expect(localityText({ ...abroad, contact: { city: 'Ottawa', postalCode: null, phone: null } })).toBe('Ottawa, Ontario');
    expect(localityText(member)).toBe('Albany 12207');
  });

  it('fills the form from the record, and sends the state in the US and the region elsewhere', () => {
    const form = detailsForm(member);
    expect(form).toMatchObject({ country: 'US', state: 'NY', region: '', city: 'Albany', postalCode: '12207' });
    expect(placeInput(form)).toEqual({ country: 'US', state: 'NY', city: 'Albany', postalCode: '12207' });
    expect(placeInput({ ...form, country: 'DE', region: 'Berlin' })).toEqual({ country: 'DE', region: 'Berlin', city: 'Albany', postalCode: '12207' });
    expect(placeInput({ ...form, state: null })).toMatchObject({ state: '' });
  });
});
