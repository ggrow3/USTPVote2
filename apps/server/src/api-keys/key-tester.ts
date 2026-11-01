import type { ApiKeyName } from 'ustp-domain';
import type { KeyTrial } from '../claude-checks/key-tester.js';

/** Tries a pasted key with its service before it is kept (design §5.6), so a typo shows at once, not as missing records. */
export interface ApiKeyTester {
  try(name: ApiKeyName, key: string): Promise<KeyTrial>;
}

export const API_KEY_TESTER = Symbol('ApiKeyTester');

const TIMEOUT_MS = 15_000;

/**
 * One small request each service answers for any working key, with the key in a header (so it is in no address): the
 * FEC's first candidate, Open States' first state, Google's list of elections. What the service says is not passed on:
 * the panel says what to do.
 */
const TRIALS: Readonly<Record<ApiKeyName, { readonly url: string; readonly header: string; readonly service: string; readonly refused: (status: number, body: string) => boolean }>> = {
  fec: { url: 'https://api.open.fec.gov/v1/candidates/?per_page=1', header: 'X-Api-Key', service: 'api.data.gov', refused: (s) => s === 401 || s === 403 },
  openstates: { url: 'https://v3.openstates.org/jurisdictions?classification=state&per_page=1', header: 'X-API-KEY', service: 'Open States', refused: (s) => s === 401 || s === 403 },
  civic: {
    url: 'https://www.googleapis.com/civicinfo/v2/elections',
    header: 'x-goog-api-key',
    service: 'Google',
    refused: (s, body) => s === 403 || (s === 400 && /api key/i.test(body)),
  },
};

export class PublicApiKeyTester implements ApiKeyTester {
  constructor(private readonly fetchFn: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init)) {}

  async try(name: ApiKeyName, key: string): Promise<KeyTrial> {
    const trial = TRIALS[name];
    let res: Response;
    try {
      res = await this.fetchFn(trial.url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', [trial.header]: key } });
    } catch {
      return unreachable(trial.service);
    }
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => '');
    if (!trial.refused(res.status, body)) return unreachable(trial.service);
    const reason =
      name === 'civic' && res.status === 403
        ? 'Google recognized this key but will not let it use the Civic Information API: turn that API on in the key’s Google Cloud project, or allow it in the key’s restrictions'
        : `${trial.service} did not accept this key: check that it is complete and has not been deleted`;
    return { ok: false, refusal: 'rejected', reason };
  }
}

/** Rate limiting, a timeout or the service's own failure: the key may be fine. */
const unreachable = (service: string): KeyTrial => ({
  ok: false,
  refusal: 'unreachable',
  reason: `${service} could not be asked about this key just now; nothing was saved, so try again shortly`,
});

/** With the emulators nothing goes to the services: a key of the right shape is kept untried (CI and local development). */
export class UntriedApiKeyTester implements ApiKeyTester {
  async try(): Promise<KeyTrial> {
    return { ok: true };
  }
}
