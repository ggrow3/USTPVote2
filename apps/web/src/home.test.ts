import type { ApprovalRequestRecord, ElectionRecord, VoterElection } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { approvalsStatus, ballotStatus, electionsStatus, homeCards, waitingStatus } from './home.js';

describe('home cards', () => {
  it('follow what the person is shown: ballot first, then membership, verify, offices, admin sections and the account', () => {
    const cards = homeCards(
      { menu: ['register', 'ballot', 'verify', 'offices', 'admin'], sections: ['elections', 'offices', 'approvals'] },
      'active',
      false,
    );
    expect(cards.map((c) => c.key)).toEqual([
      'ballot',
      'register',
      'verify',
      'offices',
      'admin/elections',
      'admin/offices',
      'admin/approvals',
      'account',
    ]);
    expect(cards.find((c) => c.key === 'admin/elections')).toMatchObject({ to: '/admin?tab=elections', action: 'Open Elections' });
    expect(cards.find((c) => c.key === 'offices')).toMatchObject({ to: '/offices', action: 'See the offices' });
    expect(cards.find((c) => c.key === 'admin/offices')).toMatchObject({ to: '/admin?tab=offices', action: 'Open Offices' });
    expect(new Set(cards.map((c) => c.action)).size).toBe(cards.length);
    expect(new Set(cards.map((c) => c.title)).size).toBe(cards.length);
  });

  it('word the Register card for where someone is in joining', () => {
    const title = (membership: Parameters<typeof homeCards>[1]) =>
      homeCards({ menu: ['register'], sections: [] }, membership, false)[0]!.title;
    expect(title('no_membership')).toBe('Become a member');
    expect(title('applicant')).toBe('Your application');
    expect(title('lapsed')).toBe('Your membership');
    expect(title('rejected')).toBe('Apply again');
  });

  it('leave out sections without the Admin link, and Testing outside testing mode', () => {
    expect(homeCards({ menu: ['verify'], sections: ['people'] }, 'no_membership', false).map((c) => c.key)).toEqual(['verify', 'account']);
    expect(homeCards({ menu: ['admin'], sections: ['people', 'testing'] }, 'no_membership', false).map((c) => c.key)).toEqual([
      'admin/people',
      'account',
    ]);
    expect(homeCards({ menu: ['admin'], sections: ['testing'] }, 'no_membership', true).map((c) => c.key)).toEqual([
      'admin/testing',
      'account',
    ]);
  });
});

describe('home status lines', () => {
  const election = (state: VoterElection['state'], castAt: string | null = null) => ({ state, castAt }) as VoterElection;

  it('count ballots waiting for a vote and opening soon', () => {
    expect(ballotStatus([])).toBe('You are not on the voter roll of any current election.');
    expect(ballotStatus([election('open'), election('open', '2026-10-26T00:00:00Z'), election('scheduled')])).toBe(
      '1 election waiting for your vote · 1 election opening soon',
    );
    expect(ballotStatus([election('certified')])).toBe('Nothing to vote on right now.');
  });

  it('count elections in progress by state', () => {
    const rows = ['draft', 'draft', 'open', 'closed', 'certified'].map((state) => ({ state }) as ElectionRecord);
    expect(electionsStatus(rows)).toBe('2 drafts · 1 open · 1 closed, to certify');
    expect(electionsStatus([])).toBe('No elections in progress.');
  });

  it('count only requests the person may decide', () => {
    const request = (approverRole: ApprovalRequestRecord['approverRole'], requestedBy = 'ea', subject = 'e1') =>
      ({ approverRole, requestedBy, subject }) as ApprovalRequestRecord;
    const pending = [request('auditor'), request('auditor', 'me'), request('auditor', 'ea', 'me'), request('system_admin')];
    expect(approvalsStatus(pending, 'me', ['auditor'])).toBe('1 request waiting for your decision');
    expect(approvalsStatus(pending, 'me', ['election_admin'])).toBe('Nothing waiting for your decision.');
  });

  it('count applications and photos waiting for review', () => {
    expect(waitingStatus(2, 'application', 100)).toBe('2 applications waiting for review');
    expect(waitingStatus(0, 'photo', 50)).toBe('No photos waiting for review.');
    expect(waitingStatus(50, 'photo', 50)).toBe('50 or more photos waiting for review');
  });
});
