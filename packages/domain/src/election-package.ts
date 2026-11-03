import type { ContestSpec } from 'ustp-tally';
import { z } from 'zod';
import { hex32Schema } from './api.js';
import { contestInputSchema, candidateInputSchema, createElectionSchema, proposalInputSchema, type ContestInput, type ProposalInput } from './election-api.js';
import { proposalContentHash, type CandidateRecord, type ContestRecord, type ElectionRecord, type ProposalSnapshotRecord } from './elections.js';

/**
 * Election packages (`ustp.election` v1, design §6.7): a whole draft election as one JSON file, its contests,
 * candidates and proposal texts included, to import as a new draft and to export from any election.
 */

export const ELECTION_PACKAGE_FORMAT = 'ustp.election';
export const MAX_PACKAGE_CONTESTS = 100;
export const MAX_PACKAGE_CANDIDATES = 100;
/** An import writes everything in one Firestore transaction, which takes at most 500 writes. */
export const MAX_PACKAGE_DOCUMENTS = 450;
/** The longest voting window, and the latest relative opening, a package may give: a year. */
const MAX_WINDOW_SECONDS = 366 * 86_400;

/** The `ustp-tally` pattern for contest and candidate IDs. */
const packageId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'use up to 64 letters, digits, - and _, starting with a letter or digit');

/** Absolute (`opensAt`, `closesAt`) or relative to the import (`opensInSeconds`, `votingSeconds`), for rehearsals. */
const windowSchema = z
  .strictObject({
    opensAt: createElectionSchema.shape.opensAt.optional(),
    closesAt: createElectionSchema.shape.closesAt.optional(),
    opensInSeconds: z.number().int().min(0).max(MAX_WINDOW_SECONDS).optional(),
    votingSeconds: z.number().int().min(60, 'vote for at least a minute').max(MAX_WINDOW_SECONDS).optional(),
  })
  .superRefine((w, ctx) => {
    const absolute = w.opensAt !== undefined || w.closesAt !== undefined;
    const relative = w.opensInSeconds !== undefined || w.votingSeconds !== undefined;
    if (absolute === relative) {
      ctx.addIssue({ code: 'custom', message: 'give either opensAt and closesAt, or opensInSeconds and votingSeconds' });
    } else if (absolute) {
      if (!w.opensAt) ctx.addIssue({ code: 'custom', path: ['opensAt'], message: 'give opensAt with closesAt' });
      else if (!w.closesAt) ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'give closesAt with opensAt' });
      else if (Date.parse(w.closesAt) <= Date.parse(w.opensAt)) {
        ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'voting must close after it opens' });
      }
    } else if (w.opensInSeconds === undefined) {
      ctx.addIssue({ code: 'custom', path: ['opensInSeconds'], message: 'give opensInSeconds with votingSeconds' });
    } else if (w.votingSeconds === undefined) {
      ctx.addIssue({ code: 'custom', path: ['votingSeconds'], message: 'give votingSeconds with opensInSeconds' });
    }
  });

/**
 * What a proposal contest votes on: an existing proposal text (`snapshotId`), or the text itself, captured at import.
 * `title` defaults to the contest's; `contentHash`, when given (an export gives it), must be the text's.
 */
const packageProposalSchema = z
  .strictObject({
    snapshotId: z.string().min(1).max(64).optional(),
    title: proposalInputSchema.shape.title.optional(),
    body: proposalInputSchema.shape.body.optional(),
    source: proposalInputSchema.shape.source,
    amendment: proposalInputSchema.shape.amendment,
    contentHash: hex32Schema.optional(),
  })
  .superRefine((p, ctx) => {
    const inline = p.title !== undefined || p.body !== undefined || p.source !== undefined || p.amendment !== undefined || p.contentHash !== undefined;
    if (p.snapshotId !== undefined && inline) {
      ctx.addIssue({ code: 'custom', message: 'give either snapshotId (a proposal text already captured) or the text, not both' });
    } else if (p.snapshotId === undefined && p.body === undefined) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'enter the proposal text, or give the snapshotId of one already captured' });
    }
  });

