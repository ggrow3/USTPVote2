import JSZip from 'jszip';
import { GENESIS_HASH, newSalt, seedCommitment } from 'ustp-audit';
import {
  buildResultsBundle,
  buildSealedBlock,
  definitionHash,
  proposalContentHash,
  resultsHash,
  sealedBlockHash,
  sealedCommitments,
  type BylawsAmendment,
  type ElectionDefinition,
  type ResultsRecord,
  type SealedBlockRecord,
} from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { readDocxText } from './docx-text.js';
import { electionDocxBytes, electionDocxFileName, type ElectionDocxInput, type ProposalText } from './election-docx.js';

const SEED = '5eed'.repeat(16);
const ORIGIN = 'https://vote.example.org';
const MAJORITY = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' as const }, base: 'yes_no' as const };

const amendment: BylawsAmendment = {
  v: 1,
  base: { version: '2026.1', contentHash: 'ab'.repeat(32) },
  changes: [{ op: 'replace', from: 1, to: 1, expect: ['Article I. Name.'], lines: ['Article I. The name of the party.'] }],
};
const plank: ProposalText = {
  snapshotId: 'p1',
  title: 'Plank 12',
  body: 'The party supports open science.\n\nPublicly funded research is published openly.',
  contentHash: proposalContentHash('Plank 12', 'The party supports open science.\n\nPublicly funded research is published openly.'),
  amendment: null,
};
const rename: ProposalText = {
  snapshotId: 'p2',
  title: 'Rename Article I',
  body: 'The heading should say what the article is about.',
  contentHash: proposalContentHash('Rename Article I', 'The heading should say what the article is about.', amendment),
  amendment,
};

const candidate = (candidateId: string, name: string) => ({ candidateId, name, statement: `${name} would serve well.\nTen years a member.` });

const definition: ElectionDefinition = {
  v: 1,
  electionId: 'e1',
  title: 'Officers 2026',
  description: 'The annual election of officers.',
  secrecy: 'secret',
  opensAt: '2026-10-20T14:00:00.000Z',
  closesAt: '2026-10-21T14:00:00.000Z',
  kAnonymity: 2,
  contests: [
    {
      contestId: 'plank',
      title: 'Plank 12',
      description: 'From the platform committee.',
      spec: { kind: 'proposal', id: 'plank', passRule: MAJORITY, quorum: { minBallots: 3 } },
      proposal: { snapshotId: 'p1', title: plank.title, contentHash: plank.contentHash },
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
      candidates: [candidate('cara', 'Cara Diaz'), candidate('dev', 'Dev Patel'), candidate('eli', 'Eli Moss'), candidate('fay', 'Fay Wu')],
      positionId: null,
    },
    {
      contestId: 'chair',
      title: 'Chair',
      description: '',
      spec: { kind: 'irv', id: 'chair', candidates: ['alex', 'blair', 'casey'], maxRanks: 2 },
      proposal: null,
      candidates: [candidate('alex', 'Alex Rivera'), candidate('blair', 'Blair Chen'), { candidateId: 'casey', name: 'Casey Okafor', statement: null }],
      positionId: 'chair',
    },
    {
      contestId: 'rename',
      title: 'Bylaws: Article I',
      description: '',
      spec: { kind: 'proposal', id: 'rename', passRule: { ...MAJORITY, threshold: { ratio: { num: 2, den: 3 }, comparison: 'gte' } } },
      proposal: { snapshotId: 'p2', title: rename.title, contentHash: rename.contentHash, amendsBylaws: amendment.base },
      candidates: [],
      positionId: null,
    },
  ],
};

/**
 * Plank: 3 yes, 1 no, 1 abstain. Board: Cara 3, Dev 2, Eli 2 (tied for the second seat), Fay 0, one blank. Chair:
 * Alex 2, Blair 2, Casey 1 in round 1; Casey is eliminated and her ballot goes to Alex, who wins round 2 with 3.
 * Article I: 2 yes, 2 no, short of two-thirds.
 */
const BALLOTS: readonly [string, string[], string[], string][] = [
  ['yes', ['cara', 'dev'], ['alex', 'blair'], 'yes'],
  ['yes', ['cara', 'eli'], ['alex'], 'yes'],
  ['no', ['dev', 'eli'], ['blair'], 'no'],
  ['abstain', ['cara'], ['blair', 'alex'], 'no'],
  ['yes', [], ['casey', 'alex'], 'abstain'],
];

