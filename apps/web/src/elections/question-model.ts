import type { ProposalContest, Ratio, Threshold } from 'ustp-tally';
import {
  MIN_K_ANONYMITY,
  contestRecord,
  questionInputSchema,
  rulesText,
  type CandidateRecord,
  type ContestRecord,
  type MemberMatch,
  type ProposalSnapshotRecord,
  type QuestionContest,
  type QuestionInput,
  type Secrecy,
  type UpdateElectionInput,
} from 'ustp-domain';
import { PASS_RULE_PRESETS } from '../election-text.js';
import type { FieldErrors } from '../forms.js';

/**
 * The ballot builder's model of a question (design §6.5): what the Election Admin edits in place, in plain words, and
 * how it maps to a contest and its candidates. A question read from the records and saved unchanged gives exactly the
 * same records, so the definition hash only changes when something on the ballot does.
 */

export const QUESTION_TYPES = ['yes_no', 'choose_one', 'choose_several', 'rank'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  yes_no: 'Yes / No / Abstain',
  choose_one: 'Choose one',
  choose_several: 'Choose several',
  rank: 'Rank in order',
};

/** What each type is for, said under the type picker. */
export const QUESTION_TYPE_HINTS: Record<QuestionType, string> = {
  yes_no: 'A proposal: members vote yes, no or abstain on the text.',
  choose_one: 'Each voter picks one option; the most votes wins.',
  choose_several: 'Each voter ticks more than one option.',
  rank: 'Each voter ranks the options; one winner by instant runoff.',
};

/** The title a new question starts with; it is selected, so typing replaces it. */
export const UNTITLED = 'Untitled question';

type PassRule = ProposalContest['passRule'];

export interface OptionDraft {
  readonly id: string;
  name: string;
  statement: string;
  /** Whether the statement field shows (it always does when there is a statement). */
  statementOpen: boolean;
  /** The member standing, when the option is linked to their account (design §6.5). */
  accountId: string | null;
  /** The name it had when linked: a different name is a different person, so it is no longer linked. */
  linkedName: string | null;
}

export interface QuestionDraft {
  readonly id: string;
  type: QuestionType;
  title: string;
  description: string;
  /** Candidate questions; kept when the type changes to yes / no and back, but not saved meanwhile. */
  options: OptionDraft[];
  /** Yes / no: the proposal text voted on (null until one is written or chosen). */
  proposalSnapshotId: string | null;
  /** Yes / no: the text in the field, captured as a new proposal text when it differs from the attached one. */
  text: string;
  /** Yes / no: index into PASS_RULE_PRESETS, or null for a rule no preset matches (kept as it is). */
  passPreset: number | null;
  customPassRule: PassRule | null;
  /** Yes / no quorum: a share of the roll in percent, and a number of ballots; empty for none. */
  quorumPct: number | string | null;
  minBallots: number | string | null;
  /** The stored share, kept exactly while its percentage is unchanged (1/3 is not 33/100). */
  quorumRatio: Ratio | null;
  /** Choose several: how many win, and how many each voter may tick (any number: as many as there are options). */
  seats: number | string;
  anyNumber: boolean;
  maxSelections: number | string;
  /** Choose one or several: the share of ballots a winner needs, in percent; empty for none. */
  floorPct: number | string | null;
  floorRule: Threshold | null;
  /** Rank in order: how many a voter may rank; empty for all. */
  maxRanks: number | string | null;
  /** Candidate questions: the office the winners take up (design §6.4). */
  positionId: string | null;
}

// --- IDs and lists ---------------------------------------------------------------------------------------------

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A new contest or candidate ID, shaped like Firestore's own (20 letters and digits), from the browser's CSPRNG. */
export function newId(): string {
  let id = '';
  while (id.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(24))) {
      // 248 = 4 × 62: dropping the rest keeps every character equally likely.
      if (byte < 248 && id.length < 20) id += ID_ALPHABET[byte % 62];
    }
  }
  return id;
}

/** `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

// --- making questions and options ------------------------------------------------------------------------------

export function blankOption(id = newId()): OptionDraft {
  return { id, name: '', statement: '', statementOpen: false, accountId: null, linkedName: null };
}

/** A new question of a type, with the usual rules: a simple majority, one winner, any number of choices. */
export function newQuestion(type: QuestionType, id = newId()): QuestionDraft {
  const question: QuestionDraft = {
    id,
    type: 'choose_one',
    title: UNTITLED,
    description: '',
    options: [blankOption()],
    proposalSnapshotId: null,
    text: '',
    passPreset: 0,
    customPassRule: null,
    quorumPct: null,
    minBallots: null,
    quorumRatio: null,
    seats: 1,
    anyNumber: true,
    maxSelections: 2,
    floorPct: null,
    floorRule: null,
    maxRanks: null,
    positionId: null,
  };
  return withType(question, type);
}

