import { GENESIS_HASH, newSalt, seedCommitment, tieBreakOrder } from 'ustp-audit';
import { describe, expect, it } from 'vitest';
import { definitionHash, type ElectionDefinition } from './elections.js';
import { RESULTS_CSV_NOTICE, resultsCsv } from './results-csv.js';
import { buildResultsBundle, resultsHash, type ResultsRecord } from './results.js';
import { buildSealedBlock, sealedBlockHash, sealedCommitments, type SealedBlockRecord } from './sealing.js';

const SEED = '5eed'.repeat(16);
const AT = '2026-10-21T12:00:00.000Z';
const ORIGIN = 'https://vote.example.org';
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

const candidate = (candidateId: string, name: string) => ({ candidateId, name, statement: `${name} would serve well.` });

function electionWith(names: { title?: string; board?: readonly string[] } = {}): ElectionDefinition {
  const board = names.board ?? ['Cara Diaz', 'Dev Patel, Jr.', 'Eli "Ace" Moss', 'Fay Wu'];
  return {
    v: 1,
    electionId: 'e1',
    title: names.title ?? 'Officers, "2026"',
    description: '',
    secrecy: 'secret',
    opensAt: AT,
    closesAt: AT,
    kAnonymity: 2,
    contests: [
      {
        contestId: 'plank',
        title: 'Plank 12',
        description: '',
        spec: { kind: 'proposal', id: 'plank', passRule: MAJORITY },
        proposal: { snapshotId: 'p1', title: 'Plank 12', contentHash: '0'.repeat(64) },
        candidates: [],
        positionId: null,
      },
      {
        contestId: 'board',
        title: 'Board',
        description: '',
        spec: {
          kind: 'choose_n',
          id: 'board',
          candidates: ['cara', 'dev', 'eli', 'fay'],
          seats: 2,
          maxSelections: 2,
          supportFloor: { ratio: { num: 1, den: 4 }, comparison: 'gte' },
        },
        proposal: null,
        candidates: ['cara', 'dev', 'eli', 'fay'].map((id, i) => candidate(id, board[i]!)),
        positionId: null,
      },
      {
        contestId: 'chair',
        title: 'Chair',
        description: '',
        spec: { kind: 'irv', id: 'chair', candidates: ['alex', 'blair', 'casey'] },
        proposal: null,
        candidates: [candidate('alex', 'Alex Rivera'), candidate('blair', 'Blair Chen'), candidate('casey', 'Casey Okafor')],
        positionId: 'chair',
      },
    ],
  };
}

/**
 * Plank: 3 yes, 1 no, 1 abstain. Board: Cara 3, Dev 2, Eli 2 (tied for the second seat), Fay 0, one blank. Chair:
 * Alex 2, Blair 2, Casey 1 in round 1; Casey is eliminated and her ballot goes to Alex, who wins round 2 with 3.
 */
const BALLOTS: readonly [string, string[], string[]][] = [
  ['yes', ['cara', 'dev'], ['alex', 'blair']],
  ['yes', ['cara', 'eli'], ['alex']],
  ['no', ['dev', 'eli'], ['blair']],
  ['abstain', ['cara'], ['blair', 'alex']],
  ['yes', [], ['casey', 'alex']],
];

function blocksFor(definition: ElectionDefinition): SealedBlockRecord[] {
  const ballots = BALLOTS.map((selections) => ({
    parts: definition.contests.map(({ contestId }, i) => ({ v: 1 as const, electionId: 'e1', contestId, selection: selections[i], salt: newSalt() })),
  }));
  const block = buildSealedBlock({ electionId: 'e1', index: 1, prevSealedHash: GENESIS_HASH, ballots, sealedAt: AT });
  return [{ ...block, sealedHash: sealedBlockHash(block), commitments: sealedCommitments(block.contests), ledgerSeq: 1 }];
}

function recordFor(definition: ElectionDefinition, extra: Partial<ResultsRecord> = {}): ResultsRecord {
  const bundle = buildResultsBundle({
    definition,
    definitionHash: definitionHash(definition),
    roll: { snapshotId: 'r1', merkleRoot: 'ab'.repeat(32), count: 7 },
    tieBreakSeed: SEED,
    tieBreakSeedCommitment: seedCommitment(SEED),
    blocks: blocksFor(definition),
  });
  return {
    electionId: 'e1',
    status: 'provisional',
    bundle,
    resultsHash: resultsHash(bundle),
    signature: { keyVersion: 'emulator/audit-signing/1', signature: 'c2ln' },
    computedAt: AT,
    ledgerSeq: 9,
    ...extra,
  };
}

