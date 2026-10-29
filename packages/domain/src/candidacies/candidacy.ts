import { hashCanonical } from 'ustp-audit';
import { z } from 'zod';
import { OK, refuse, type Check, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { isCalendarDate } from '../membership/registration.js';
import { districtIdProblem, DISTRICT_ID, type District, type DistrictKind } from './districts.js';

/**
 * Candidacies for public office (design §5.8): an Active member says they are running, for which office and district,
 * in which election, and on what platform. A Membership Admin reviews every declaration, and every later change to it,
 * before it shows on the public Candidates page; until then the last approved version stays up. The member can withdraw
 * it at any time, and a Membership Admin can take a public one down with a reason. Listing is not an endorsement.
 */

/** The offices a member can run for, each elected from one kind of district. */
export const PUBLIC_OFFICES = ['us_president', 'us_senate', 'us_house', 'statewide', 'state_upper', 'state_lower', 'county', 'local'] as const;
export type PublicOffice = (typeof PUBLIC_OFFICES)[number];

export const OFFICE_DISTRICTS: Readonly<Record<PublicOffice, DistrictKind>> = {
  us_president: 'nation',
  us_senate: 'state',
  us_house: 'congressional',
  statewide: 'state',
  state_upper: 'state_upper',
  state_lower: 'state_lower',
  county: 'county',
  local: 'place',
};

/** Which election on the date: a primary, the general election, a special election or a runoff. */
export const ELECTION_STAGES = ['primary', 'general', 'special', 'runoff'] as const;
export type ElectionStage = (typeof ELECTION_STAGES)[number];

export const CANDIDACY_LIMITS = {
  officeTitle: 120,
  ballotLabel: 60,
  platform: 5000,
  website: 500,
  note: 1000,
  /** Open candidacies (any not withdrawn or taken down) whose election is still to come, per member. */
  open: 5,
  /** How far ahead an election can be. */
  yearsAhead: 10,
} as const;

/** Blank is none. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `at most ${max} characters`)
    .nullable()
    .default(null)
    .transform((v) => v || null);

/** Why a campaign website cannot be used, if it cannot: an `https://` address, or none. */
export function websiteProblem(address: string): string | null {
  if (address.length > CANDIDACY_LIMITS.website) return `the address can be at most ${CANDIDACY_LIMITS.website} characters`;
  if (/\s/.test(address)) return 'an address cannot contain spaces';
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return 'use an https:// address';
  }
  return parsed.protocol === 'https:' ? null : parsed.protocol === 'http:' ? 'use the https:// address' : 'use an https:// address';
}

/**
 * `POST /v1/candidacies` and `PUT /v1/candidacies/{id}`: what the member says. The state and district are the Census
 * codes the form's lists offer; the api looks them up and stores the Census name with them.
 */