/** The question as another type. Options stay in the draft whatever the type, so switching back brings them back. */
export function withType(q: QuestionDraft, type: QuestionType): QuestionDraft {
  if (type === q.type) return q;
  const next = { ...q, type };
  if (type === 'choose_several' && q.type !== 'choose_several') Object.assign(next, { seats: 1, anyNumber: true, maxSelections: 2 });
  if (type !== 'yes_no' && next.options.length === 0) next.options = [blankOption()];
  return next;
}

/** A copy with new IDs, placed by the caller; it keeps the same proposal text, and the same members linked. */
export function copyQuestion(q: QuestionDraft, id = newId()): QuestionDraft {
  return { ...q, id, options: q.options.map((o) => copyOption(o)) };
}

export function copyOption(o: OptionDraft, id = newId()): OptionDraft {
  return { ...o, id };
}

/** The option renamed; renaming a linked option to another name unlinks it (design §6.5). */
export function renameOption(o: OptionDraft, name: string): OptionDraft {
  const unlink = o.accountId !== null && name.trim() !== o.linkedName;
  return { ...o, name, ...(unlink && { accountId: null, linkedName: null }) };
}

/** The option linked to a member's account, under their legal name, which the ballot then shows. */
export function linkOption(o: OptionDraft, member: MemberMatch): OptionDraft {
  return { ...o, name: member.legalName, accountId: member.accountId, linkedName: member.legalName };
}

// --- from the records ------------------------------------------------------------------------------------------

const percent = (r: Ratio | undefined | null) => (r ? Math.round((r.num / r.den) * 100) : null);
const sameRule = (a: PassRule, b: PassRule) =>
  a.base === b.base && a.threshold.comparison === b.threshold.comparison && a.threshold.ratio.num === b.threshold.ratio.num && a.threshold.ratio.den === b.threshold.ratio.den;

/** The question a stored contest is. `candidates` are the election's; `texts` the proposal texts known. */
export function questionFromRecords(contest: ContestRecord, candidates: readonly CandidateRecord[], texts: readonly ProposalSnapshotRecord[]): QuestionDraft {
  const spec = contest.spec;
  const q: QuestionDraft = { ...newQuestion('choose_one', contest.contestId), title: contest.title, description: contest.description, options: [] };
  q.positionId = contest.positionId ?? null;
  if (spec.kind === 'proposal') {
    const preset = PASS_RULE_PRESETS.findIndex((p) => sameRule(p.value, spec.passRule));
    const text = texts.find((t) => t.snapshotId === contest.proposalSnapshotId);
    return {
      ...q,
      type: 'yes_no',
      proposalSnapshotId: contest.proposalSnapshotId,
      text: text && !text.amendment ? text.body : '',
      passPreset: preset >= 0 ? preset : null,
      customPassRule: preset >= 0 ? null : spec.passRule,
      quorumPct: percent(spec.quorum?.rollRatio),
      quorumRatio: spec.quorum?.rollRatio ?? null,
      minBallots: spec.quorum?.minBallots ?? null,
    };
  }
  const byId = new Map(candidates.map((k) => [k.candidateId, k]));
  q.options = spec.candidates.flatMap((id) => {
    const k = byId.get(id);
    return k
      ? [{ id, name: k.name, statement: k.statement ?? '', statementOpen: !!k.statement, accountId: k.accountId, linkedName: k.accountId ? k.name : null }]
      : [];
  });
  if (spec.kind === 'irv') return { ...q, type: 'rank', maxRanks: spec.maxRanks ?? null };
  const floor = { floorPct: percent(spec.supportFloor?.ratio), floorRule: spec.supportFloor ?? null };
  if (spec.seats === 1 && spec.maxSelections === 1) return { ...q, ...floor, type: 'choose_one' };
  const n = spec.candidates.length;
  return {
    ...q,
    ...floor,
    type: 'choose_several',
    seats: spec.seats,
    anyNumber: spec.seats < spec.maxSelections && spec.maxSelections === Math.max(n, 2),
    maxSelections: spec.maxSelections,
  };
}

// --- to the api ------------------------------------------------------------------------------------------------

/** Options with a name; an empty row is a placeholder, not saved. */
export const namedOptions = (q: QuestionDraft) => q.options.filter((o) => o.name.trim() !== '');

const blank = (v: number | string | null) => v === null || v === '';
const toNumber = (v: number | string) => (typeof v === 'number' ? v : v.trim() === '' ? Number.NaN : Number(v));

/** A share in percent as a ratio, keeping the stored ratio while its percentage is unchanged. */
function ratioOf(pct: number | string | null, stored: Ratio | null): Ratio | undefined {
  if (blank(pct)) return undefined;
  const n = toNumber(pct!);
  if (stored && percent(stored) === n) return stored;
  return { num: n, den: 100 };
}