/** A strict RFC 4180 reader: quoted fields only where needed, CRLF after every record, no bare quotes or line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') (cell += '"'), i++;
      else if (text[i + 1] === ',' || text[i + 1] === '\r') quoted = false;
      else throw new Error(`text after a closing quote at ${i}`);
    } else if (ch === '"') {
      if (cell) throw new Error(`a quote inside an unquoted field at ${i}`);
      quoted = true;
    } else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\r' && text[i + 1] === '\n') row.push(cell), rows.push(row), (row = []), (cell = ''), i++;
    else if (ch === '\r' || ch === '\n') throw new Error(`a line break outside quotes at ${i}`);
    else cell += ch;
  }
  if (quoted || cell || row.length) throw new Error('the last record does not end with CRLF');
  return rows;
}

/** Rows without the padding cells. */
const trimmed = (rows: string[][]) => rows.map((r) => r.slice(0, r.findLastIndex((c) => c !== '') + 1));

function csvOf(definition: ElectionDefinition, extra: Partial<ResultsRecord> = {}) {
  const results = recordFor(definition, extra);
  const text = resultsCsv({ results, definition, origin: ORIGIN });
  const rows = parseCsv(text);
  return { results, text, rows, cells: trimmed(rows) };
}

/** The rows of one contest, from its `Contest` row to the blank row after it. */
function contest(cells: string[][], title: string): string[][] {
  const start = cells.findIndex((r) => r[0] === 'Contest' && r[1] === title);
  expect(start).toBeGreaterThan(0);
  const end = cells.findIndex((r, i) => i > start && r.length === 0);
  return cells.slice(start, end < 0 ? undefined : end);
}

