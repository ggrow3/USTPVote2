import { describe, expect, it } from 'vitest';
import { ballotProblems } from './ballots.js';
import {
  DEMO_FIRST_NAMES,
  DEMO_MEASURE_NOTE,
  DEMO_SURNAMES,
  DEMO_TITLE_PREFIX,
  demoElection,
  demoElectionInputSchema,
  type DemoElectionOptions,
} from './demo-election.js';
import { packageProposals, packageRecords, type ElectionPackage } from './election-package.js';
import { buildDefinition, MIN_K_ANONYMITY, validateDefinition, type ProposalSnapshotRecord } from './elections.js';
import { randomBallot, seededRandom } from './test-votes.js';

const NOW = new Date('2026-10-28T12:00:00Z');
const make = (seed: string, options: Partial<DemoElectionOptions> = {}) =>
  demoElection(seededRandom(seed), { now: NOW, opensInSeconds: 60, votingSeconds: 900, ...options });
const SEEDS = Array.from({ length: 200 }, (_, i) => `seed-${i}`);
const demos = SEEDS.map((seed) => make(seed));

/**
 * People a demo must never name: well-known transhumanists, past and present, party figures among them. No word of
 * their names may be one of the demo's first names or surnames, and no full name may appear anywhere in a demo.
 */
const REAL_PEOPLE = [
  'Gennady Stolyarov', 'Zoltan Istvan', 'Max More', 'Natasha Vita-More', 'Ray Kurzweil', 'Aubrey de Grey',
  'Nick Bostrom', 'David Pearce', 'Ben Goertzel', 'Anders Sandberg', 'Julian Huxley', 'James Hughes',
  'Martine Rothblatt', 'Hank Pellissier', 'Bill Andrews', 'Liz Parrish', 'Kevin Warwick', 'Neil Harbisson',
  'Marvin Minsky', 'Hans Moravec', 'Eliezer Yudkowsky', 'Robin Hanson', 'Ralph Merkle', 'Eric Drexler',
  'Robert Ettinger', 'Peter Diamandis', 'Johannon Ben Zion', 'Charlie Kam', 'Dinorah Delfin', 'Arin Vahanian',
  'Nikola Danaylov', 'Steve Fuller', 'Riccardo Campa', 'Giulio Prisco', 'Amon Twyman', 'Michael Perry',
];
const words = (name: string) => name.toLowerCase().split(/[\s-]+/);

function candidateNames(pkg: ElectionPackage): string[] {
  return pkg.contests.flatMap((c) => (c.kind === 'proposal' ? [] : c.candidates.map((k) => k.name)));
}

/** The draft an import would write, as the definition scheduling freezes. */
function definitionOf(pkg: ElectionPackage) {
  let n = 0;
  const proposals = packageProposals(pkg).map((p, i): ProposalSnapshotRecord | null =>
    p && 'input' in p
      ? { snapshotId: `p${i}`, title: p.input.title, body: p.input.body, source: p.input.source ?? null, contentHash: p.contentHash, capturedAt: NOW.toISOString(), capturedBy: 'ea' }
      : null,
  );
  const records = packageRecords(pkg, { electionId: 'demo', createdBy: 'ea', now: NOW, newId: () => `k${++n}`, snapshotIds: proposals.map((p) => p?.snapshotId ?? null) });
  return buildDefinition(records.election, records.contests, records.candidates, proposals.filter((p) => p !== null));
}