/** A candidate: just a name, or the full form; `id` becomes the candidate ID (otherwise a random one). */
const packageCandidateSchema = z.union([
  candidateInputSchema.shape.name.transform((name) => ({ name })),
  candidateInputSchema.extend({ id: packageId.optional() }),
]);
const candidates = z.array(packageCandidateSchema).max(MAX_PACKAGE_CANDIDATES).default([]);

const [proposalContest, chooseNContest, irvContest] = contestInputSchema.options;
/** A contest as `POST …/contests` takes it, with an optional `id` (the contest ID) and its proposal or candidates. */
const packageContestSchema = z.discriminatedUnion('kind', [
  proposalContest.omit({ proposalSnapshotId: true }).extend({ id: packageId.optional(), proposal: packageProposalSchema }),
  chooseNContest.extend({ id: packageId.optional(), candidates }),
  irvContest.extend({ id: packageId.optional(), candidates }),
]);

export const electionPackageSchema = z
  .strictObject({
    format: z.literal(ELECTION_PACKAGE_FORMAT),
    v: z.literal(1),
    title: createElectionSchema.shape.title,
    description: createElectionSchema.shape.description,
    secrecy: createElectionSchema.shape.secrecy,
    kAnonymity: createElectionSchema.shape.kAnonymity,
    window: windowSchema,
    contests: z.array(packageContestSchema).max(MAX_PACKAGE_CONTESTS).default([]),
    /** Where an export came from; informational, and ignored on import. */
    exportedFrom: z
      .strictObject({ electionId: z.string().min(1).max(64), definitionHash: hex32Schema, exportedAt: z.string().max(64) })
      .optional(),
  })
  .superRefine((pkg, ctx) => {
    const contestIds = new Set<string>();
    const candidateIds = new Set<string>();
    let documents = 1;
    pkg.contests.forEach((c, i) => {
      documents += 1;
      if (c.id !== undefined) {
        if (contestIds.has(c.id)) ctx.addIssue({ code: 'custom', path: ['contests', i, 'id'], message: `another contest is ${c.id}` });
        contestIds.add(c.id);
      }
      if (c.kind === 'proposal') {
        const p = c.proposal;
        if (p.body === undefined) return;
        documents += 1;
        if (p.contentHash !== undefined && p.contentHash !== proposalContentHash(p.title ?? c.title, p.body, p.amendment)) {
          ctx.addIssue({
            code: 'custom',
            path: ['contests', i, 'proposal', 'contentHash'],
            message: 'the proposal text does not hash to this; the text was changed after export, or the hash is wrong',
          });
        }
        return;
      }
      c.candidates.forEach((k, j) => {
        documents += 1;
        if (!('id' in k) || k.id === undefined) return;
        if (candidateIds.has(k.id)) {
          ctx.addIssue({ code: 'custom', path: ['contests', i, 'candidates', j, 'id'], message: `another candidate is ${k.id}` });
        }
        candidateIds.add(k.id);
      });
    });
    if (documents > MAX_PACKAGE_DOCUMENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['contests'],
        message: `the election, its contests, candidates and new proposal texts come to ${documents} records; at most ${MAX_PACKAGE_DOCUMENTS} import at once`,
      });
    }
  });

/** A package as parsed (defaults filled in, candidates as objects). */
export type ElectionPackage = z.output<typeof electionPackageSchema>;
/** A package as written in a file. */
export type ElectionPackageInput = z.input<typeof electionPackageSchema>;
export type PackageContest = ElectionPackage['contests'][number];

/** The voting window a package gives; a relative one counts from `now`, the api's clock when importing. */
export function packageWindow(window: ElectionPackage['window'], now: Date): { opensAt: string; closesAt: string } {
  if (window.opensAt && window.closesAt) return { opensAt: window.opensAt, closesAt: window.closesAt };
  const opens = now.getTime() + (window.opensInSeconds ?? 0) * 1000;
  return { opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + (window.votingSeconds ?? 0) * 1000).toISOString() };
}

/** What a proposal contest votes on: a proposal text already captured, or one to capture with this content hash. */
export type PackageProposal =
  | { readonly snapshotId: string }
  | { readonly input: ProposalInput; readonly contentHash: string };