function supportFloor(q: QuestionDraft): Threshold | undefined {
  const ratio = ratioOf(q.floorPct, q.floorRule?.ratio ?? null);
  if (!ratio) return undefined;
  return q.floorRule && ratio === q.floorRule.ratio ? q.floorRule : { ratio, comparison: 'gte' };
}

/** The body of `PUT …/questions/{id}` (without `position`), unchecked: `questionErrors` says what is wrong with it. */
export function questionBody(q: QuestionDraft): QuestionInput {
  const base = { title: q.title, description: q.description };
  const options = namedOptions(q);
  const candidates = options.map((o) => ({
    candidateId: o.id,
    name: o.name,
    ...(o.statement.trim() && { statement: o.statement }),
    ...(o.accountId && { accountId: o.accountId }),
  }));
  let contest: QuestionContest;
  switch (q.type) {
    case 'yes_no': {
      const rollRatio = ratioOf(q.quorumPct, q.quorumRatio);
      const minBallots = blank(q.minBallots) ? undefined : toNumber(q.minBallots!);
      const quorum = rollRatio || minBallots !== undefined ? { ...(minBallots !== undefined && { minBallots }), ...(rollRatio && { rollRatio }) } : undefined;
      const passRule = q.passPreset === null ? q.customPassRule! : PASS_RULE_PRESETS[q.passPreset]!.value;
      return { contest: { kind: 'proposal', ...base, proposalSnapshotId: q.proposalSnapshotId, passRule, ...(quorum && { quorum }) }, candidates: [] };
    }
    case 'choose_one':
    case 'choose_several': {
      const several = q.type === 'choose_several';
      const floor = supportFloor(q);
      contest = {
        kind: 'choose_n',
        ...base,
        seats: several ? toNumber(q.seats) : 1,
        maxSelections: !several ? 1 : q.anyNumber ? Math.max(options.length, 2) : toNumber(q.maxSelections),
        ...(floor && { supportFloor: floor }),
        positionId: q.positionId,
      };
      break;
    }
    case 'rank':
      contest = { kind: 'irv', ...base, ...(!blank(q.maxRanks) && { maxRanks: toNumber(q.maxRanks!) }), positionId: q.positionId };
      break;
  }
  return { contest, candidates };
}

/** The contest a valid question stores (its order aside), for the rules in words and for tests. */
export function questionContest(q: QuestionDraft): ContestRecord {
  const body = questionInputSchema.parse(questionBody(q));
  return contestRecord(q.id, 0, body.contest, body.candidates.map((k) => k.candidateId));
}

/** The rules in the words the ballot uses (design §9), or none while the question cannot be saved. */
export function questionRules(q: QuestionDraft): string[] {
  return Object.keys(questionErrors(q)).length ? [] : rulesText(questionContest(q).spec);
}

// --- what is wrong ---------------------------------------------------------------------------------------------

const WHOLE = 'Enter a whole number, 1 or more.';
const PERCENT = 'Enter a percentage from 1 to 100, or leave it empty.';
const FIELD_MESSAGES: Record<string, string> = {
  'contest.seats': WHOLE,
  'contest.maxSelections': 'Enter a whole number, 2 or more.',
  'contest.maxRanks': 'Enter a whole number, 1 or more, or leave it empty.',
  'contest.quorum.minBallots': 'Enter a whole number of ballots, or leave it empty.',
};

/** Where a message shows: a field of the question, or an option's name or statement field. */
function fieldKey(path: readonly PropertyKey[], options: readonly OptionDraft[]): string {
  if (path[0] === 'candidates' && typeof path[1] === 'number') {
    const option = options[path[1]];
    return `${path[2] === 'statement' ? 'statement' : 'option'}:${option?.id ?? ''}`;
  }
  const field = path[1];
  if (field === 'quorum') return path[2] === 'minBallots' ? 'minBallots' : 'quorumPct';
  if (field === 'supportFloor') return 'floorPct';
  return String(field ?? '_');
}

/**
 * What stops the question being saved, by field (`title`, `seats`, `option:<id>`…), in plain words. A draft that is
 * merely not ready to schedule is not an error here: `questionNotes` says what is still to do.
 */
