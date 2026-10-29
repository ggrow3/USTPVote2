import type { MemberRecord } from '../membership/records.js';
import type { TeamMemberRecord, TeamRecord, TeamRequestRecord, TeamRole, TeamState } from './team.js';

/**
 * What the API shows of teams (design §5.7, §12): to Active members, every team that is not archived with who is on
 * it; to its leads and Membership Admins, also who is waiting to join and anyone on it who is no longer Active. Only a
 * team's members (and Membership Admins) get its link.
 */

/** What a team page needs to know about a person, from their member record. */
export interface TeamPersonInfo {
  /** Their preferred name, or else their legal name. */
  readonly name: string;
  /** Two-letter state code. */
  readonly state: string;
  readonly active: boolean;
}

export function personInfo(member: Pick<MemberRecord, 'legalName' | 'preferredName' | 'state' | 'status'> | null): TeamPersonInfo {
  if (!member) return { name: 'Unknown member', state: '', active: false };
  return { name: member.preferredName ?? member.legalName, state: member.state, active: member.status === 'active' };
}

/** One person on a team. `active` is false for someone who is no longer an Active member (shown to leads only). */
export interface TeamPerson extends TeamPersonInfo {
  readonly accountId: string;
  readonly role: TeamRole;
  readonly joinedAt: string;
}

/** A request to join, as its team's leads see it. */
export interface TeamRequestView extends TeamRequestRecord {
  readonly name: string;
  readonly state: string;
  readonly active: boolean;
}

/** The viewer's own standing with a team. */
export interface MyTeamStanding {
  readonly role: TeamRole | null;
  /** Their latest request to join it, if they made one. */
  readonly request: TeamRequestRecord | null;
}

/** `GET /v1/teams` (and `/v1/admin/teams`): one team in the list. */
export interface TeamSummary {
  /** The team; `memberLink` is null unless the viewer is on it or a Membership Admin. */
  readonly team: TeamRecord;
  /** Active members on it, leads included. */
  readonly members: number;
  readonly leads: readonly Pick<TeamPerson, 'accountId' | 'name'>[];
  readonly mine: MyTeamStanding;
  /** Requests waiting for a decision: for its leads and Membership Admins, else null. */
  readonly waiting: number | null;
}

/** `GET /v1/teams/{teamId}` (and `/v1/admin/teams/{teamId}`). */
export interface TeamDetail extends TeamSummary {
  /** Leads first, then members, each by name. Only Active members, except for its leads and Membership Admins. */
  readonly roster: readonly TeamPerson[];
  /** Requests waiting for a decision, oldest first: for its leads and Membership Admins, else null. */
  readonly requests: readonly TeamRequestView[] | null;
}

/** Who is looking: a member (their accountId) or a Membership Admin at the admin console. */
export interface TeamViewer {
  readonly accountId: string | null;
  readonly admin: boolean;
}

export interface TeamViewInput {
  readonly team: TeamRecord;
  /** The team's places. */
  readonly members: readonly TeamMemberRecord[];
  /** The team's requests: at least the pending ones and the viewer's own. */
  readonly requests: readonly TeamRequestRecord[];
  /** Everyone on the team or asking to join it, by accountId. */
  readonly people: ReadonlyMap<string, TeamPersonInfo>;
  readonly viewer: TeamViewer;
}

const UNKNOWN = personInfo(null);
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** The counts the rules read (`TeamState`): only Active members take a place or count as a lead. */
export function teamState(team: TeamRecord | null, members: readonly TeamMemberRecord[], people: ReadonlyMap<string, TeamPersonInfo>): TeamState {
  const active = members.filter((m) => people.get(m.accountId)?.active);
  return { team, activeMembers: active.length, leads: members.filter((m) => m.role === 'lead').length };
}

export function teamSummary(input: TeamViewInput): TeamSummary {
  const { team, members, requests, people, viewer } = input;
  const mine = members.find((m) => m.accountId === viewer.accountId) ?? null;
  const manages = viewer.admin || mine?.role === 'lead';
  return {
    team: viewer.admin || mine ? team : { ...team, memberLink: null },
    members: members.filter((m) => people.get(m.accountId)?.active).length,
    leads: members
      .filter((m) => m.role === 'lead')
      .map((m) => ({ accountId: m.accountId, name: (people.get(m.accountId) ?? UNKNOWN).name }))
      .sort((a, b) => byName.compare(a.name, b.name)),
    mine: { role: mine?.role ?? null, request: requests.find((r) => r.accountId === viewer.accountId) ?? null },
    waiting: manages ? requests.filter((r) => r.status === 'pending').length : null,
  };
}

export function teamDetail(input: TeamViewInput): TeamDetail {
  const summary = teamSummary(input);
  const manages = summary.waiting !== null;
  const roster = input.members
    .map((m) => ({ accountId: m.accountId, role: m.role, joinedAt: m.joinedAt, ...(input.people.get(m.accountId) ?? UNKNOWN) }))
    .filter((p) => manages || p.active)
    .sort((a, b) => (a.role === b.role ? byName.compare(a.name, b.name) : a.role === 'lead' ? -1 : 1));
  const requests = manages
    ? input.requests
        .filter((r) => r.status === 'pending')
        .map((r) => ({ ...r, ...(input.people.get(r.accountId) ?? UNKNOWN) }))
        .sort((a, b) => a.askedAt.localeCompare(b.askedAt))
    : null;
  return { ...summary, roster, requests };
}
