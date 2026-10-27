import { describe, expect, it } from 'vitest';
import { foldName, matchMembers, type MemberMatch } from './search.js';

const member = (accountId: string, legalName: string, preferredName: string | null = null): MemberMatch => ({
  accountId,
  legalName,
  preferredName,
  state: 'CA',
});

const members = [
  member('a1', 'Ada Brooks'),
  member('a2', 'Robert Adams', 'Bob Adams'),
  member('a3', 'José Núñez'),
  member('a4', 'Leila Hadad'),
  member('a5', 'Ada Brooks'),
  member('a6', 'Mary-Ann Okafor'),
];
const ids = (text: string, limit = 10) => matchMembers(members, text, limit).map((m) => m.accountId);

describe('member search', () => {
  it('folds case and accents', () => {
    expect(foldName('José NÚÑEZ')).toBe('jose nunez');
    expect(ids('jose')).toEqual(['a3']);
    expect(ids('NÚÑ')).toEqual(['a3']);
  });

  it('ranks names that start with the text, then words that do, then the rest', () => {
    // "Ada Brooks" starts with "ad"; "Robert Adams" has a word that does; "Leila Hadad" only contains it.
    expect(ids('ad')).toEqual(['a1', 'a5', 'a2', 'a4']);
  });

  it('matches every word of the text, in any order, in the legal or the preferred name', () => {
    expect(ids('brooks ada')).toEqual(['a1', 'a5']);
    expect(ids('bob')).toEqual(['a2']);
    expect(ids('bob robert')).toEqual([]);
    expect(ids('ann oka')).toEqual(['a6']);
  });

  it('keeps people with the same name apart by account, and stops at the limit', () => {
    expect(ids('ada brooks')).toEqual(['a1', 'a5']);
    expect(ids('a', 2)).toEqual(['a1', 'a5']);
  });

  it('matches nobody for an empty text', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(ids('zz')).toEqual([]);
  });
});
