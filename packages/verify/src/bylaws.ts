import { sha256Hex } from 'ustp-audit';
import {
  applyAmendments,
  proposalContentHash,
  type AmendedBylawsView,
  type BylawsRecord,
  type PublicElection,
  type PublicLedgerEntry,
  type ResultsRecord,
} from 'ustp-domain';
import { fail, info, pass, pending, problemsFinding, type Finding } from './report.js';

/**
 * Bylaws amendments (design §6.6), for an election whose proposals change lines of the bylaws: the amended text the api
 * serves must be exactly the base version with the passed amendments applied, every passed amendment the text the
 * frozen definition commits to, the outcomes those of the results, its hash the one the `results.certified` entry
 * ledgered, and any version published from it must say so.
 */
export function bylawsFindings(input: {
  readonly record: PublicElection;
  readonly results: ResultsRecord | null;
  /** The `results.certified` entry, once in a verified block. */
  readonly certification: PublicLedgerEntry | null;
  /** null: not served (404 or 409). */
  readonly view: AmendedBylawsView | null;
  /** The base version as `GET /v1/bylaws/{version}` serves it. */
  readonly base: BylawsRecord | null;
  /** The version published from the amended text (`view.adoptedAs`), if any. */
  readonly adopted: BylawsRecord | null;
  /** Every public entry that verified, by seq. */
  readonly entries: ReadonlyMap<number, PublicLedgerEntry>;
}): Finding[] {
  const { record, results, certification, view, base, adopted, entries } = input;
  const amending = record.definition.contests.filter((c) => c.proposal?.amendsBylaws);
  if (!amending.length) return [];
  if (results?.status !== 'certified') return [pending('Bylaws amendments', 'the amended bylaws follow once the results are certified')];
  if (!view) return [fail('The amended bylaws are published', 'the results are certified, but the api does not serve the amended bylaws')];
  const findings: Finding[] = [];

  // The base: the version every amending contest names in the frozen definition, with the text that hash commits to.
  const named = amending.map((c) => c.proposal!.amendsBylaws!);
  const baseLabel = 'The base is the bylaws version the definition names';
  if (named.some((b) => b.version !== view.base.version || b.contentHash !== view.base.contentHash)) {
    findings.push(fail(baseLabel, `the definition names ${named.map((b) => b.version).join(', ')}; the api says ${view.base.version}`));
  } else if (!base || sha256Hex(base.text) !== view.base.contentHash) {
    findings.push(fail(baseLabel, `version ${view.base.version} as served does not hash to ${view.base.contentHash}`));
  } else {
    findings.push(pass(baseLabel, `version ${base.version}, SHA-256 ${base.contentHash}`));
  }

  // Outcomes: the results decide which amendments apply.
  const outcomeProblems: string[] = [];
  for (const c of amending) {
    const served = view.contests.find((x) => x.contestId === c.contestId);
    const result = results.bundle.contests.find((x) => x.contestId === c.contestId)?.result;
    const outcome = result?.kind === 'proposal' ? result.outcome : null;
    if (!served) outcomeProblems.push(`"${c.title}" is missing`);
    else if (served.outcome !== outcome) outcomeProblems.push(`"${c.title}": served as ${served.outcome}, the results say ${outcome}`);
  }
  if (view.contests.length !== amending.length) outcomeProblems.push(`the api lists ${view.contests.length} amending contests, the definition ${amending.length}`);
  findings.push(problemsFinding("Each amendment's outcome is the one in the certified results", outcomeProblems));

  // Each passed amendment is exactly the text the definition froze (the v2 content hash covers the changed lines).
  const passed = view.contests.filter((c) => c.outcome === 'passed');
  const textProblems: string[] = [];
  for (const c of passed) {
    const frozen = amending.find((x) => x.contestId === c.contestId)?.proposal;
    const p = c.proposal;
    if (!p?.amendment) textProblems.push(`"${c.title}" passed, but its amendment is not served`);
    else if (!frozen || proposalContentHash(p.title, p.body, p.amendment) !== frozen.contentHash) {
      textProblems.push(`"${c.title}" is not the text the definition commits to`);
    }
  }
  findings.push(problemsFinding('Each passed amendment is the text the definition froze', textProblems, `${passed.length} passed`));

  // The text: the base with exactly the passed amendments applied.
  const textLabel = 'The amended text is the base with the passed amendments applied';
  if (base && !textProblems.length) {
    const applied = passed.length
      ? applyAmendments(base, passed.map((c) => ({ id: `"${c.title}"`, amendment: c.proposal!.amendment! })))
      : ({ ok: true, text: base.text } as const);
    if (!applied.ok) findings.push(fail(textLabel, applied.problems.join('; ')));
    else if (applied.text !== view.text) findings.push(fail(textLabel, 'the served text differs from the one the amendments give'));
    else if (sha256Hex(view.text) !== view.contentHash) findings.push(fail(textLabel, 'the served hash is not the SHA-256 of the text'));
    else findings.push(pass(textLabel, passed.length ? `SHA-256 ${view.contentHash}` : 'no amendment passed, so the bylaws are unchanged'));
  }

  // The ledger fixed that hash at certification.
  const ledgerLabel = 'The results.certified entry records the amended text';
  const ledgered = certification?.entry.payload.bylaws as { contentHash?: unknown; base?: { version?: unknown } } | undefined;
  if (!certification) findings.push(pending(ledgerLabel, 'the results.certified entry is not in a verified ledger block yet'));
  else if (!view.changed) findings.push(ledgered ? fail(ledgerLabel, 'it records amended bylaws, but none passed') : pass(ledgerLabel, 'none: no amendment passed'));
  else if (ledgered?.contentHash !== view.contentHash || ledgered.base?.version !== view.base.version) {
    findings.push(fail(ledgerLabel, `entry ${certification.entry.seq} does not record SHA-256 ${view.contentHash} over version ${view.base.version}`));
  } else findings.push(pass(ledgerLabel, `entry ${certification.entry.seq}`));

  // Adoption: the version published from the text, if any.
  if (!view.adoptedAs) {
    findings.push(info('Adopted as a bylaws version', view.changed ? 'not yet: a Membership Admin publishes it as the next version' : 'nothing to adopt'));
  } else {
    const label = `Version ${view.adoptedAs} is the amended text, adopted from this election`;
    const entry = [...entries.values()].find(
      (e) => e.entry.type === 'bylaws.published' && e.entry.payload.version === view.adoptedAs,
    );
    const adoptedIn = entry?.entry.payload.adoptedIn as { electionId?: unknown } | undefined;
    if (!adopted || adopted.contentHash !== view.contentHash || adopted.amends !== view.base.version) {
      findings.push(fail(label, `version ${view.adoptedAs} as served is not the amended text over version ${view.base.version}`));
    } else if (!entry) {
      findings.push(pending(label, 'its bylaws.published entry is not in a verified ledger block yet'));
    } else if (adoptedIn?.electionId !== record.election.electionId || entry.entry.payload.contentHash !== view.contentHash) {
      findings.push(fail(label, `entry ${entry.entry.seq} does not record the adoption from this election`));
    } else {
      findings.push(pass(label, `entry ${entry.entry.seq}`));
    }
  }
  return findings;
}
