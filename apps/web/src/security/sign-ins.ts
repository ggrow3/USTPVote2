import { csvCell, describeUserAgent, type SignInRecord } from 'ustp-domain';

/** How the person signed in, in words. */
export const METHOD_LABELS: Readonly<Record<string, string>> = {
  password: 'Email and password',
  emailLink: 'Email link',
  'google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
};

export function methodLabel(provider: string): string {
  return METHOD_LABELS[provider] ?? provider;
}

/** The sign-ins whose email, account, address, method or browser contains the search, ignoring case. */
export function filterSignIns(records: readonly SignInRecord[], search: string): SignInRecord[] {
  const q = search.trim().toLowerCase();
  if (!q) return [...records];
  return records.filter((r) =>
    [r.email, r.accountId, r.ip, methodLabel(r.provider), describeUserAgent(r.userAgent)].some((v) => v?.toLowerCase().includes(q)),
  );
}

export interface SignInSummary {
  readonly signIns: number;
  /** Different logins (uids) that signed in. */
  readonly people: number;
  readonly addresses: number;
  /** Sign-ins with a second factor. */
  readonly withMfa: number;
}

export function summarizeSignIns(records: readonly SignInRecord[]): SignInSummary {
  return {
    signIns: records.length,
    people: new Set(records.map((r) => r.uid)).size,
    addresses: new Set(records.map((r) => r.ip).filter(Boolean)).size,
    withMfa: records.filter((r) => r.mfa).length,
  };
}

/**
 * Sign-ins from an address that login had not signed in from earlier in the records (newest first, as the api sends
 * them). A login's first sign-in in the period is not flagged: there is nothing to compare it with.
 */
export function newAddressIds(records: readonly SignInRecord[]): Set<string> {
  const known = new Map<string, Set<string>>();
  const flagged = new Set<string>();
  for (const r of [...records].reverse()) {
    if (!r.ip) continue;
    const seen = known.get(r.uid);
    if (!seen) known.set(r.uid, new Set([r.ip]));
    else if (!seen.has(r.ip)) {
      flagged.add(r.id);
      seen.add(r.ip);
    }
  }
  return flagged;
}

/** The log as a spreadsheet: every column the table has, plus the whole forwarded chain and user agent. */
export function signInsCsv(records: readonly SignInRecord[]): string {
  const lines = [
    ['Signed in', 'Seen by the api', 'Email', 'Account ID', 'Method', 'Two-step', 'IP address', 'Forwarded for', 'Browser', 'User agent'],
    ...records.map((r) => [
      r.signedInAt,
      r.seenAt,
      r.email ?? '',
      r.accountId ?? '',
      methodLabel(r.provider),
      r.mfa ? 'Yes' : 'No',
      r.ip ?? '',
      r.forwardedFor.join(', '),
      describeUserAgent(r.userAgent),
      r.userAgent ?? '',
    ]),
  ];
  return lines.map((cells) => cells.map(csvCell).join(',') + '\r\n').join('');
}

/** `ustp-sign-ins-2026-10-28.csv`, by the reader's own date. */
export function signInsCsvFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `ustp-sign-ins-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}

/** Cloud Logging's Logs Explorer, open at Identity Platform's request logs: every attempt, failed ones included. */
export function identityLogsUrl(projectId: string): string {
  const query = encodeURIComponent('resource.type="identitytoolkit_project"');
  return `https://console.cloud.google.com/logs/query;query=${query}?project=${encodeURIComponent(projectId)}`;
}

/** The page view Google Analytics gets for a path (design §10.7): the page itself, never what follows `?` or `#`. */
export function pageView(path: string, origin: string, title: string) {
  return { page_location: `${origin}${path}`, page_path: path, page_title: title };
}
