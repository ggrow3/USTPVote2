import { describe, expect, it } from 'vitest';
import type { MemberMatch } from 'ustp-domain';
import { matchCaption, matchesAnnouncement, unavailableReason } from './candidate-entry.js';

const ada: MemberMatch = { accountId: 'a1', legalName: 'Ada Brooks', preferredName: null, state: 'CA' };
const bob: MemberMatch = { accountId: 'a2', legalName: 'Robert Adams', preferredName: 'Bob Adams', state: 'NY' };

describe('linking an option to a member', () => {
  it('tells members with the same name apart, and says who cannot be linked', () => {
    expect(matchCaption(ada)).toBe('CA');
    expect(matchCaption(bob)).toBe('Known as Bob Adams · NY');
    expect(matchCaption({ ...ada, preferredName: 'Ada Brooks', state: '' })).toBe('');
    expect(unavailableReason(ada, 'a1', [])).toBe('you cannot stand in an election you administer');
    expect(unavailableReason(ada, 'x', ['a1'])).toBe('already an option in this question');
    expect(unavailableReason(ada, null, ['a2'])).toBeNull();
  });

  it('says how many members can be linked, and nothing when none can', () => {
    expect(matchesAnnouncement(0)).toBe('');
    expect(matchesAnnouncement(1)).toBe('An Active member matches. Press the down arrow to link the option to their member account.');
    expect(matchesAnnouncement(3)).toBe('3 Active members match. Press the down arrow to link the option to one’s member account.');
  });
});
