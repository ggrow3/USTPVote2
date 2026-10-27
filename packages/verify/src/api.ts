import type {
  AmendedBylawsView,
  AnchorRecord,
  BallotProof,
  BylawsRecord,
  LedgerBlockRecord,
  PublicElection,
  PublicLedgerEntry,
  ResultsRecord,
  SealedBlockRecord,
  SigningKeyRecord,
} from 'ustp-domain';

/** The api failed in a way the verifier cannot read past (unreachable, a 5xx, an unexpected status). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
  }
}

/** Largest page `GET /v1/public/ledger/blocks` serves. */
const BLOCK_PAGE = 200;

/**
 * The public, unauthenticated endpoints (design §12), and nothing else: no credentials are ever sent. `fetchFn` is
 * injectable so tests can serve fixtures.
 */
export class PublicApi {
  readonly base: string;

  constructor(
    base: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = base.replace(/\/+$/, '');
  }

  /** GET a JSON document; null when the api answers one of the `absent` statuses (404 by default). */
  async get<T>(path: string, absent: readonly number[] = [404]): Promise<T | null> {
    const url = `${this.base}${path}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, { headers: { accept: 'application/json' } });
    } catch (e) {
      throw new ApiError(0, url, `cannot reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (absent.includes(res.status)) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const detail = attemptJson<{ detail?: string }>(body)?.detail ?? body.slice(0, 200);
      throw new ApiError(res.status, url, `${res.status} from ${url}${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as T;
  }

  async require<T>(path: string): Promise<T> {
    return (await this.get<T>(path, []))!;
  }

  /** Every ledger block, paging through `?after=&limit=` until a page comes back empty (whatever the server's cap). */
  async ledgerBlocks(): Promise<LedgerBlockRecord[]> {
    const blocks: LedgerBlockRecord[] = [];
    for (;;) {
      const after = blocks.at(-1)?.index ?? 0;
      const page = await this.require<LedgerBlockRecord[]>(`/v1/public/ledger/blocks?after=${after}&limit=${BLOCK_PAGE}`);
      if (page.length === 0) return blocks;
      // A page must move forward, or a misbehaving api would keep this loop going.
      if (!(page[0]!.index > after)) throw new ApiError(200, this.base, `ledger block paging did not advance past ${after}`);
      blocks.push(...page);
    }
  }

  ledgerKeys(): Promise<SigningKeyRecord[]> {
    return this.require('/v1/public/ledger/keys');
  }

  /** null until something has been anchored. */
  latestAnchor(): Promise<AnchorRecord | null> {
    return this.get('/v1/public/anchors/latest');
  }

  /** null for an entry that is private (or not in a block yet). */
  ledgerEntry(seq: number): Promise<PublicLedgerEntry | null> {
    return this.get(`/v1/public/ledger/entries/${seq}`);
  }

  /** null for an unknown election or a draft. */
  election(electionId: string): Promise<PublicElection | null> {
    return this.get(`/v1/public/elections/${encodeURIComponent(electionId)}`);
  }

  /** null while voting is still open (409). */
  sealedBlocks(electionId: string): Promise<SealedBlockRecord[] | null> {
    return this.get(`/v1/public/elections/${encodeURIComponent(electionId)}/sealed-blocks`, [409]);
  }

  /** null while the commitment waits in the pool (404); 400 (not a commitment) also reads as "not found". */
  proof(electionId: string, commitment: string): Promise<BallotProof | null> {
    return this.get(`/v1/public/elections/${encodeURIComponent(electionId)}/proofs/${encodeURIComponent(commitment || '-')}`, [400, 404]);
  }

  /** The results bundle (M4a); null until published (404, or 409 before tally). */
  results(electionId: string): Promise<ResultsRecord | null> {
    return this.get(`/v1/public/elections/${encodeURIComponent(electionId)}/results`, [404, 409]);
  }

  /** The bylaws as the election's passed amendments give them; null when it amends none (404) or is not certified (409). */
  amendedBylaws(electionId: string): Promise<AmendedBylawsView | null> {
    return this.get(`/v1/public/elections/${encodeURIComponent(electionId)}/amended-bylaws`, [404, 409]);
  }

  /** A published bylaws version; null if there is none by that name. */
  bylaws(version: string): Promise<BylawsRecord | null> {
    return this.get(`/v1/bylaws/${encodeURIComponent(version)}`);
  }
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping order. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function attemptJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