describe('demo elections', () => {
  it('are elections a draft can be made from and scheduled, with a ballot that can be cast', () => {
    for (const [i, pkg] of demos.entries()) {
      const definition = definitionOf(pkg);
      expect(validateDefinition(definition, NOW)).toEqual([]);
      expect(definition.opensAt).toBe('2026-10-28T12:01:00.000Z');
      expect(definition.closesAt).toBe('2026-10-28T12:16:00.000Z');
      expect(definition.kAnonymity).toBeGreaterThanOrEqual(MIN_K_ANONYMITY);

      const offices = pkg.contests.filter((c) => c.kind !== 'proposal');
      const measures = pkg.contests.filter((c) => c.kind === 'proposal');
      expect(offices.length).toBeGreaterThanOrEqual(2);
      expect(offices.length).toBeLessThanOrEqual(4);
      expect(measures.length).toBeLessThanOrEqual(2);
      expect(pkg.contests.slice(offices.length).every((c) => c.kind === 'proposal')).toBe(true);
      for (const c of offices) {
        const seats = c.kind === 'choose_n' ? c.seats : 1;
        expect(c.candidates.length).toBeGreaterThanOrEqual(seats === 1 ? 2 : seats + 1);
        expect(c.candidates.length).toBeLessThanOrEqual(seats === 1 ? 4 : seats + 2);
        // Nothing seats anybody or links an account, so a certified demo can still be deleted (design §6.1).
        expect(c.positionId ?? null).toBeNull();
        expect(c.candidates.every((k) => !('accountId' in k) || k.accountId === undefined)).toBe(true);
        expect(c.candidates.every((k) => 'statement' in k && k.statement!.length > 40)).toBe(true);
      }
      for (const c of measures) if (c.kind === 'proposal') expect(c.proposal.amendment).toBeUndefined();

      const ballot = randomBallot(definition, seededRandom(`ballot-${i}`), 0).map((s) => ({ v: 1 as const, electionId: 'demo', ...s, salt: '00'.repeat(32) }));
      expect(ballotProblems(definition, ballot)).toEqual([]);
    }
  });

  it('use every kind of contest, both ballots and both pass rules', () => {
    const contests = demos.flatMap((pkg) => pkg.contests);
    const systems = new Set(
      contests.map((c) =>
        c.kind === 'choose_n' ? (c.seats > 1 ? 'block' : c.maxSelections === 1 ? 'plurality' : 'approval') : c.kind,
      ),
    );
    expect([...systems].sort()).toEqual(['approval', 'block', 'irv', 'plurality', 'proposal']);
    expect(new Set(demos.map((pkg) => pkg.secrecy))).toEqual(new Set(['secret', 'open']));
    const rules = new Set(contests.flatMap((c) => (c.kind === 'proposal' ? [JSON.stringify(c.passRule.threshold.ratio)] : [])));
    expect(rules.size).toBe(2);
    expect(new Set(demos.map((pkg) => pkg.contests.filter((c) => c.kind === 'proposal').length))).toEqual(new Set([0, 1, 2]));
  });

  it('name only invented people', () => {
    const realWords = new Set(REAL_PEOPLE.flatMap(words));
    expect([...DEMO_FIRST_NAMES, ...DEMO_SURNAMES].filter((name) => words(name).some((w) => realWords.has(w)))).toEqual([]);
    for (const pkg of demos) {
      const names = candidateNames(pkg);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) {
        const [first, last, ...rest] = name.split(' ');
        expect(rest).toEqual([]);
        expect(DEMO_FIRST_NAMES).toContain(first);
        expect(DEMO_SURNAMES).toContain(last);
      }
      const text = JSON.stringify(pkg).toLowerCase();
      expect(REAL_PEOPLE.filter((person) => text.includes(person.toLowerCase()))).toEqual([]);
    }
  });

  it('say they are demos in the title, the description and every measure', () => {
    for (const pkg of demos) {
      expect(pkg.title.startsWith(DEMO_TITLE_PREFIX)).toBe(true);
      expect(pkg.title).toMatch(/^\[Demo\] 202[67] .+ (Election|Vote)$/);
      expect(pkg.description).toContain('demonstration election, made up at random');
      expect(pkg.description).toContain('no real person is standing');
      for (const c of pkg.contests) {
        if (c.kind !== 'proposal') continue;
        expect(c.proposal.body!.endsWith(DEMO_MEASURE_NOTE)).toBe(true);
        expect(c.proposal.source).toBe('Made up for a demo election');
      }
    }
  });

  it('are the same for the same seed and differ from seed to seed', () => {
    expect(make('repeatable')).toEqual(make('repeatable'));
    const distinct = new Set(demos.map((pkg) => JSON.stringify(pkg)));
    expect(distinct.size).toBe(SEEDS.length);
    expect(new Set(demos.map((pkg) => pkg.title)).size).toBeGreaterThan(50);
    expect(new Set(demos.map((pkg) => candidateNames(pkg).join())).size).toBe(SEEDS.length);
  });

  it('keep the ballot asked for, and the window given', () => {
    expect(SEEDS.slice(0, 20).every((seed) => make(seed, { secrecy: 'open' }).secrecy === 'open')).toBe(true);
    expect(SEEDS.slice(0, 20).every((seed) => make(seed, { secrecy: 'secret' }).secrecy === 'secret')).toBe(true);
    expect(make('w', { opensInSeconds: 300, votingSeconds: 7200 }).window).toEqual({ opensInSeconds: 300, votingSeconds: 7200 });
  });

  it('take a request that defaults to opening now for a quarter of an hour', () => {
    expect(demoElectionInputSchema.parse({})).toEqual({ opens: 'now', votingMinutes: 15 });
    expect(demoElectionInputSchema.parse({ opens: 'soon', votingMinutes: 120, secrecy: 'open', seed: ' abc ' })).toEqual({
      opens: 'soon',
      votingMinutes: 120,
      secrecy: 'open',
      seed: 'abc',
    });
    for (const bad of [{ votingMinutes: 4 }, { votingMinutes: 1441 }, { opens: 'later' }, { secrecy: 'hidden' }, { seed: '' }, { voters: 3 }]) {
      expect(demoElectionInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});
