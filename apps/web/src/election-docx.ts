import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  amendmentText,
  definitionHash,
  proposalContentHash,
  resultsSynopsis,
  splitLines,
  type BylawsAmendment,
  type ContestOutcome,
  type ContestSynopsis,
  type ElectionDefinition,
  type ElectionState,
  type ResultsRecord,
  type ResultsSynopsis,
} from 'ustp-domain';
import { INK, LETTER_PAGE, STAMP_PARAGRAPH_STYLE, stampLine, textParagraph } from './bylaws-docx.js';
import { electionSlug, fileDate, KIND_LABELS, rulesText, tieBreakText } from './election-text.js';
import {
  ballotsText,
  chooseNText,
  irvText,
  outcomeLabel,
  quorumText,
  share,
  synopsisFacts,
  tallyText,
  yesShareText,
} from './elections/synopsis-text.js';

/**
 * An election as a Word document (design §9), so it can be opened in Word or Google Docs (which opens .docx itself):
 * the ballot, and the results once published. Made in the browser from what the page already shows (the frozen
 * definition, the proposal texts the viewer may read, the signed results), so it holds nothing private: no roll and
 * no voters. Like the CSV it is an unsigned copy; its stamp gives the hashes and where to check them.
 */

type Contest = ElectionDefinition['contests'][number];

/** A proposal's text as the ballot or the admin view gives it. */
export interface ProposalText {
  readonly snapshotId: string;
  readonly title: string;
  readonly body: string;
  readonly contentHash: string;
  readonly amendment?: BylawsAmendment | null;
}

export interface ElectionDocxInput {
  /** The definition frozen at scheduling, or a draft's as it stands. */
  readonly definition: ElectionDefinition;
  readonly state: ElectionState;
  /**
   * The proposal texts this viewer may read. The public record has only their titles and hashes, so a proposal
   * without its text here is named with its hash instead.
   */
  readonly proposals: readonly ProposalText[];
  /** The published results, for a ballot-and-results document; null for the ballot alone. */
  readonly results: ResultsRecord | null;
  /** Where the web app is served, e.g. `https://vote.example.org`; the links start with it. */
  readonly origin: string;
  readonly exportedAt: Date;
  /** IANA time zone for the times in the text; the browser's when left out. */
  readonly timeZone?: string;
}

/** Word's built-in "Hyperlink" character style. */
const LINK_STYLE = 'Hyperlink';
const CONTENT_WIDTH = LETTER_PAGE.size.width - LETTER_PAGE.margin.left - LETTER_PAGE.margin.right;

const PROPOSAL_OUTCOME = { passed: 'Passed', failed: 'Failed', no_quorum: 'No quorum' } as const;

function clock(timeZone: string | undefined) {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  // en-CA writes dates as YYYY-MM-DD.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return { when: (at: string | Date) => when.format(new Date(at)), day: (at: string | Date) => day.format(new Date(at)) };
}

const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
  new Paragraph({ heading: level, keepNext: true, children: [new TextRun(text)] });

/** A paragraph that starts with a bold label: "Results hash: …". */
const labelled = (label: string, ...rest: (TextRun | ExternalHyperlink)[]) =>
  new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), ...rest] });

const link = (url: string) => new ExternalHyperlink({ link: url, children: [new TextRun({ text: url, style: LINK_STYLE })] });

/** Multi-line text (descriptions, statements, proposal bodies), one paragraph per line. */
const lines = (text: string, indent = 0) =>
  text.trim() ? splitLines(text.trimEnd()).map((line) => textParagraph(line, indent ? { indent: { left: indent } } : {})) : [];

const small = (text: string) => new Paragraph({ children: [new TextRun({ text, size: 18, color: INK })] });

/** A table with a repeating header row; the first column holds names, the others numbers (right-aligned). */
function table(head: readonly string[], rows: readonly (readonly (string | number)[])[]): Table {
  const first = 3600;
  const other = head.length > 1 ? Math.min(1800, Math.floor((CONTENT_WIDTH - first) / (head.length - 1))) : 0;
  const widths = head.map((_, i) => (i === 0 ? first : other));
  // Google Docs lays tables out from the grid alone, so every width is explicit and in twips.
  const cell = (value: string | number, i: number, bold: boolean) =>
    new TableCell({
      width: { size: widths[i]!, type: WidthType.DXA },
      children: [
        new Paragraph({
          alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
          spacing: { before: 20, after: 20 },
          children: [new TextRun({ text: String(value), bold })],
        }),
      ],
    });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: head.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, i, false)) })),
    ],
  });
}

// --- The ballot ------------------------------------------------------------------------------------------------------

