import { z } from 'zod';
import { OK, refuse, type Check, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';

/**
 * Teams (design §5.7): working groups Active members join. A Membership Admin creates a team with its first lead, and
 * renames, archives or restores it; leads decide who joins, remove members, make co-leads and change the team's other
 * settings. Every Active member sees every team that is not archived and who is on it. A team always keeps a lead.
 */

/** How someone gets onto a team: join at once, ask and wait for a lead, or not at all (a Membership Admin adds them). */
export const TEAM_JOIN_POLICIES = ['open', 'approval', 'closed'] as const;
export type TeamJoinPolicy = (typeof TEAM_JOIN_POLICIES)[number];

export const TEAM_ROLES = ['lead', 'member'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** A team's colour, named so the web app can map it to its own palette. */
export const TEAM_COLORS = ['blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'purple', 'indigo', 'grey'] as const;
export type TeamColor = (typeof TEAM_COLORS)[number];

/** A team's symbol: Material Icons names, the font the web app already loads. */
export const TEAM_ICONS = [
  'groups',
  'campaign',
  'forum',
  'code',
  'brush',
  'gavel',
  'school',
  'science',
  'public',
  'event',
  'volunteer_activism',
  'handshake',
  'payments',
  'rocket_launch',
] as const;
export type TeamIcon = (typeof TEAM_ICONS)[number];

export const TEAM_LIMITS = {
  name: 80,
  description: 2000,
  joinQuestion: 300,
  memberLink: 500,
  message: 1000,
  answer: 1000,
  note: 500,
  capacity: 1000,
} as const;

/** After a lead declines, how long before the same member may ask that team again. */
export const DECLINED_RETRY_DAYS = 14;

/** The settings a lead may change; the name, and whether the team is archived, stay with Membership Admins. */
export const LEAD_SETTINGS = ['description', 'joinPolicy', 'joinQuestion', 'capacity', 'memberLink', 'color', 'icon'] as const;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/, 'use 2–48 lowercase letters, digits and dashes');
const accountId = z.string().trim().min(1, 'choose a member').max(128);
/** Blank is none. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `at most ${max} characters`)
    .nullable()
    .default(null)
    .transform((v) => v || null);

/** Why a link for the team's members cannot be used, if it cannot: an `https://` address, or none. */
export function memberLinkProblem(address: string): string | null {
  if (address.length > TEAM_LIMITS.memberLink) return `the link can be at most ${TEAM_LIMITS.memberLink} characters`;
  if (/\s/.test(address)) return 'a link cannot contain spaces';
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return 'use an https:// address';
  }
  return parsed.protocol === 'https:' ? null : parsed.protocol === 'http:' ? 'use the https:// address' : 'use an https:// address';
}

const settingsShape = {
  name: z.string().trim().min(1, 'enter a name').max(TEAM_LIMITS.name),
  description: z.string().trim().max(TEAM_LIMITS.description).default(''),
  joinPolicy: z.enum(TEAM_JOIN_POLICIES),
  /** Asked of everyone who asks to join; they must answer it. */
  joinQuestion: optionalText(TEAM_LIMITS.joinQuestion),
  /** The most members the team takes, leads included; null for no limit. */
  capacity: z.number().int().min(1, 'at least 1').max(TEAM_LIMITS.capacity).nullable().default(null),
  /** Where the team talks (a Discord channel, a group chat): shown to its members only. */
  memberLink: optionalText(TEAM_LIMITS.memberLink).superRefine((v, ctx) => {
    const problem = v && memberLinkProblem(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  }),
  color: z.enum(TEAM_COLORS),
  icon: z.enum(TEAM_ICONS),
};

export const teamSettingsSchema = z.strictObject(settingsShape);
export type TeamSettings = Readonly<z.output<typeof teamSettingsSchema>>;

/** `POST /v1/admin/teams`: a new team and the Active member who leads it. */
export const createTeamSchema = z.strictObject({ ...settingsShape, teamId: slug, leadAccountId: accountId });
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

/** `PUT /v1/admin/teams/{teamId}`: every setting, and the version it was edited from. */
export const updateTeamSchema = z.strictObject({ ...settingsShape, basedOn: z.number().int().min(1) });
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

/** `PUT /v1/teams/{teamId}`: a lead's change, which keeps the name. */
export const leadTeamSettingsSchema = updateTeamSchema.omit({ name: true });
export type LeadTeamSettingsInput = z.infer<typeof leadTeamSettingsSchema>;

/** `POST /v1/teams/{teamId}/join`: what the member tells the leads; the answer is required when the team asks a question. */
export const joinTeamSchema = z.strictObject({
  message: optionalText(TEAM_LIMITS.message),
  answer: optionalText(TEAM_LIMITS.answer),
});
export type JoinTeamInput = z.infer<typeof joinTeamSchema>;

/** A lead's (or a Membership Admin's) decision on a request to join. */
export const teamRequestDecisionSchema = z.strictObject({
  decision: z.enum(['approve', 'decline']),
  /** Shown to the member. */
  note: optionalText(TEAM_LIMITS.note),
});
export type TeamRequestDecisionInput = z.infer<typeof teamRequestDecisionSchema>;

/** `POST /v1/admin/teams/{teamId}/members`: a Membership Admin puts an Active member on the team, or changes their role. */
export const teamMemberInputSchema = z.strictObject({ accountId, role: z.enum(TEAM_ROLES) });
export type TeamMemberInput = z.infer<typeof teamMemberInputSchema>;

/** `POST /v1/admin/teams/{teamId}/archive`. */
export const teamArchiveSchema = z.strictObject({ archived: z.boolean() });
export type TeamArchiveInput = z.infer<typeof teamArchiveSchema>;

/** `teams/{teamId}` */
export interface TeamRecord extends TeamSettings {
  readonly teamId: string;
  /** Hidden from members, and nobody joins or asks; its members and requests are kept for a restore. */
  readonly archived: boolean;
  /** Counts saves, so a change made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** `team_members/{teamId}_{accountId}` */
export interface TeamMemberRecord {
  readonly teamId: string;
  readonly accountId: string;
  readonly role: TeamRole;
  readonly joinedAt: string;
  /** Who put them on the team: themselves (an open team), the lead who approved their request, or a Membership Admin. */
  readonly addedBy: string;
}

export type TeamRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** `team_requests/{teamId}_{accountId}`: a member's latest request to join the team; asking again replaces it. */
export interface TeamRequestRecord {
  readonly teamId: string;
  readonly accountId: string;
  readonly status: TeamRequestStatus;
  readonly message: string | null;
  /** The team's question when they asked, and their answer; both null when it had none. */
  readonly question: string | null;
  readonly answer: string | null;
  readonly askedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  /** The lead's note to them, if any. */
  readonly note: string | null;
}

/** The ID of a member's place on a team, and of their request to join it (team IDs have no underscore). */
export const teamMemberId = (teamId: string, accountId: string) => `${teamId}_${accountId}`;

/** Who is acting on a team: a Membership Admin, or a member with their place on it (null if they have none). */
export interface TeamActor {
  readonly accountId: string;
  readonly admin: boolean;
  readonly membership: TeamMemberRecord | null;
}

const isLead = (actor: TeamActor) => actor.membership?.role === 'lead';

/** What every change reads: the team, how many places count against its capacity, and how many leads it has. */
export interface TeamState {
  readonly team: TeamRecord | null;
  /** Places held by Active members now; places of people no longer Active do not count against the capacity. */
  readonly activeMembers: number;
  /** Every lead's place, Active or not, so the last one is never taken away. */
  readonly leads: number;
}

function teamOpen(state: TeamState): Outcome<TeamRecord> {
  if (!state.team) return refuse('not_found', 'no such team');
  if (state.team.archived) return refuse('conflict', 'the team is archived');
  return { ok: true, value: state.team };
}

const full = (team: TeamRecord, activeMembers: number) => team.capacity !== null && activeMembers >= team.capacity;
const FULL = 'the team is full';

/** `team.member_changed`: one change to who is on a team, or their role. */
export type TeamMemberChange = 'joined' | 'added' | 'left' | 'removed' | 'made_lead' | 'stepped_down' | 'made_member';

export interface TeamMemberChangedPayload {
  readonly teamId: string;
  readonly change: TeamMemberChange;
  /** Their role afterwards; null once they are off the team. */
  readonly role: TeamRole | null;
}

/** `team.changed`: a team created, its settings changed, archived or restored. */
export interface TeamChangedPayload {
  readonly teamId: string;
  readonly change: 'created' | 'updated' | 'archived' | 'restored';
  readonly version: number;
  /** The settings that changed (all of them on creation). */
  readonly fields: readonly (keyof TeamSettings)[];
}

export const memberEvent = (actor: string, subject: string, payload: TeamMemberChangedPayload): LedgerEvent => ({
  type: 'team.member_changed',
  actor,
  subject,
  payload: { ...payload },
});

const teamEvent = (actor: string, payload: TeamChangedPayload): LedgerEvent => ({
  type: 'team.changed',
  actor,
  subject: payload.teamId,
  payload: { ...payload, fields: [...payload.fields] },
});

const SETTINGS = Object.keys(settingsShape) as (keyof TeamSettings)[];

/** The settings that differ between two versions of a team, in the form's order. */
export function changedSettings(before: TeamSettings, after: TeamSettings): (keyof TeamSettings)[] {
  return SETTINGS.filter((key) => before[key] !== after[key]);
}

/** A new team, its first lead's place and the ledger entries; the lead must be an Active member (checked by the caller). */
export function createTeam(
  input: CreateTeamInput,
  existing: TeamRecord | null,
  actor: string,
  at: string,
): Outcome<{ team: TeamRecord; lead: TeamMemberRecord; events: LedgerEvent[] }> {
  if (existing) return refuse('conflict', `a team with the ID ${input.teamId} already exists`);
  const { teamId, leadAccountId, ...settings } = input;
  const team: TeamRecord = { teamId, ...settings, archived: false, version: 1, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor };
  const lead: TeamMemberRecord = { teamId, accountId: leadAccountId, role: 'lead', joinedAt: at, addedBy: actor };
  return {
    ok: true,
    value: {
      team,
      lead,
      events: [
        teamEvent(actor, { teamId, change: 'created', version: 1, fields: SETTINGS }),
        memberEvent(actor, leadAccountId, { teamId, change: 'added', role: 'lead' }),
      ],
    },
  };
}

/**
 * The team with new settings, from the version they were edited from: a Membership Admin changes any; a lead all but the
 * name (`LEAD_SETTINGS`), and only on a team that is not archived.
 */
export function updateTeam(
  team: TeamRecord | null,
  settings: TeamSettings,
  basedOn: number,
  actor: TeamActor,
  at: string,
): Outcome<{ team: TeamRecord; event: LedgerEvent | null }> {
  if (!team) return refuse('not_found', 'no such team');
  if (!actor.admin) {
    if (!isLead(actor)) return refuse('forbidden', 'only the team’s leads and Membership Admins change it');
    if (team.archived) return refuse('conflict', 'the team is archived');
    if (settings.name !== team.name) return refuse('forbidden', 'only a Membership Admin renames a team');
  }
  if (basedOn !== team.version) return refuse('conflict', 'someone changed the team since you opened it; reload to see their change');
  const fields = changedSettings(team, settings);
  if (!fields.length) return { ok: true, value: { team, event: null } };
  const updated: TeamRecord = { ...team, ...settings, version: team.version + 1, updatedAt: at, updatedBy: actor.accountId };
  return {
    ok: true,
    value: { team: updated, event: teamEvent(actor.accountId, { teamId: team.teamId, change: 'updated', version: updated.version, fields }) },
  };
}

/** Archives or restores a team (Membership Admins only, checked by the route). */
export function archiveTeam(team: TeamRecord | null, archived: boolean, actor: string, at: string): Outcome<{ team: TeamRecord; event: LedgerEvent }> {
  if (!team) return refuse('not_found', 'no such team');
  if (team.archived === archived) return refuse('conflict', archived ? 'the team is already archived' : 'the team is not archived');
  const updated: TeamRecord = { ...team, archived, version: team.version + 1, updatedAt: at, updatedBy: actor };
  const change = archived ? 'archived' : 'restored';
  return { ok: true, value: { team: updated, event: teamEvent(actor, { teamId: team.teamId, change, version: updated.version, fields: [] }) } };
}

/**
 * Joining or asking to join, by an Active member (checked by the caller) who is not on the team: an open team takes
 * them at once, an approval team records a request for its leads, a closed team neither. A declined member may ask
 * again `DECLINED_RETRY_DAYS` after the decision.
 */
export function joinTeam(
  state: TeamState,
  actor: TeamActor,
  current: TeamRequestRecord | null,
  input: JoinTeamInput,
  at: string,
): Outcome<{ member: TeamMemberRecord; event: LedgerEvent } | { request: TeamRequestRecord }> {
  const open = teamOpen(state);
  if (!open.ok) return open;
  const team = open.value;
  if (actor.membership) return refuse('conflict', 'you are already on this team');
  if (team.joinPolicy === 'closed') return refuse('conflict', 'the team is not taking members; a Membership Admin adds them');
  if (full(team, state.activeMembers)) return refuse('conflict', FULL);
  if (team.joinPolicy === 'open') {
    const member: TeamMemberRecord = { teamId: team.teamId, accountId: actor.accountId, role: 'member', joinedAt: at, addedBy: actor.accountId };
    return { ok: true, value: { member, event: memberEvent(actor.accountId, actor.accountId, { teamId: team.teamId, change: 'joined', role: 'member' }) } };
  }
  if (current?.status === 'pending') return refuse('conflict', 'you have already asked to join; a lead will decide');
  if (current?.status === 'declined' && current.decidedAt) {
    const again = Date.parse(current.decidedAt) + DECLINED_RETRY_DAYS * 86_400_000;
    if (Date.parse(at) < again) {
      return refuse('conflict', `a lead declined your last request; you can ask again from ${new Date(again).toISOString().slice(0, 10)}`);
    }
  }
  if (team.joinQuestion && !input.answer) return refuse('conflict', 'answer the team’s question to ask to join');
  const request: TeamRequestRecord = {
    teamId: team.teamId,
    accountId: actor.accountId,
    status: 'pending',
    message: input.message,
    question: team.joinQuestion,
    answer: team.joinQuestion ? input.answer : null,
    askedAt: at,
    decidedAt: null,
    decidedBy: null,
    note: null,
  };
  return { ok: true, value: { request } };
}

/** Withdraws the member's own pending request. */
export function withdrawRequest(request: TeamRequestRecord | null, at: string): Outcome<TeamRequestRecord> {
  if (request?.status !== 'pending') return refuse('conflict', 'you have no request waiting for this team');
  return { ok: true, value: { ...request, status: 'withdrawn', decidedAt: at } };
}

/**
 * A lead's or Membership Admin's decision on a pending request. Approving puts the member on the team if they are still
 * an Active member (`requesterActive`, read by the caller) and the team has room.
 */
export function decideRequest(
  state: TeamState,
  actor: TeamActor,
  request: TeamRequestRecord | null,
  requesterActive: boolean,
  decision: TeamRequestDecisionInput,
  at: string,
): Outcome<{ request: TeamRequestRecord; member: TeamMemberRecord | null; event: LedgerEvent | null }> {
  const open = teamOpen(state);
  if (!open.ok) return open;
  const team = open.value;
  if (!actor.admin && !isLead(actor)) return refuse('forbidden', 'only the team’s leads and Membership Admins decide requests');
  if (request?.status !== 'pending') return refuse('not_found', 'no request from that member is waiting');
  const decided: TeamRequestRecord = {
    ...request,
    status: decision.decision === 'approve' ? 'approved' : 'declined',
    decidedAt: at,
    decidedBy: actor.accountId,
    note: decision.note,
  };
  if (decision.decision === 'decline') return { ok: true, value: { request: decided, member: null, event: null } };
  if (!requesterActive) return refuse('conflict', 'they are no longer an Active member; decline the request instead');
  if (full(team, state.activeMembers)) return refuse('conflict', FULL);
  const member: TeamMemberRecord = { teamId: team.teamId, accountId: request.accountId, role: 'member', joinedAt: at, addedBy: actor.accountId };
  return {
    ok: true,
    value: {
      request: decided,
      member,
      event: memberEvent(actor.accountId, request.accountId, { teamId: team.teamId, change: 'joined', role: 'member' }),
    },
  };
}

/** Leaving the team. A lead leaves only while another lead stays. */
export function leaveTeam(state: TeamState, actor: TeamActor): Outcome<LedgerEvent> {
  if (!state.team) return refuse('not_found', 'no such team');
  if (!actor.membership) return refuse('conflict', 'you are not on this team');
  if (isLead(actor) && state.leads <= 1) return refuse('conflict', 'you are the team’s only lead: make someone else a lead first');
  return { ok: true, value: memberEvent(actor.accountId, actor.accountId, { teamId: state.team.teamId, change: 'left', role: null }) };
}

/**
 * Changing someone else's place on the team (a lead's or a Membership Admin's). A lead removes members and makes them
 * co-leads; only a Membership Admin removes a lead or makes them a member again, and adds someone directly. A team
 * keeps at least one lead; stepping down (`target` the actor) leaves the lead a member.
 */
export function changeMember(
  state: TeamState,
  actor: TeamActor,
  target: TeamMemberRecord | null,
  change: 'remove' | 'make_lead' | 'make_member',
): Outcome<{ member: TeamMemberRecord | null; event: LedgerEvent }> {
  const open = teamOpen(state);
  if (!open.ok) return open;
  const teamId = open.value.teamId;
  if (!target) return refuse('not_found', 'they are not on this team');
  const self = target.accountId === actor.accountId;
  const lastLead = target.role === 'lead' && state.leads <= 1;
  switch (change) {
    case 'make_lead': {
      if (!actor.admin && !isLead(actor)) return refuse('forbidden', 'only the team’s leads and Membership Admins make leads');
      if (target.role === 'lead') return refuse('conflict', 'they already lead the team');
      const member: TeamMemberRecord = { ...target, role: 'lead' };
      return { ok: true, value: { member, event: memberEvent(actor.accountId, target.accountId, { teamId, change: 'made_lead', role: 'lead' }) } };
    }
    case 'make_member': {
      if (!(actor.admin || (self && isLead(actor)))) return refuse('forbidden', 'only a Membership Admin takes the lead from someone else');
      if (target.role !== 'lead') return refuse('conflict', 'they do not lead the team');
      if (lastLead) return refuse('conflict', 'the team needs a lead: make someone else a lead first');
      const member: TeamMemberRecord = { ...target, role: 'member' };
      const kind = self ? 'stepped_down' : 'made_member';
      return { ok: true, value: { member, event: memberEvent(actor.accountId, target.accountId, { teamId, change: kind, role: 'member' }) } };
    }
    case 'remove': {
      if (self) return refuse('conflict', 'to leave the team, use Leave');
      if (!actor.admin) {
        if (!isLead(actor)) return refuse('forbidden', 'only the team’s leads and Membership Admins remove members');
        if (target.role === 'lead') return refuse('forbidden', 'only a Membership Admin removes a lead');
      }
      if (lastLead) return refuse('conflict', 'the team needs a lead: make someone else a lead first');
      return { ok: true, value: { member: null, event: memberEvent(actor.accountId, target.accountId, { teamId, change: 'removed', role: null }) } };
    }
  }
}

/**
 * A Membership Admin putting an Active member (checked by the caller) on the team in a role, whatever its join policy:
 * past its capacity too, since the admin decides. Someone already on it just has their role changed.
 */
export function addMember(
  state: TeamState,
  actor: TeamActor,
  current: TeamMemberRecord | null,
  input: TeamMemberInput,
  at: string,
): Outcome<{ member: TeamMemberRecord; event: LedgerEvent }> {
  if (!actor.admin) return refuse('forbidden', 'only Membership Admins add members directly');
  if (current) {
    if (current.role === input.role) return refuse('conflict', input.role === 'lead' ? 'they already lead the team' : 'they are already on the team');
    const changed = changeMember(state, actor, current, input.role === 'lead' ? 'make_lead' : 'make_member');
    return changed.ok ? { ok: true, value: { member: changed.value.member!, event: changed.value.event } } : changed;
  }
  const open = teamOpen(state);
  if (!open.ok) return open;
  const member: TeamMemberRecord = { teamId: open.value.teamId, accountId: input.accountId, role: input.role, joinedAt: at, addedBy: actor.accountId };
  return {
    ok: true,
    value: { member, event: memberEvent(actor.accountId, input.accountId, { teamId: open.value.teamId, change: 'added', role: input.role }) },
  };
}

/** Whether a team can be shown to a member: every team that is not archived. */
export const visibleToMembers = (team: TeamRecord): boolean => !team.archived;

export const checkActiveMember = (status: string | null | undefined): Check =>
  status === 'active' ? OK : refuse('forbidden', 'teams are for Active members');