export const candidacyInputSchema = z
  .strictObject({
    office: z.enum(PUBLIC_OFFICES),
    /** The office as it appears on the ballot: "U.S. Representative", "Mayor", "County Sheriff". */
    officeTitle: z.string().trim().min(1, 'enter the office as it appears on the ballot').max(CANDIDACY_LIMITS.officeTitle),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/, 'choose a state or territory')
      .nullable()
      .default(null),
    /** The district's GEOID; null for an office elected nationwide or statewide. */
    districtId: z.string().trim().regex(DISTRICT_ID, 'choose the district').nullable().default(null),
    electionDate: z.string().refine(isCalendarDate, 'enter the election date as YYYY-MM-DD'),
    election: z.enum(ELECTION_STAGES),
    /** The party or label next to their name on the ballot, if any: "Transhumanist", "Independent", "Nonpartisan". */
    ballotLabel: optionalText(CANDIDACY_LIMITS.ballotLabel),
    /** Plain text; paragraphs are kept. */
    platform: z.string().trim().min(1, 'say what you stand for').max(CANDIDACY_LIMITS.platform, `at most ${CANDIDACY_LIMITS.platform} characters`),
    website: optionalText(CANDIDACY_LIMITS.website).superRefine((v, ctx) => {
      const problem = v && websiteProblem(v);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
  })
  .superRefine((v, ctx) => {
    const kind = OFFICE_DISTRICTS[v.office];
    if (kind === 'nation') {
      if (v.state !== null) ctx.addIssue({ code: 'custom', path: ['state'], message: 'a nationwide office has no state' });
      return;
    }
    const problem = districtIdProblem(kind, v.state, kind === 'state' ? null : v.districtId);
    if (problem) ctx.addIssue({ code: 'custom', path: [v.state === null || problem.startsWith('choose a state') ? 'state' : 'districtId'], message: problem });
  });
export type CandidacyInput = z.infer<typeof candidacyInputSchema>;

/** `PUT /v1/candidacies/{id}`: the whole declaration again, and the version it was edited from. */
export const candidacyChangeSchema = z.strictObject({ candidacy: candidacyInputSchema, basedOn: z.number().int().min(1) });
export type CandidacyChangeInput = z.infer<typeof candidacyChangeSchema>;

/** `POST /v1/admin/candidacies/{id}/decision`: approve what is waiting, or decline it with a note to the member. */
export const candidacyDecisionSchema = z
  .strictObject({
    decision: z.enum(['approve', 'decline']),
    note: optionalText(CANDIDACY_LIMITS.note),
    /** The version reviewed, so a change the member made meanwhile is not approved unseen. */
    basedOn: z.number().int().min(1),
  })
  .refine((v) => v.decision === 'approve' || v.note !== null, { path: ['note'], message: 'tell the member why' });
export type CandidacyDecisionInput = z.infer<typeof candidacyDecisionSchema>;

/** `POST /v1/admin/candidacies/{id}/remove`: takes a candidacy down, with the reason the member is shown. */
export const candidacyRemovalSchema = z.strictObject({
  reason: z.string().trim().min(1, 'say why').max(CANDIDACY_LIMITS.note),
});
export type CandidacyRemovalInput = z.infer<typeof candidacyRemovalSchema>;

/** One version of a declaration, as reviewed and shown; the district is the api's Census lookup. */
export interface CandidacyContent {
  readonly office: PublicOffice;
  readonly officeTitle: string;
  readonly district: District;
  readonly electionDate: string;
  readonly election: ElectionStage;
  readonly ballotLabel: string | null;
  readonly platform: string;
  readonly website: string | null;
}

/** Open until the member withdraws it or a Membership Admin takes it down; then it is kept, but never shown. */
export type CandidacyStatus = 'open' | 'withdrawn' | 'removed';

/** `candidacies/{candidacyId}` */
export interface CandidacyRecord {
  readonly candidacyId: string;
  readonly accountId: string;
  readonly status: CandidacyStatus;
  /** What the Candidates page shows: the last version a Membership Admin approved; null until one is. */
  readonly published: CandidacyContent | null;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  /** A version waiting for review (the first, or a change to the published one); null when nothing is waiting. */
  readonly proposed: CandidacyContent | null;
  readonly proposedAt: string | null;
  /** Set when a Membership Admin declined `proposed`; the member changes it and sends it again. */
  readonly declined: { readonly note: string; readonly by: string; readonly at: string } | null;
  /** Open with a published version: the one field the public list queries. */
  readonly public: boolean;
  /** How it ended: withdrawn by the member, or taken down with a reason. */
  readonly ended: { readonly by: string; readonly at: string; readonly reason: string | null } | null;
  /** Counts saves, so a change made, or a review done, from an older copy is refused. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `candidacy.changed`: what the public page shows changed, or a Membership Admin decided on a declaration. */
export interface CandidacyChangedPayload {
  readonly candidacyId: string;
  readonly change: 'approved' | 'declined' | 'withdrawn' | 'removed';
  readonly office: PublicOffice;
  readonly districtGeoid: string;
  readonly electionDate: string;
  /** H(JCS(content)) of the version approved or declined; null for a withdrawal or a removal. */
  readonly contentHash: string | null;
}

/** H(JCS({v: 1, content})): which text was approved, as the ledger records it. */
export function candidacyContentHash(content: CandidacyContent): string {
  return hashCanonical({ v: 1, content });
}

/** The version a member's declaration says now: what is waiting for review, else what is public. */
export const currentContent = (record: CandidacyRecord): CandidacyContent => (record.proposed ?? record.published)!;

/** The declaration as stored, from what the member sent and the district the api looked up. */
export function candidacyContent(input: CandidacyInput, district: District): CandidacyContent {
  return {
    office: input.office,
    officeTitle: input.officeTitle,
    district,
    electionDate: input.electionDate,
    election: input.election,
    ballotLabel: input.ballotLabel,
    platform: input.platform.replace(/\r\n?/g, '\n'),
    website: input.website,
  };
}

/** `YYYY-MM-DD` in UTC. */
const dayOf = (at: string) => at.slice(0, 10);

/** The day before `at` in UTC: an election "today" anywhere in the US is not refused for being past in UTC. */
function yesterday(at: string): string {
  const d = new Date(at);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** An election can be declared for until its day is over everywhere in the US, and up to ten years ahead. */
export function checkElectionDate(date: string, at: string): Check {
  if (date < yesterday(at)) return refuse('conflict', 'that election is over; choose a date to come');
  const latest = new Date(at);
  latest.setUTCFullYear(latest.getUTCFullYear() + CANDIDACY_LIMITS.yearsAhead);
  if (date > dayOf(latest.toISOString())) return refuse('conflict', `choose an election within ${CANDIDACY_LIMITS.yearsAhead} years`);
  return OK;
}

/** Still counts toward the member's limit: open, and its election not over. */
const stillOpen = (record: CandidacyRecord, at: string) => record.status === 'open' && currentContent(record).electionDate >= yesterday(at);

const sameRace = (a: CandidacyContent, b: CandidacyContent) =>
  a.office === b.office && a.district.geoid === b.district.geoid && a.electionDate === b.electionDate && a.election === b.election;

const sameContent = (a: CandidacyContent | null, b: CandidacyContent | null) =>
  a !== null && b !== null && candidacyContentHash(a) === candidacyContentHash(b);

/** A new declaration, waiting for review. `mine` is every candidacy the member already has. */
export function declareCandidacy(
  content: CandidacyContent,
  mine: readonly CandidacyRecord[],
  ids: { readonly candidacyId: string; readonly accountId: string },
  at: string,
): Outcome<CandidacyRecord> {
  const date = checkElectionDate(content.electionDate, at);
  if (!date.ok) return date;
  const open = mine.filter((r) => stillOpen(r, at));
  if (open.some((r) => sameRace(currentContent(r), content))) return refuse('conflict', 'you have already declared for this race');
  if (open.length >= CANDIDACY_LIMITS.open) {
    return refuse('conflict', `you can have at most ${CANDIDACY_LIMITS.open} candidacies open at once; withdraw one first`);
  }
  return {
    ok: true,
    value: {
      ...ids,
      status: 'open',
      published: null,
      publishedAt: null,
      publishedBy: null,
      proposed: content,
      proposedAt: at,
      declined: null,
      public: false,
      ended: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
    },
  };
}

/** The member's own open candidacy, at the version they edited, or why not. */
function ownOpen(record: CandidacyRecord | null, accountId: string, basedOn?: number): Outcome<CandidacyRecord> {
  if (!record || record.accountId !== accountId) return refuse('not_found', 'no such candidacy');
  if (record.status !== 'open') return refuse('conflict', `this candidacy was ${record.status}`);
  if (basedOn !== undefined && basedOn !== record.version) {
    return refuse('conflict', 'this candidacy changed since you opened it; reload it and make your change again');
  }
  return { ok: true, value: record };
}

/**
 * The member changes their declaration: the change waits for review while the published version stays up. Changing it
 * back to what is published leaves nothing waiting.
 */
export function changeCandidacy(
  record: CandidacyRecord | null,
  content: CandidacyContent,
  basedOn: number,
  accountId: string,
  at: string,
): Outcome<CandidacyRecord> {
  const own = ownOpen(record, accountId, basedOn);
  if (!own.ok) return own;
  const current = own.value;
  if (sameContent(content, current.proposed) && !current.declined) return refuse('conflict', 'nothing changed');
  if (sameContent(content, current.published)) {
    if (!current.proposed) return refuse('conflict', 'nothing changed');
    return { ok: true, value: { ...current, proposed: null, proposedAt: null, declined: null, version: current.version + 1, updatedAt: at } };
  }
  const date = checkElectionDate(content.electionDate, at);
  if (!date.ok) return date;
  return { ok: true, value: { ...current, proposed: content, proposedAt: at, declined: null, version: current.version + 1, updatedAt: at } };
}

const changedEvent = (
  actor: string,
  record: CandidacyRecord,
  change: CandidacyChangedPayload['change'],
  content: CandidacyContent,
  hashed: boolean,
): LedgerEvent => {
  const payload: CandidacyChangedPayload = {
    candidacyId: record.candidacyId,
    change,
    office: content.office,
    districtGeoid: content.district.geoid,
    electionDate: content.electionDate,
    contentHash: hashed ? candidacyContentHash(content) : null,
  };
  return { type: 'candidacy.changed', actor, subject: record.accountId, payload: { ...payload } };
};

/** The member withdraws: it leaves the public page at once. Ledgered when it was public. */
export function withdrawCandidacy(
  record: CandidacyRecord | null,
  accountId: string,
  at: string,
): Outcome<{ record: CandidacyRecord; event: LedgerEvent | null }> {
  const own = ownOpen(record, accountId);
  if (!own.ok) return own;
  const current = own.value;
  const ended: CandidacyRecord = {
    ...current,
    status: 'withdrawn',
    public: false,
    ended: { by: accountId, at, reason: null },
    version: current.version + 1,
    updatedAt: at,
  };
  return { ok: true, value: { record: ended, event: current.published ? changedEvent(accountId, current, 'withdrawn', current.published, false) : null } };
}

/** An open candidacy a Membership Admin may act on: not their own, and at the version they looked at. */
function reviewable(record: CandidacyRecord | null, actor: string, basedOn?: number): Outcome<CandidacyRecord> {
  if (!record) return refuse('not_found', 'no such candidacy');
  if (record.accountId === actor) return refuse('forbidden', 'another Membership Admin must review your own candidacy');
  if (record.status !== 'open') return refuse('conflict', `this candidacy was ${record.status}`);
  if (basedOn !== undefined && basedOn !== record.version) {
    return refuse('conflict', 'the member changed this candidacy since you opened it; review it again');
  }
  return { ok: true, value: record };
}

/** A Membership Admin approves what is waiting (it becomes the public version) or declines it with a note. */
export function decideCandidacy(
  record: CandidacyRecord | null,
  input: CandidacyDecisionInput,
  actor: string,
  at: string,
): Outcome<{ record: CandidacyRecord; event: LedgerEvent }> {
  const open = reviewable(record, actor, input.basedOn);
  if (!open.ok) return open;
  const current = open.value;
  const proposed = current.proposed;
  if (!proposed || current.declined) return refuse('conflict', 'nothing is waiting for review');
  if (input.decision === 'decline') {
    const declined = { note: input.note ?? '', by: actor, at };
    return {
      ok: true,
      value: {
        record: { ...current, declined, version: current.version + 1, updatedAt: at },
        event: changedEvent(actor, current, 'declined', proposed, true),
      },
    };
  }
  const approved: CandidacyRecord = {
    ...current,
    published: proposed,
    publishedAt: at,
    publishedBy: actor,
    proposed: null,
    proposedAt: null,
    declined: null,
    public: true,
    version: current.version + 1,
    updatedAt: at,
  };
  return { ok: true, value: { record: approved, event: changedEvent(actor, current, 'approved', proposed, true) } };
}

/** A Membership Admin takes an open candidacy down, public or not, with the reason the member is shown. */
export function removeCandidacy(
  record: CandidacyRecord | null,
  reason: string,
  actor: string,
  at: string,
): Outcome<{ record: CandidacyRecord; event: LedgerEvent }> {
  const open = reviewable(record, actor);
  if (!open.ok) return open;
  const current = open.value;
  const removed: CandidacyRecord = {
    ...current,
    status: 'removed',
    public: false,
    ended: { by: actor, at, reason },
    version: current.version + 1,
    updatedAt: at,
  };
  return { ok: true, value: { record: removed, event: changedEvent(actor, current, 'removed', currentContent(current), false) } };
}
