import { describe, expect, it } from 'vitest';
import { ApiError, PublicApi } from './api.js';
import { formatReport, hasFailures, type Section } from './report.js';
import { verify } from './run.js';
import { buildWorld, ELECTION_ID, fakeFetch } from './testing/fixtures.js';

const titles = (sections: readonly Section[]) => sections.map((s) => s.title);
const find = (sections: readonly Section[], title: string) => sections.find((s) => s.title.startsWith(title))!;

describe('verify against an api', () => {
  it('checks only the ledger by default', async () => {
    const w = await buildWorld();
    const sections = await verify(new PublicApi('http://api.test', fakeFetch(w)));
    expect(titles(sections)).toEqual(['Ledger']);
    expect(hasFailures(sections)).toBe(false);
  });

  it('checks a closed election end to end, paging through blocks, and says results are not published', async () => {
    const w = await buildWorld();
    const api = new PublicApi('http://api.test/', fakeFetch(w, { pageCap: 2 }));
    const sections = await verify(api, { electionId: ELECTION_ID });
    expect(titles(sections)).toEqual(['Ledger', 'Public ledger entries', 'Election: Committee Elections', 'Results']);
    expect(hasFailures(sections)).toBe(false);
    expect(find(sections, 'Ledger').findings[0]!.label).toBe(`${w.blocks.length} ledger blocks covering entries 1-${w.entries.length}`);
    expect(find(sections, 'Results').findings).toEqual([{ status: 'info', label: 'Results', detail: 'results not published' }]);
    expect(find(sections, 'Election').findings.some((f) => f.status === 'pending')).toBe(false);
  });

  it('reports a published results bundle without claiming to have checked it', async () => {
    const w = await buildWorld();
    const sections = await verify(new PublicApi('http://api.test', fakeFetch(w, { results: { v: 1 } })), { electionId: ELECTION_ID });
    expect(find(sections, 'Results').findings[0]).toMatchObject({ status: 'info', label: 'Results bundle published' });
  });

  it('fails when the api serves tampered sealed blocks', async () => {
    const w = await buildWorld();
    const sealedBlocks = structuredClone(w.sealedBlocks);
    (sealedBlocks[1]!.contests.chair![0]! as { selection: unknown }).selection = ['cb']; // block 2's voters chose ca and cc
    const sections = await verify(new PublicApi('http://api.test', fakeFetch({ ...w, sealedBlocks })), { electionId: ELECTION_ID });
    expect(hasFailures(sections)).toBe(true);
    const report = formatReport('test', sections);
    expect(report).toContain('[FAIL] Sealed block contents recompute and match their summaries');
    expect(report).toMatch(/FAILED: \d+ passed, 1 failed, 0 pending$/);
  });

  it('fails for an election the api does not publish', async () => {
    const w = await buildWorld();
    const sections = await verify(new PublicApi('http://api.test', fakeFetch(w)), { electionId: 'no-such-election' });
    expect(find(sections, 'Election').findings[0]!.status).toBe('fail');
  });

  it('scans the public entries on request without an election', async () => {
    const w = await buildWorld({ closed: false });
    const sections = await verify(new PublicApi('http://api.test', fakeFetch(w)), { scanEntries: true });
    expect(titles(sections)).toEqual(['Ledger', 'Public ledger entries']);
  });

  it('stops on an api it cannot read', async () => {
    const down: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(verify(new PublicApi('http://api.test', down))).rejects.toThrow(ApiError);
    const broken: typeof fetch = async () => new Response('{"detail":"boom"}', { status: 500 });
    await expect(verify(new PublicApi('http://api.test', broken))).rejects.toThrow(/^500 from http:\/\/api\.test\/v1\/public\/.+: boom$/);
  });
});
