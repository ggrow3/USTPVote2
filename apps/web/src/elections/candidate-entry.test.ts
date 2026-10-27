import { describe, expect, it } from 'vitest';
import type { MemberMatch } from 'ustp-domain';
import {
  afterTyping,
  candidateBody,
  entryLabel,
  entryStatus,
  matchCaption,
  matchesAnnouncement,
  unavailableReason,
} from './candidate-entry.js';

const ada: MemberMatch = { accountId: 'a1', legalName: 'Ada Brooks', preferredName: null, state: 'CA' };
const bob: MemberMatch = { accountId: 'a2', legalName: 'Robert Adams', preferredName: 'Bob Adams', state: 'NY' };

describe('candidate field', () => {
  it('sends a chosen member with their account, and typed text as a plain name', () => {
    expect(candidateBody(ada)).toEqual({ name: 'Ada Brooks', accountId: 'a1' });
    expect(candidateBody('Write-in Person')).toEqual({ name: 'Write-in Person' });
    expect(candidateBody(null)).toEqual({ name: '' });
    expect([entryLabel(ada), entryLabel('Grace'), entryLabel(null)]).toEqual(['Ada Brooks', 'Grace', '']);
  });

  it('keeps the member chosen while the field holds their name, and unlinks on any other text', () => {
    expect(afterTyping(ada, 'Ada Brooks')).toBe(ada);
    expect(afterTyping(ada, 'Ada Brook')).toBe('Ada Brook');
    expect(afterTyping(ada, '')).toBeNull();
    expect(afterTyping('Ad', 'Ada')).toBe('Ada');
    expect(afterTyping(null, '')).toBeNull();
  });

  it('tells members with the same name apart, and says who cannot be chosen', () => {
    expect(matchCaption(ada)).toBe('CA');
    expect(matchCaption(bob)).toBe('Known as Bob Adams · NY');
    expect(matchCaption({ ...ada, preferredName: 'Ada Brooks', state: '' })).toBe('');
    expect(unavailableReason(ada, 'a1', [])).toBe('You cannot stand in an election you administer');
    expect(unavailableReason(ada, 'x', ['a1'])).toBe('Already a candidate in this contest');
    expect(unavailableReason(ada, null, ['a2'])).toBeNull();
  });

  it('says whether adding links an account, and how many members match', () => {
    expect(entryStatus(ada)).toBe('Links the member account of Ada Brooks (CA).');
    expect(entryStatus('Grace')).toBe('Not linked to a member: added as typed.');
    expect(entryStatus('  ')).toMatch(/^Type part of a member’s name/);
    expect(matchesAnnouncement(0)).toBe('No Active member matches. Add candidate adds the name as typed.');
    expect(matchesAnnouncement(1)).toBe('1 member matches. Use the down arrow to choose.');
    expect(matchesAnnouncement(3)).toBe('3 members match. Use the down arrow to choose.');
    expect(matchesAnnouncement(3, 2)).toBe('3 members match, 2 can be chosen. Use the down arrow to choose.');
    expect(matchesAnnouncement(1, 0)).toBe('1 member matches, but cannot be chosen for this contest. Add candidate adds the name as typed.');
  });
});