function results(extra: Partial<ResultsRecord> = {}): ResultsRecord {
  const ballots = BALLOTS.map((selections) => ({
    parts: definition.contests.map(({ contestId }, i) => ({ v: 1 as const, electionId: 'e1', contestId, selection: selections[i], salt: newSalt() })),
  }));
  const block = buildSealedBlock({ electionId: 'e1', index: 1, prevSealedHash: GENESIS_HASH, ballots, sealedAt: definition.closesAt });
  const blocks: SealedBlockRecord[] = [{ ...block, sealedHash: sealedBlockHash(block), commitments: sealedCommitments(block.contests), ledgerSeq: 1 }];
  const bundle = buildResultsBundle({
    definition,
    definitionHash: definitionHash(definition),
    roll: { snapshotId: 'r1', merkleRoot: 'cd'.repeat(32), count: 7 },
    tieBreakSeed: SEED,
    tieBreakSeedCommitment: seedCommitment(SEED),
    blocks,
  });
  return {
    electionId: 'e1',
    status: 'provisional',
    bundle,
    resultsHash: resultsHash(bundle),
    signature: { keyVersion: 'emulator/audit-signing/1', signature: 'c2ln' },
    computedAt: '2026-10-21T14:01:00.000Z',
    ledgerSeq: 9,
    ...extra,
  };
}

const input = (extra: Partial<ElectionDocxInput> = {}): ElectionDocxInput => ({
  definition,
  state: 'scheduled',
  proposals: [plank, rename],
  results: null,
  origin: ORIGIN,
  exportedAt: new Date('2026-10-25T12:00:00.000Z'),
  timeZone: 'UTC',
  ...extra,
});

/**
 * The document's text, one line per paragraph (table cells too, list items with their bullet), and its stamp block's
 * lines, both in order.
 */