function candidateBlocks(c: Contest): Paragraph[] {
  if (!c.candidates.length) return [new Paragraph('No candidates yet.')];
  return [
    heading('Candidates', HeadingLevel.HEADING_3),
    ...c.candidates.flatMap((k) => [
      new Paragraph({ keepNext: !!k.statement?.trim(), children: [new TextRun({ text: k.name, bold: true })] }),
      ...lines(k.statement ?? '', 360),
    ]),
  ];
}

function proposalBlocks(c: Contest, texts: ReadonlyMap<string, ProposalText>): Paragraph[] {
  const ref = c.proposal;
  if (!ref) return [new Paragraph('No text attached yet.')];
  const text = texts.get(ref.snapshotId);
  if (!text) {
    return [
      heading(`Text: ${ref.title}`, HeadingLevel.HEADING_3),
      ...(ref.amendsBylaws ? [new Paragraph(`Amends bylaws version ${ref.amendsBylaws.version}.`)] : []),
      new Paragraph('The full text is on the ballot, which voters on the roll can open.'),
      small(`Content hash ${ref.contentHash}`),
    ];
  }
  // The same check the ballot page makes (design §7.5): the text is the one the definition commits to.
  if (proposalContentHash(text.title, text.body, text.amendment) !== ref.contentHash) {
    throw new Error(`the text of “${c.title}” is not the one the ballot commits to`);
  }
  const changes = text.amendment
    ? [
        heading(`Changes to the bylaws, version ${text.amendment.base.version}`, HeadingLevel.HEADING_3),
        ...splitLines(amendmentText(text.amendment)).map(
          (line) => new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: line, font: 'Courier New', size: 20 })] }),
        ),
        heading('Reasons given', HeadingLevel.HEADING_3),
      ]
    : [heading(`Full text: ${text.title}`, HeadingLevel.HEADING_3)];
  return [...changes, ...lines(text.body), small(`Content hash ${text.contentHash}`)];
}

function contestBlocks(c: Contest, n: number, texts: ReadonlyMap<string, ProposalText>): Paragraph[] {
  return [
    heading(`${n}. ${c.title}`, HeadingLevel.HEADING_2),
    new Paragraph({ children: [new TextRun({ text: KIND_LABELS[c.spec.kind], italics: true })] }),
    ...lines(c.description),
    ...rulesText(c.spec).map((rule) => new Paragraph({ text: rule, bullet: { level: 0 } })),
    ...(c.spec.kind === 'proposal' ? proposalBlocks(c, texts) : candidateBlocks(c)),
  ];
}

// --- The results -----------------------------------------------------------------------------------------------------

function outcomeBlocks(c: Contest, n: number, outcome: ContestOutcome): (Paragraph | Table)[] {
  const name = (id: string) => c.candidates.find((k) => k.candidateId === id)?.name ?? id;
  const names = (ids: readonly string[]) => ids.map(name).join(', ') || 'none';
  const r = outcome.result;
  const title = heading(`${n}. ${c.title}`, HeadingLevel.HEADING_2);
  if (r.kind === 'proposal') {
    return [
      title,
      labelled('Outcome', new TextRun({ text: PROPOSAL_OUTCOME[r.outcome], bold: true })),
      table(['Choice', 'Votes'], [['Yes', r.counts.yes], ['No', r.counts.no], ['Abstain', r.counts.abstain]]),
      new Paragraph(
        `${r.ballots} ballots${r.invalid ? `, ${r.invalid} invalid` : ''}.` +
          (r.quorum.required > 0 ? ` Quorum: ${r.ballots} of ${r.quorum.required} needed (${r.quorum.met ? 'met' : 'not met'}).` : ''),
      ),
    ];
  }
  const counted = new Paragraph(
    `${r.ballots} ballots (${r.blank} blank)${r.invalid ? `, ${r.invalid} invalid` : ''}. ` +
      `Tie-break order: ${names(outcome.tieBreakOrder ?? [])}.`,
  );
  const ties = r.tieBreaks.map((t) => new Paragraph(tieBreakText(t, names)));
  if (r.kind === 'choose_n') {
    const floor = 'supportFloor' in c.spec && !!c.spec.supportFloor;
    const vacant = r.vacantSeats ? ` · ${r.vacantSeats} ${r.vacantSeats === 1 ? 'seat' : 'seats'} left vacant` : '';
    return [
      title,
      labelled('Elected', new TextRun({ text: names(r.winners), bold: true }), new TextRun(vacant)),
      table(
        ['Candidate', 'Votes', 'Elected', ...(floor ? ['Support floor'] : [])],
        r.ranking.map((k) => [
          name(k.candidateId),
          k.votes,
          r.winners.includes(k.candidateId) ? 'yes' : 'no',
          ...(floor ? [k.meetsFloor ? 'met' : 'not met'] : []),
        ]),
      ),
      ...ties,
      counted,
    ];
  }
  // Ranked choice: one column per round, as on the results page; a dash once a candidate is out.
  return [
    title,
    labelled('Elected', new TextRun({ text: r.winner ? name(r.winner) : 'nobody (no ranked ballots)', bold: true })),
    ...(r.rounds.length
      ? [
          table(
            ['Candidate', ...r.rounds.map((round) => `Round ${round.round}`)],
            [
              ...c.candidates.map((k) => [k.name, ...r.rounds.map((round) => round.counts[k.candidateId] ?? '—')]),
              ['Continuing ballots', ...r.rounds.map((round) => round.continuingBallots)],
              ['Exhausted', ...r.rounds.map((round) => round.exhausted)],
            ],
          ),
          ...r.rounds.map(
            (round) =>
              new Paragraph(
                `Round ${round.round}: ${
                  round.elected ? `${name(round.elected)} elected` : round.eliminated ? `${name(round.eliminated)} eliminated` : 'no change'
                }.`,
              ),
          ),
        ]
      : []),
    ...ties,
    counted,
  ];
}

