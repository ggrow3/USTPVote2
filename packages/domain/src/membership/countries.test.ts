import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryName, countryOf, DEFAULT_COUNTRY, isCountryCode, placeText } from './countries.js';

describe('countries', () => {
  it('lists each country once, in code order, with the United States and Kosovo', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([...codes].sort());
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(countryName(DEFAULT_COUNTRY)).toBe('United States');
    expect(countryName('XK')).toBe('Kosovo');
  });

  it('leaves out the US territories, which are states of the United States here', () => {
    for (const territory of ['AS', 'GU', 'MP', 'PR', 'UM', 'VI']) expect(isCountryCode(territory)).toBe(false);
  });

  it('puts records from before the country was asked in the United States', () => {
    expect(countryOf({})).toBe('US');
    expect(countryOf({ country: 'CA' })).toBe('CA');
  });

  it('says where someone lives: the state in the US, the country elsewhere', () => {
    expect(placeText({ state: 'NY' })).toBe('NY');
    expect(placeText({ country: 'US', state: 'CA' })).toBe('CA');
    expect(placeText({ country: 'CA', state: null })).toBe('Canada');
    expect(countryName('ZZ')).toBe('ZZ');
  });
});