/** Each contest's proposal, by contest index; null for candidate contests. */
export function packageProposals(pkg: ElectionPackage): (PackageProposal | null)[] {
  return pkg.contests.map((c) => {
    if (c.kind !== 'proposal') return null;
    const p = c.proposal;
    if (p.snapshotId !== undefined) return { snapshotId: p.snapshotId };
    const input: ProposalInput = {
      title: p.title ?? c.title,
      body: p.body!,
      ...(p.source && { source: p.source }),
      ...(p.amendment && { amendment: p.amendment }),
    };
    return { input, contentHash: proposalContentHash(input.title, input.body, input.amendment) };
  });
}

/**
 * The records an import writes: the draft election, its contests in package order and its candidates. Contests and
 * candidates keep the package's `id`s, and get `newId()` otherwise; `snapshotIds` names each proposal contest's text.
 */
export function packageRecords(
  pkg: ElectionPackage,
  options: {
    readonly electionId: string;
    readonly createdBy: string;
    readonly now: Date;
    readonly newId: () => string;
    /** By contest index; null for candidate contests. */
    readonly snapshotIds: readonly (string | null)[];
  },
): { election: ElectionRecord; contests: ContestRecord[]; candidates: CandidateRecord[] } {
  const at = options.now.toISOString();
  const election: ElectionRecord = {
    electionId: options.electionId,
    title: pkg.title,
    description: pkg.description,
    secrecy: pkg.secrecy,
    ...packageWindow(pkg.window, options.now),
    kAnonymity: pkg.kAnonymity,
    state: 'draft',
    createdBy: options.createdBy,
    createdAt: at,
    updatedAt: at,
    definitionHash: null,
    rollSnapshotId: null,
    tieBreakSeedCommitment: null,
    tieBreakSeedRef: null,
    scheduledAt: null,
    cancelledAt: null,
    poolKeyVersion: null,
    openedAt: null,
    closedAt: null,
    sealedAt: null,
    certifiedAt: null,
    poolKeyDestroyedAt: null,
  };
  return { election, ...packageContestRecords(pkg, { firstOrder: 1, newId: options.newId, snapshotIds: options.snapshotIds }) };
}

/**
 * A package's contests and candidates as stored, in package order numbered from `firstOrder`: a new draft's whole
 * ballot, or questions added after a draft's own (design §6.7). They keep the package's `id`s but for those in `taken`,
 * the IDs the draft already uses, which get `newId()` as those without one do.
 */
export function packageContestRecords(
  pkg: ElectionPackage,
  options: {
    readonly firstOrder: number;
    readonly newId: () => string;
    /** By contest index; null for candidate contests. */
    readonly snapshotIds: readonly (string | null)[];
    readonly taken?: { readonly contests: ReadonlySet<string>; readonly candidates: ReadonlySet<string> };
  },
): { contests: ContestRecord[]; candidates: CandidateRecord[] } {
  const free = (id: string | undefined, used: ReadonlySet<string> | undefined) => (id !== undefined && !used?.has(id) ? id : options.newId());
  const contests: ContestRecord[] = [];
  const candidates: CandidateRecord[] = [];
  pkg.contests.forEach((c, i) => {
    const contestId = free(c.id, options.taken?.contests);
    const order = options.firstOrder + i;
    if (c.kind === 'proposal') {
      const { id: _id, proposal: _proposal, ...rules } = c;
      const snapshotId = options.snapshotIds[i];
      if (!snapshotId) throw new Error(`contest ${i + 1} has no proposal text`);
      contests.push(contestRecord(contestId, order, { ...rules, proposalSnapshotId: snapshotId }, []));
      return;
    }
    const { id: _id, candidates: listed, ...rules } = c;
    const records = listed.map((k) => ({
      candidateId: free(('id' in k && k.id) || undefined, options.taken?.candidates),
      contestId,
      name: k.name,
      statement: ('statement' in k && k.statement) || null,
      accountId: ('accountId' in k && k.accountId) || null,
    }));
    candidates.push(...records);
    contests.push(contestRecord(contestId, order, rules, records.map((k) => k.candidateId)));
  });
  return { contests, candidates };
}