// --- The synopsis ----------------------------------------------------------------------------------------------------

/** One contest in brief, as on the results page's Synopsis tab: its outcome, counts and shares. */
function synopsisContestBlocks(c: ContestSynopsis): (Paragraph | Table)[] {
  const head = [
    heading(`${c.number}. ${c.title}`, HeadingLevel.HEADING_2),
    labelled('Outcome', new TextRun({ text: outcomeLabel(c).text, bold: true })),
  ];
  switch (c.kind) {
    case 'proposal':
      return [
        ...head,
        table(
          ['Choice', 'Votes', 'Share'],
          [
            ['Yes', c.yes.part, share(c.yes)],
            ['No', c.no.part, share(c.no)],
            ['Abstain', c.abstain.part, share(c.abstain)],
          ],
        ),
        new Paragraph(yesShareText(c)),
        new Paragraph([`${ballotsText(c)}.`, quorumText(c)].filter(Boolean).join(' ')),
      ];
    case 'choose_n':
      return [
        ...head,
        table(
          ['Candidate', 'Votes', 'Share', 'Result'],
          [
            ...c.candidates.map((k) => [k.name, k.votes.part, share(k.votes), k.elected ? 'Elected' : 'Not elected']),
            ...(c.blank.part ? [['Blank (no choice)', c.blank.part, share(c.blank), '']] : []),
          ],
        ),
        new Paragraph(chooseNText(c)),
      ];
    case 'irv':
      return [
        ...head,
        new Paragraph(irvText(c)),
        new Paragraph(`${ballotsText(c)}.${c.rounds > 1 ? ' Every round is in the results below.' : ''}`),
      ];
  }
}

/** The results in brief, first in the document, as the party's own results documents open. */
function synopsisBlocks(s: ResultsSynopsis, when: (at: string) => string): (Paragraph | Table)[] {
  return [
    heading('Synopsis', HeadingLevel.HEADING_1),
    ...synopsisFacts(s, when).map((f) => labelled(f.label, new TextRun({ text: f.value, bold: f.label === 'Status' }))),
    ...s.contests.flatMap(synopsisContestBlocks),
    heading('Altogether', HeadingLevel.HEADING_2),
    ...tallyText(s.tally).map((line) => new Paragraph(line)),
  ];
}

// --- The document ----------------------------------------------------------------------------------------------------

