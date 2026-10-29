import type { SignInRecord } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  filterSignIns,
  identityLogsUrl,
  methodLabel,
  newAddressIds,
  pageView,
  signInsCsv,
  signInsCsvFileName,
  summarizeSignIns,
} from './sign-ins.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function signIn(id: string, uid: string, ip: string | null, over: Partial<SignInRecord> = {}): SignInRecord {
  return {
    id,
    uid,
    accountId: `acct-${uid}`,
    email: `${uid}@example.test`,
    provider: 'password',
    mfa: false,
    signedInAt: '2026-10-28T10:00:00.000Z',
    seenAt: '2026-10-28T10:00:01.000Z',
    ip,
    forwardedFor: ip ? [ip, '35.191.0.1'] : [],
    userAgent: CHROME,
    ...over,
  };
}

// Newest first, as the api sends them.
const records = [
  signIn('4', 'ann', '203.0.113.9', { mfa: true }),
  signIn('3', 'ben', '198.51.100.7', { provider: 'google.com' }),
  signIn('2', 'ann', '198.51.100.7'),
  signIn('1', 'ann', '198.51.100.7'),
];

describe('the sign-in log in the admin console (design §10.7)', () => {
  it('counts sign-ins, logins, addresses and two-step sign-ins', () => {
    expect(summarizeSignIns(records)).toEqual({ signIns: 4, people: 2, addresses: 2, withMfa: 1 });
  });

  it('flags a login signing in from an address it had not used before in the period', () => {
    expect([...newAddressIds(records)]).toEqual(['4']);
  });

  it('searches email, account, address, method and browser', () => {
    expect(filterSignIns(records, 'BEN@').map((r) => r.id)).toEqual(['3']);
    expect(filterSignIns(records, '203.0.113').map((r) => r.id)).toEqual(['4']);
    expect(filterSignIns(records, 'google').map((r) => r.id)).toEqual(['3']);
    expect(filterSignIns(records, 'chrome on windows')).toHaveLength(4);
    expect(filterSignIns(records, '  ')).toHaveLength(4);
  });

  it('names sign-in methods', () => {
    expect(methodLabel('password')).toBe('Email and password');
    expect(methodLabel('apple.com')).toBe('Apple');
    expect(methodLabel('saml.x')).toBe('saml.x');
  });

  it('exports every column with the forwarded chain, and defuses what a spreadsheet would misread', () => {
    const csv = signInsCsv([records[0]!, signIn('5', 'eve', null, { email: '=HYPERLINK("http://evil")', userAgent: null })]);
    const [header, first, second] = csv.split('\r\n');
    expect(header).toBe('Signed in,Seen by the api,Email,Account ID,Method,Two-step,IP address,Forwarded for,Browser,User agent');
    expect(first).toContain('ann@example.test,acct-ann,Email and password,Yes,203.0.113.9,"203.0.113.9, 35.191.0.1",Chrome on Windows');
    expect(second).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(signInsCsvFileName(new Date(2026, 9, 6))).toBe('ustp-sign-ins-2026-10-06.csv');
  });

  it('links to Identity Platform request logs for failed attempts', () => {
    expect(identityLogsUrl('ustpvote2-dev')).toBe(
      'https://console.cloud.google.com/logs/query;query=resource.type%3D%22identitytoolkit_project%22?project=ustpvote2-dev',
    );
  });
});

describe('Google Analytics page views', () => {
  it('send the path alone', () => {
    expect(pageView('/results/abc', 'https://vote.example.org', 'Results · USTP Vote')).toEqual({
      page_location: 'https://vote.example.org/results/abc',
      page_path: '/results/abc',
      page_title: 'Results · USTP Vote',
    });
  });
});
