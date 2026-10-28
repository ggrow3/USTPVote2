import type { LedgerBlockRecord, PublicLedgerEntry } from 'ustp-domain';
import { ApiError, mapLimited, PublicApi } from 'ustp-verify';

/** Ledger entries fetched at once, as ustp-verify does. */
const CONCURRENCY = 8;
/** Largest page `GET /v1/public/ledger/blocks` serves. */
const BLOCK_PAGE = 200;

/**
 * The public api with what the signed ledger makes immutable kept between calls (design §3.4): a ledger block never
 * changes once signed, nor does a blocked entry, nor the 404 a private entry answers. Election records and results do
 * change (state, sealing, certification), so they are always fetched afresh. The api has no index of entries by type,
 * so listing elections and checking one scan every entry; kept, a second scan fetches only what is new.
 */
export class CachingPublicApi extends PublicApi {
  private readonly blocks: LedgerBlockRecord[] = [];
  private readonly entries = new Map<number, Promise<PublicLedgerEntry | null>>();
  private refreshing: Promise<LedgerBlockRecord[]> | null = null;

  constructor(
    base: string,
    private readonly fetchText: typeof fetch = fetch,
  ) {
    super(base, fetchText);
  }

  /** Every ledger block: the kept ones, then any signed since. Concurrent callers share one refresh. */
  override ledgerBlocks(): Promise<LedgerBlockRecord[]> {
    this.refreshing ??= this.refreshBlocks().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refreshBlocks(): Promise<LedgerBlockRecord[]> {
    for (;;) {
      const after = this.blocks.at(-1)?.index ?? 0;
      const page = await this.require<LedgerBlockRecord[]>(`/v1/public/ledger/blocks?after=${after}&limit=${BLOCK_PAGE}`);
      if (page.length === 0) return [...this.blocks];
      // A page must move forward, or a misbehaving api would keep this loop going.
      if (!(page[0]!.index > after)) throw new ApiError(200, this.base, `ledger block paging did not advance past ${after}`);
      this.blocks.push(...page);
    }
  }

  /**
   * A public entry, or null for a private one. Only answers about blocked entries are kept: an entry newer than the
   * last block answers 404 until the next tick blocks it.
   */
  override ledgerEntry(seq: number): Promise<PublicLedgerEntry | null> {
    const kept = this.entries.get(seq);
    if (kept) return kept;
    const blockedThrough = this.blocks.at(-1)?.lastSeq ?? 0;
    const fetching = super.ledgerEntry(seq).then(
      (found) => {
        if (!found && seq > blockedThrough) this.entries.delete(seq);
        return found;
      },
      (e: unknown) => {
        this.entries.delete(seq);
        throw e;
      },
    );
    this.entries.set(seq, fetching);
    return fetching;
  }

  /** Every public entry the signed blocks cover, oldest first. */
  async publicEntries(): Promise<PublicLedgerEntry[]> {
    const through = (await this.ledgerBlocks()).at(-1)?.lastSeq ?? 0;
    const seqs = Array.from({ length: through }, (_, i) => i + 1);
    const found = await mapLimited(seqs, CONCURRENCY, (seq) => this.ledgerEntry(seq));
    return found.filter((e): e is PublicLedgerEntry => e !== null);
  }

  /** A text document, such as the results CSV; null when the api answers 404 or 409. */
  async text(path: string): Promise<string | null> {
    const url = `${this.base}${path}`;
    let res: Response;
    try {
      res = await this.fetchText(url, { headers: { accept: 'text/csv, text/plain' } });
    } catch (e) {
      throw new ApiError(0, url, `cannot reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) throw new ApiError(res.status, url, `${res.status} from ${url}`);
    return res.text();
  }
}