export function electionDocument(input: ElectionDocxInput): Document {
  const { definition: def, results, origin } = input;
  const hash = definitionHash(def);
  if (results && (results.electionId !== def.electionId || results.bundle.definitionHash !== hash)) {
    throw new Error('the definition is not the one these results were counted from');
  }
  const { when, day } = clock(input.timeZone);
  const what = results ? 'Ballot and results' : 'Ballot';
  const draft = input.state === 'draft';
  const id = encodeURIComponent(def.electionId);
  const resultsPage = `${origin}/results/${id}`;
  const texts = new Map(input.proposals.map((p) => [p.snapshotId, p]));

  const status = results
    ? results.status === 'certified'
      ? `Certified results${results.certifiedAt ? ` · certified ${when(results.certifiedAt)}` : ''}`
      : 'Provisional results · not yet certified'
    : draft
      ? 'Draft · not final: the ballot can change until the election is scheduled'
      : input.state === 'cancelled'
        ? 'Cancelled · this election has no results'
        : 'The ballot as frozen at scheduling';
  const stamp = [
    stampLine('UNITED STATES TRANSHUMANIST PARTY', { bold: true, size: 28 }),
    stampLine(`${what} · ${def.title}`, { bold: true }),
    stampLine(status),
    stampLine(`${draft ? 'Definition hash as it stands' : 'Definition hash'}: ${hash}`, { size: 16 }),
    ...(results ? [stampLine(`Results hash: ${results.resultsHash}`, { size: 16 })] : []),
    stampLine(
      results
        ? `Exported ${day(input.exportedAt)}. An unsigned copy: the signed results at ${resultsPage} are the record.`
        : `Exported ${day(input.exportedAt)} from ${origin}.`,
      { size: 16 },
    ),
    new Paragraph({ style: STAMP_PARAGRAPH_STYLE.id, children: [] }),
  ];

  const title = new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(def.title)] });
  const overview = [
    labelled('Voting opens', new TextRun(when(def.opensAt))),
    labelled('Voting closes', new TextRun(when(def.closesAt))),
    labelled(
      'Ballot',
      new TextRun(def.secrecy === 'secret' ? 'Secret ballot' : 'Roll-call: how each voter votes is published with their name'),
    ),
    ...lines(def.description),
  ];

  const contests = def.contests.length ? def.contests.flatMap((c, i) => contestBlocks(c, i + 1, texts)) : [new Paragraph('No contests yet.')];
  // With results, the synopsis comes first and the ballot's overview moves under its heading.
  const ballotHeading = heading('Ballot', HeadingLevel.HEADING_1);
  const opening = results
    ? [title, ...synopsisBlocks(resultsSynopsis({ results, definition: def }), when), ballotHeading, ...overview]
    : [title, ...overview, ballotHeading];

  const counted = results
    ? [
        heading('Results', HeadingLevel.HEADING_1),
        new Paragraph({
          children: [
            new TextRun({
              text:
                results.status === 'certified'
                  ? `Certified${results.certifiedAt ? ` ${when(results.certifiedAt)}` : ''} by an Election Admin and an Auditor.`
                  : 'Provisional: these results are signed and in the audit ledger, but not yet certified.',
              bold: true,
            }),
          ],
        }),
        new Paragraph(
          `${results.bundle.participationCount} of ${results.bundle.roll.count} on the roll voted. Counted ${when(results.computedAt)}.`,
        ),
        ...results.bundle.contests.flatMap((outcome) => {
          const i = def.contests.findIndex((c) => c.contestId === outcome.contestId);
          if (i < 0) throw new Error(`the definition has no contest ${outcome.contestId}`);
          return outcomeBlocks(def.contests[i]!, i + 1, outcome);
        }),
        heading('Checking these results', HeadingLevel.HEADING_2),
        new Paragraph(
          'This document is an unsigned copy. The record is the signed results bundle: the results page checks its hash ' +
            'and signature, and re-counts the published ballots, in the browser.',
        ),
        labelled('Results page', link(resultsPage)),
        labelled('Signed results', link(`${origin}/v1/public/elections/${id}/results`)),
        labelled('Results hash', new TextRun(results.resultsHash)),
        labelled('Definition hash', new TextRun(hash)),
        labelled('Revealed tie-break seed', new TextRun(results.bundle.tieBreakSeed)),
      ]
    : [];

  return new Document({
    creator: 'USTP Vote',
    title: `${def.title}: ${what.toLowerCase()}`,
    subject: status,
    keywords: [`election ${def.electionId}`, `definition sha256:${hash}`, ...(results ? [`results sha256:${results.resultsHash}`] : [])].join(
      '; ',
    ),
    styles: {
      default: {
        document: { run: { language: { value: 'en-US' } }, paragraph: { spacing: { after: 80 } } },
        heading1: { paragraph: { spacing: { before: 360, after: 120 } } },
        heading2: { paragraph: { spacing: { before: 240, after: 80 } } },
        heading3: { paragraph: { spacing: { before: 160, after: 60 } } },
      },
      paragraphStyles: [STAMP_PARAGRAPH_STYLE],
    },
    sections: [
      {
        properties: { page: LETTER_PAGE },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${def.title} · ${what.toLowerCase()} · exported ${day(input.exportedAt)}`, size: 16, color: INK }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    size: 16,
                    color: INK,
                    children: [`${draft ? 'Draft · ' : ''}page `, PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                  }),
                ],
              }),
            ],
          }),
        },
        children: [...stamp, ...opening, ...contests, ...counted],
      },
    ],
  });
}

export async function electionDocxBytes(input: ElectionDocxInput): Promise<ArrayBuffer> {
  return Packer.toArrayBuffer(electionDocument(input));
}

/** `ustp-vote-2026-officer-election-2026-10-25.docx`, with `-ballot` before the date for the ballot alone. */
export function electionDocxFileName(
  definition: Pick<ElectionDefinition, 'title'>,
  options: { readonly withResults: boolean; readonly exportedAt: Date; readonly timeZone?: string },
): string {
  const kind = options.withResults ? '' : '-ballot';
  return `ustp-vote-${electionSlug(definition.title)}${kind}-${fileDate(options.exportedAt, options.timeZone)}.docx`;
}