describe('results CSV', () => {
  it('starts with the election, the provisional status, the results hash and where to check the signed bundle', () => {
    const { results, cells } = csvOf(electionWith());
    expect(cells.slice(0, 11)).toEqual([
      ['Election', 'Officers, "2026"'],
      ['Notice', RESULTS_CSV_NOTICE],
      ['Status', 'Provisional (not yet certified)'],
      ['Certified at'],
      ['Counted at', AT],
      ['Results hash', results.resultsHash],
      ['Results page', `${ORIGIN}/results/e1`],
      ['Signed bundle', `${ORIGIN}/v1/public/elections/e1/results`],
      ['Election ID', 'e1'],
      ['Ballots counted', '5'],
      ['Voters on the roll', '7'],
    ]);
    expect(cells[11]).toEqual([]);
    expect(RESULTS_CSV_NOTICE).toMatch(/authoritative record is the signed results bundle/);
  });

  it('shows certified results as certified, with the time', () => {
    const certifiedAt = '2026-10-22T09:30:00.000Z';
    const { cells } = csvOf(electionWith(), { status: 'certified', certifiedAt, certifiedLedgerSeq: 12 });
    expect(cells[2]).toEqual(['Status', 'Certified']);
    expect(cells[3]).toEqual(['Certified at', certifiedAt]);
  });

  it('is RFC 4180: CRLF after every record, rows of one width, quotes doubled, separators quoted', () => {
    const { text, rows } = csvOf(electionWith());
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.split('\r\n').at(-1)).toBe('');
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
    expect(text.startsWith('Election,"Officers, ""2026"""')).toBe(true);
    expect(text).toContain('\r\n"Dev Patel, Jr.",2,');
    expect(text).toContain('\r\n"Eli ""Ace"" Moss",2,');
    // A line break inside a name stays inside its quoted cell.
    const multiline = csvOf(electionWith({ title: 'Officers\r\n2026' }));
    expect(multiline.text.startsWith('Election,"Officers\r\n2026",')).toBe(true);
    expect(multiline.cells[0]).toEqual(['Election', 'Officers\r\n2026']);
  });

  it('keeps cells that a spreadsheet would run as formulas as text', () => {
    const board = ['=HYPERLINK("https://evil.test","x")', '+1+1', '-2+3', '@SUM(A1)'];
    const { text, cells } = csvOf(electionWith({ title: '\tcmd|calc', board }));
    expect(cells[0]).toEqual(['Election', "'\tcmd|calc"]);
    const names = contest(cells, 'Board').slice(5, 9).map((r) => r[0]).sort();
    expect(names).toEqual(board.map((name) => `'${name}`).sort());
    expect(text).toContain(`"'=HYPERLINK(""https://evil.test"",""x"")"`);
    expect(csvOf(electionWith({ title: '\rOfficers' })).cells[0]).toEqual(['Election', "'\rOfficers"]);
    // Only a leading character counts, and counts are numbers.
    expect(csvOf(electionWith({ title: 'A = B' })).cells[0]).toEqual(['Election', 'A = B']);
    expect(contest(cells, 'Plank 12')).toContainEqual(['Yes', '3']);
  });

  it('lists the proposal choices, the quorum and the outcome', () => {
    const { cells } = csvOf(electionWith());
    expect(contest(cells, 'Plank 12')).toEqual([
      ['Contest', 'Plank 12'],
      ['Contest ID', 'plank'],
      ['Type', 'Proposal'],
      ['Choice', 'Votes'],
      ['Yes', '3'],
      ['No', '1'],
      ['Abstain', '1'],
      ['Ballots', '5'],
      ['Invalid', '0'],
      ['Quorum', 'none'],
      ['Outcome', 'Passed'],
    ]);
  });

  it('ranks choose-N candidates with the support floor, the tie for the last seat and the winners', () => {
    const { cells } = csvOf(electionWith());
    const NAMES: Record<string, string> = { cara: 'Cara Diaz', dev: 'Dev Patel, Jr.', eli: 'Eli "Ace" Moss', fay: 'Fay Wu' };
    const order = tieBreakOrder(SEED, 'board', ['cara', 'dev', 'eli', 'fay']);
    // Dev and Eli tie on 2 votes for the second seat; the seeded order decides.
    const [favoured, other] = order.filter((id) => id === 'dev' || id === 'eli').map((id) => NAMES[id]!);
    expect(contest(cells, 'Board')).toEqual([
      ['Contest', 'Board'],
      ['Contest ID', 'board'],
      ['Type', 'Choose candidates'],
      ['Seats', '2'],
      ['Candidate', 'Votes', 'Elected', 'Meets support floor'],
      ['Cara Diaz', '3', 'yes', 'yes'],
      [favoured, '2', 'yes', 'yes'],
      [other, '2', 'no', 'yes'],
      ['Fay Wu', '0', 'no', 'no'],
      ['Ballots', '5'],
      ['Blank', '1'],
      ['Invalid', '0'],
      ['Vacant seats', '0'],
      ['Tie', `${favoured}, ${other} tied for the last seat; resolved by the tie-break order drawn from the election's seed: ${other} not elected.`],
      ['Tie-break order', order.map((id) => NAMES[id]).join(', ')],
      ['Elected', `Cara Diaz, ${favoured}`],
    ]);
  });

  it('gives every instant-runoff round, with blanks once a candidate is out', () => {
    const { rows, cells } = csvOf(electionWith());
    const chair = contest(cells, 'Chair');
    expect(chair.slice(0, 3)).toEqual([['Contest', 'Chair'], ['Contest ID', 'chair'], ['Type', 'Ranked choice (instant runoff)']]);
    const start = rows.findIndex((r) => r[0] === 'Contest' && r[1] === 'Chair') + 3;
    expect(rows.slice(start, start + 7).map((r) => r.slice(0, 3))).toEqual([
      ['Candidate', 'Round 1', 'Round 2'],
      ['Alex Rivera', '2', '3'],
      ['Blair Chen', '2', '2'],
      ['Casey Okafor', '1', ''],
      ['Continuing ballots', '5', '5'],
      ['Exhausted', '0', '0'],
      ['Round result', 'Casey Okafor eliminated', 'Alex Rivera elected'],
    ]);
    expect(chair.slice(10)).toEqual([
      ['Ballots', '5'],
      ['Blank', '0'],
      ['Invalid', '0'],
      ['Tie-break order', expect.any(String)],
      ['Elected', 'Alex Rivera'],
    ]);
    // The last contest ends the file.
    expect(cells.at(-1)).toEqual(['Elected', 'Alex Rivera']);
  });

  it('holds nothing beyond the bundle and the published definition', () => {
    const { text } = csvOf(electionWith());
    expect(text).not.toContain('would serve well'); // candidate statements are on the ballot, not in the results
    expect(text).not.toContain(SEED);
    expect(text).not.toContain('c2ln'); // the signature stays in the signed record
  });

  it('refuses a definition the bundle was not counted from', () => {
    const definition = electionWith();
    const results = recordFor(definition);
    expect(() => resultsCsv({ results, definition: { ...definition, title: 'Other' }, origin: ORIGIN })).toThrow(/not the one/);
    expect(() => resultsCsv({ results: { ...results, electionId: 'e2' }, definition, origin: ORIGIN })).toThrow(/not the one/);
  });
});