async function read(i: ElectionDocxInput) {
  const bytes = await electionDocxBytes(i);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  const stamp = [...xml.matchAll(/<w:p>(?:(?!<\/w:p>).)*?w:val="UstpStamp"(?:(?!<\/w:p>).)*?<\/w:p>/gs)].map((m) =>
    [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
  );
  const footer = await zip.file(/word\/footer\d*\.xml/)[0]!.async('string');
  return { lines: (await readDocxText(bytes)).split('\n'), stamp: stamp.filter(Boolean), xml, footer };
}

/** Asserts that each expected line is in the document, in this order (other lines may come between). */
function expectInOrder(lines: readonly string[], expected: readonly (string | RegExp)[]) {
  let from = 0;
  for (const e of expected) {
    const at = lines.findIndex((l, i) => i >= from && (typeof e === 'string' ? l === e : e.test(l)));
    expect(at, `${String(e)} after line ${from}`).toBeGreaterThanOrEqual(0);
    from = at + 1;
  }
}

describe('the ballot', () => {
  it('gives the overview, then every contest in order with its rules, candidates and texts', async () => {
    const { lines, stamp } = await read(input());
    expect(stamp).toEqual([
      'UNITED STATES TRANSHUMANIST PARTY',
      'Ballot · Officers 2026',
      'The ballot as frozen at scheduling',
      `Definition hash: ${definitionHash(definition)}`,
      `Exported 2026-10-25 from ${ORIGIN}.`,
    ]);
    expectInOrder(lines, [
      'Officers 2026',
      /^Voting opens: October 20, 2026.* 2:00\sPM UTC$/,
      /^Voting closes: October 21, 2026.* 2:00\sPM UTC$/,
      'Ballot: Secret ballot',
      'The annual election of officers.',
      'Ballot',
      '1. Plank 12',
      'Proposal (yes / no / abstain)',
      'From the platform committee.',
      '● Passes with more than half of yes + no votes (abstentions ignored).',
      '● Quorum: at least 3 ballots.',
      'Full text: Plank 12',
      'The party supports open science.',
      '',
      'Publicly funded research is published openly.',
      `Content hash ${plank.contentHash}`,
      '2. Board',
      'Choose candidates',
      '● Elect 2; voters choose up to 2.',
      '● A winner needs at least 1/4 of the ballots in this contest.',
      'Candidates',
      'Cara Diaz',
      'Cara Diaz would serve well.',
      'Ten years a member.',
      'Dev Patel',
      'Eli Moss',
      'Fay Wu',
      '3. Chair',
      'Ranked choice (instant runoff)',
      '● Voters may rank up to 2.',
      'Alex Rivera',
      'Blair Chen',
      'Casey Okafor',
      '4. Bylaws: Article I',
      '● Passes with at least two-thirds of yes + no votes (abstentions ignored).',
      'Changes to the bylaws, version 2026.1',
      `Amends bylaws version 2026.1 (SHA-256 ${'ab'.repeat(32)}).`,
      '1. Replace line 1:',
      '   was: Article I. Name.',
      '   now: Article I. The name of the party.',
      'Reasons given',
      'The heading should say what the article is about.',
    ]);
    expect(lines).not.toContain('Results');
    expect(lines.join('\n')).not.toMatch(/Provisional|Certified|Results hash/);
  });

  it('names a proposal by its hash when this viewer cannot read its text', async () => {
    const { lines } = await read(input({ proposals: [] }));
    expectInOrder(lines, [
      '1. Plank 12',
      'Text: Plank 12',
      'The full text is on the ballot, which voters on the roll can open.',
      `Content hash ${plank.contentHash}`,
      '4. Bylaws: Article I',
      'Text: Rename Article I',
      'Amends bylaws version 2026.1.',
    ]);
    expect(lines).not.toContain('The party supports open science.');
  });

  it('says a roll-call ballot is published with names, and marks a draft as not final', async () => {
    const { lines, stamp, footer } = await read(input({ state: 'draft', definition: { ...definition, secrecy: 'open' } }));
    expect(lines).toContain('Ballot: Roll-call: how each voter votes is published with their name');
    expect(stamp[2]).toBe('Draft · not final: the ballot can change until the election is scheduled');
    expect(stamp[3]).toMatch(/^Definition hash as it stands: [0-9a-f]{64}$/);
    expect(footer).toContain('Draft · page');
  });

  it('refuses a proposal text the definition does not commit to', async () => {
    const tampered = { ...plank, body: `${plank.body} Except on Tuesdays.` };
    await expect(electionDocxBytes(input({ proposals: [tampered] }))).rejects.toThrow(/text of “Plank 12” is not the one the ballot commits to/);
  });
});

describe('the results', () => {
  it('follow the ballot, marked provisional, with every count and the round-by-round table', async () => {
    const r = results();
    const { lines, stamp, xml } = await read(input({ state: 'closed', results: r }));
    expect(stamp).toEqual([
      'UNITED STATES TRANSHUMANIST PARTY',
      'Ballot and results · Officers 2026',
      'Provisional results · not yet certified',
      `Definition hash: ${definitionHash(definition)}`,
      `Results hash: ${r.resultsHash}`,
      `Exported 2026-10-25. An unsigned copy: the signed results at ${ORIGIN}/results/e1 are the record.`,
    ]);
    expectInOrder(lines, [
      'Ballot',
      '4. Bylaws: Article I',
      'Results',
      'Provisional: these results are signed and in the audit ledger, but not yet certified.',
      /^5 of 7 on the roll voted\. Counted October 21, 2026.* 2:01\sPM UTC\.$/,
      '1. Plank 12',
      'Outcome: Passed',
      'Choice',
      'Votes',
      'Yes',
      '3',
      'No',
      '1',
      'Abstain',
      '1',
      '5 ballots. Quorum: 5 of 3 needed (met).',
      '2. Board',
      /^Elected: Cara Diaz, (Dev Patel|Eli Moss)$/,
      'Candidate',
      'Votes',
      'Elected',
      'Support floor',
      'Cara Diaz',
      '3',
      'yes',
      'met',
      /^(Dev Patel|Eli Moss), (Eli Moss|Dev Patel) tied for the last seat; resolved by the tie-break order drawn from the election’s seed: (Eli Moss|Dev Patel) not elected\.$/,
      /^5 ballots \(1 blank\)\. Tie-break order: .*Fay Wu.*\.$/,
      '3. Chair',
      'Elected: Alex Rivera',
      'Candidate',
      'Round 1',
      'Round 2',
      'Alex Rivera',
      '2',
      '3',
      'Blair Chen',
      '2',
      '2',
      'Casey Okafor',
      '1',
      '—',
      'Continuing ballots',
      'Exhausted',
      'Round 1: Casey Okafor eliminated.',
      'Round 2: Alex Rivera elected.',
      '4. Bylaws: Article I',
      'Outcome: Failed',
      'Checking these results',
      `Results page: ${ORIGIN}/results/e1`,
      `Signed results: ${ORIGIN}/v1/public/elections/e1/results`,
      `Results hash: ${r.resultsHash}`,
      `Definition hash: ${definitionHash(definition)}`,
      `Revealed tie-break seed: ${SEED}`,
    ]);
    expect(lines.join('\n')).not.toContain('Certified');
    // The links are links, and the tables repeat their header row on each page.
    expect(xml).toMatch(/<w:hyperlink [^>]*r:id="[^"]+"/);
    expect(xml).toContain('<w:tblHeader/>');
  });

  it('open with the synopsis: the facts, each contest in brief and the closing tally, then the ballot', async () => {
    const { lines } = await read(input({ state: 'closed', results: results() }));
    expectInOrder(lines, [
      'Officers 2026',
      'Synopsis',
      /^Voting: October 20, 2026.* 2:00\sPM UTC to October 21, 2026.* 2:00\sPM UTC$/,
      'On the roll: 7',
      'Ballots cast: 5',
      'Turnout: 71.4%',
      /^Counted: October 21, 2026.* 2:01\sPM UTC$/,
      'Status: Provisional: signed and in the audit ledger, not yet certified',
      '1. Plank 12',
      'Outcome: Passed',
      ...['Choice', 'Votes', 'Share', 'Yes', '3', '60.0%', 'No', '1', '20.0%', 'Abstain', '1', '20.0%'],
      'Yes: 75.0% of yes and no votes; needed more than half (50.0%).',
      '5 ballots. Quorum: 5 ballots of the 3 needed; met.',
      '2. Board',
      'Outcome: 2 elected',
      ...['Candidate', 'Votes', 'Share', 'Result', 'Cara Diaz', '3', '60.0%', 'Elected'],
      ...['Fay Wu', '0', '0.0%', 'Not elected', 'Blank (no choice)', '1', '20.0%'],
      '5 ballots (1 blank); 2 seats. A winner needed at least 1/4 (25.0%) of the ballots.',
      '3. Chair',
      'Outcome: 1 elected',
      'Elected: Alex Rivera, in round 2 with 3 of 5 continuing ballots (60.0%). First round: 2 of 5 (40.0%).',
      '5 ballots. Every round is in the results below.',
      '4. Bylaws: Article I',
      'Outcome: Failed',
      'Yes: 50.0% of yes and no votes; needed at least two-thirds (66.7%).',
      'Altogether',
      '1 of 2 proposals passed; 1 failed.',
      '2 candidate contests: 3 of 3 seats filled.',
      'Ballot',
      /^Voting opens: October 20, 2026/,
      'Ballot: Secret ballot',
      '1. Plank 12',
      'Proposal (yes / no / abstain)',
      'Results',
    ]);
  });

  it('marks certified results as certified, with the date', async () => {
    const r = results({ status: 'certified', certifiedAt: '2026-10-22T09:30:00.000Z', certifiedLedgerSeq: 12 });
    const { lines, stamp } = await read(input({ state: 'certified', results: r }));
    expect(stamp[2]).toMatch(/^Certified results · certified October 22, 2026.* 9:30\sAM UTC$/);
    expect(lines).toContainEqual(expect.stringMatching(/^Certified October 22, 2026.* 9:30\sAM UTC by an Election Admin and an Auditor\.$/));
    expect(lines).toContainEqual(expect.stringMatching(/^Status: Certified October 22, 2026.* 9:30\sAM UTC by an Election Admin and an Auditor$/));
    expect(lines.join('\n')).not.toContain('Provisional');
  });

  it('refuses results counted from another definition', async () => {
    const other = { ...definition, title: 'Officers 2027' };
    await expect(electionDocxBytes(input({ definition: other, results: results() }))).rejects.toThrow(/not the one these results were counted from/);
  });
});

describe('the file name', () => {
  const exportedAt = new Date('2026-10-25T12:00:00.000Z');
  it('is the title and the export date, with -ballot for the ballot alone', () => {
    expect(electionDocxFileName(definition, { withResults: true, exportedAt, timeZone: 'UTC' })).toBe('ustp-vote-officers-2026-2026-10-25.docx');
    expect(electionDocxFileName(definition, { withResults: false, exportedAt, timeZone: 'UTC' })).toBe('ustp-vote-officers-2026-ballot-2026-10-25.docx');
    expect(electionDocxFileName({ title: 'Élection: “Générale” 2026!' }, { withResults: true, exportedAt, timeZone: 'UTC' })).toBe(
      'ustp-vote-election-generale-2026-2026-10-25.docx',
    );
    expect(electionDocxFileName({ title: '¿?' }, { withResults: false, exportedAt, timeZone: 'UTC' })).toBe('ustp-vote-election-ballot-2026-10-25.docx');
  });
});