/**
 * An election as a package: its window as dates, contests in ballot order with their IDs, candidates in the order the
 * contest lists them, and each proposal's text with its content hash, so importing it elsewhere captures the same text.
 */
export function electionPackageFrom(
  records: {
    readonly election: ElectionRecord;
    readonly contests: readonly ContestRecord[];
    readonly candidates: readonly CandidateRecord[];
    readonly proposals: readonly ProposalSnapshotRecord[];
  },
  exportedFrom?: ElectionPackage['exportedFrom'],
): ElectionPackage {
  const { election } = records;
  const contests = [...records.contests].sort((a, b) => a.order - b.order).map((c): PackageContest => {
    const common = { id: c.contestId, title: c.title, description: c.description };
    const spec = c.spec;
    if (spec.kind === 'proposal') {
      const p = records.proposals.find((x) => x.snapshotId === c.proposalSnapshotId);
      return {
        ...common,
        kind: 'proposal',
        passRule: spec.passRule,
        ...(spec.quorum && { quorum: spec.quorum }),
        proposal: p
          ? {
              title: p.title,
              body: p.body,
              ...(p.source && { source: p.source }),
              ...(p.amendment && { amendment: p.amendment }),
              contentHash: p.contentHash,
            }
          : { snapshotId: c.proposalSnapshotId ?? '' },
      };
    }
    const listed = spec.candidates
      .map((id) => records.candidates.find((k) => k.candidateId === id && k.contestId === c.contestId))
      .filter((k): k is CandidateRecord => !!k)
      .map((k) => ({ id: k.candidateId, name: k.name, ...(k.statement && { statement: k.statement }), ...(k.accountId && { accountId: k.accountId }) }));
    const office = c.positionId ? { positionId: c.positionId } : {};
    return spec.kind === 'choose_n'
      ? {
          ...common,
          kind: 'choose_n',
          seats: spec.seats,
          maxSelections: spec.maxSelections,
          ...(spec.supportFloor && { supportFloor: spec.supportFloor }),
          ...office,
          candidates: listed,
        }
      : { ...common, kind: 'irv', ...(spec.maxRanks !== undefined && { maxRanks: spec.maxRanks }), ...office, candidates: listed };
  });
  return {
    format: ELECTION_PACKAGE_FORMAT,
    v: 1,
    title: election.title,
    description: election.description,
    secrecy: election.secrecy,
    kAnonymity: election.kAnonymity,
    window: { opensAt: election.opensAt, closesAt: election.closesAt },
    contests,
    ...(exportedFrom && { exportedFrom }),
  };
}

/** A contest's rules, where a proposal may still wait for its text (the ballot builder, design §6.5). */
type ContestRules = ContestInput | (Omit<Extract<ContestInput, { kind: 'proposal' }>, 'proposalSnapshotId'> & { readonly proposalSnapshotId: string | null });

/** The stored contest, with a tally spec whose id is the contest id. */
export function contestRecord(contestId: string, order: number, input: ContestRules, candidateIds: readonly string[]): ContestRecord {
  let spec: ContestSpec;
  switch (input.kind) {
    case 'proposal':
      spec = { kind: 'proposal', id: contestId, passRule: input.passRule, ...(input.quorum && { quorum: input.quorum }) };
      break;
    case 'choose_n':
      spec = {
        kind: 'choose_n',
        id: contestId,
        candidates: [...candidateIds],
        seats: input.seats,
        maxSelections: input.maxSelections,
        ...(input.supportFloor && { supportFloor: input.supportFloor }),
      };
      break;
    case 'irv':
      spec = { kind: 'irv', id: contestId, candidates: [...candidateIds], ...(input.maxRanks !== undefined && { maxRanks: input.maxRanks }) };
      break;
  }
  return {
    contestId,
    order,
    title: input.title,
    description: input.description,
    spec,
    proposalSnapshotId: input.kind === 'proposal' ? input.proposalSnapshotId : null,
    positionId: input.kind === 'proposal' ? null : (input.positionId ?? null),
  };
}