export function questionErrors(q: QuestionDraft): FieldErrors {
  const errors: FieldErrors = {};
  const options = namedOptions(q);
  const result = questionInputSchema.safeParse(questionBody(q));
  for (const issue of result.success ? [] : result.error.issues) {
    const key = fieldKey(issue.path, options);
    const path = issue.path.join('.');
    errors[key] ??=
      key === 'title'
        ? q.title.trim()
          ? 'Use at most 200 characters.'
          : 'Type the question.'
        : key === 'quorumPct' || key === 'floorPct'
          ? PERCENT
          : key.startsWith('option:') && issue.path[2] === 'accountId'
            ? 'This member is already another option in this question.'
            : key.startsWith('option:')
              ? 'Use at most 200 characters.'
              : key.startsWith('statement:') || key === 'description'
                ? 'Use at most 5,000 characters.'
                : (FIELD_MESSAGES[path] ?? issue.message);
  }
  const pct = (v: number | string | null) => !blank(v) && !(Number.isInteger(toNumber(v!)) && toNumber(v!) >= 1 && toNumber(v!) <= 100);
  if (q.type === 'yes_no' && pct(q.quorumPct)) errors.quorumPct ??= PERCENT;
  if ((q.type === 'choose_one' || q.type === 'choose_several') && pct(q.floorPct)) errors.floorPct ??= PERCENT;
  if (q.type === 'choose_several' && !q.anyNumber && !(toNumber(q.maxSelections) >= 2)) errors.maxSelections ??= FIELD_MESSAGES['contest.maxSelections']!;
  return errors;
}

/** What is still to do before the question can be scheduled (design §6.5), in plain words; empty when ready. */
export function questionNotes(q: QuestionDraft): string[] {
  if (q.type === 'yes_no') return !q.proposalSnapshotId && !q.text.trim() ? ['Write the text members vote on, or use a saved text.'] : [];
  const n = namedOptions(q).length;
  if (n === 0) return ['Add the options voters choose from.'];
  const notes: string[] = [];
  const seats = toNumber(q.seats);
  const most = toNumber(q.maxSelections);
  const ranks = blank(q.maxRanks) ? Number.NaN : toNumber(q.maxRanks!);
  if (q.type === 'choose_several') {
    if (n < 2) notes.push('Add at least 2 options.');
    else if (seats > n) notes.push(`${seats} win, so add at least ${seats} options.`);
    if (!q.anyNumber && most > n && n >= 2) notes.push(`Voters may choose up to ${most}, so add at least ${most} options or lower the limit.`);
  }
  if (q.type === 'rank' && ranks > n) notes.push(`Voters may rank up to ${ranks}, so add at least ${ranks} options or lower the limit.`);
  return notes;
}

/**
 * Whether the text in a yes / no question's field differs from the text attached, so leaving the field captures it as
 * a new proposal text (titled as the question is then). A bylaws amendment is written in the bylaws editor (design
 * §6.6), so its text is never replaced from here.
 */
export function textToCapture(q: QuestionDraft, texts: readonly ProposalSnapshotRecord[]): boolean {
  if (q.type !== 'yes_no' || !q.text.trim()) return false;
  const attached = texts.find((t) => t.snapshotId === q.proposalSnapshotId);
  if (attached?.amendment) return false;
  return !attached || attached.body.trim() !== q.text.trim();
}

// --- the ballot's own details ----------------------------------------------------------------------------------

/** The election's fields as the builder edits them; the times as `datetime-local` values. */
export interface BallotDetails {
  title: string;
  description: string;
  secrecy: Secrecy;
  opensAt: string;
  closesAt: string;
  kAnonymity: number | string;
}

/** What stops the details being saved, by field, in plain words. */
export function detailsErrors(d: BallotDetails): FieldErrors {
  const errors: FieldErrors = {};
  const title = d.title.trim();
  if (!title) errors.title = 'Give the ballot a title.';
  else if (title.length > 200) errors.title = 'Use at most 200 characters.';
  if (d.description.trim().length > 5000) errors.description = 'Use at most 5,000 characters.';
  const opens = Date.parse(d.opensAt);
  const closes = Date.parse(d.closesAt);
  if (Number.isNaN(opens)) errors.opensAt = 'Enter the date and time voting opens.';
  if (Number.isNaN(closes)) errors.closesAt = 'Enter the date and time voting closes.';
  else if (!Number.isNaN(opens) && closes <= opens) errors.closesAt = 'Voting must close after it opens.';
  const k = toNumber(d.kAnonymity);
  if (d.secrecy === 'secret' && !(Number.isInteger(k) && k >= MIN_K_ANONYMITY && k <= 1000)) {
    errors.kAnonymity = `Enter a whole number from ${MIN_K_ANONYMITY} to 1,000.`;
  }
  return errors;
}

/** The body of `PATCH /v1/admin/elections/{id}` for valid details. */
export function detailsBody(d: BallotDetails): UpdateElectionInput {
  return {
    title: d.title,
    description: d.description,
    secrecy: d.secrecy,
    opensAt: new Date(d.opensAt).toISOString(),
    closesAt: new Date(d.closesAt).toISOString(),
    kAnonymity: toNumber(d.kAnonymity),
  };
}
