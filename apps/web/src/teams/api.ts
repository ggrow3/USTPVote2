import type {
  CreateTeamInput,
  JoinTeamInput,
  LeadTeamSettingsInput,
  TeamDetail,
  TeamMemberInput,
  TeamRequestDecisionInput,
  TeamSummary,
  UpdateTeamInput,
} from 'ustp-domain';
import { api } from '../api.js';

/**
 * The teams context's API (design §5.7, §12): the only place its routes are written. Members and leads use `/v1/teams`,
 * Membership Admins `/v1/admin/teams`; every change answers with the team as the caller now sees it.
 */

const team = (teamId: string) => `/v1/teams/${encodeURIComponent(teamId)}`;
const adminTeam = (teamId: string) => `/v1/admin/teams/${encodeURIComponent(teamId)}`;
const person = (accountId: string) => encodeURIComponent(accountId);

/** Where a page acts from: as a member (and lead), or as a Membership Admin at the console. */
export type TeamMode = 'member' | 'admin';

export function listTeams(mode: TeamMode): Promise<TeamSummary[]> {
  return api<TeamSummary[]>('GET', mode === 'admin' ? '/v1/admin/teams' : '/v1/teams');
}

export function getTeam(mode: TeamMode, teamId: string): Promise<TeamDetail> {
  return api<TeamDetail>('GET', mode === 'admin' ? adminTeam(teamId) : team(teamId));
}

/** Joins an open team at once, or asks the leads of one that decides. */
export function joinTeam(teamId: string, input: JoinTeamInput): Promise<TeamDetail> {
  return api<TeamDetail>('POST', `${team(teamId)}/join`, input);
}

export function withdrawRequest(teamId: string): Promise<TeamDetail> {
  return api<TeamDetail>('DELETE', `${team(teamId)}/request`);
}

export function leaveTeam(teamId: string): Promise<TeamDetail> {
  return api<TeamDetail>('POST', `${team(teamId)}/leave`);
}

export function stepDown(teamId: string): Promise<TeamDetail> {
  return api<TeamDetail>('POST', `${team(teamId)}/step-down`);
}

/** A lead's change of the team's settings (all but the name), or a Membership Admin's of any. */
export function saveTeam(mode: TeamMode, teamId: string, input: LeadTeamSettingsInput | UpdateTeamInput): Promise<TeamDetail> {
  return api<TeamDetail>('PUT', mode === 'admin' ? adminTeam(teamId) : team(teamId), input);
}

export function decideRequest(mode: TeamMode, teamId: string, accountId: string, input: TeamRequestDecisionInput): Promise<TeamDetail> {
  const base = mode === 'admin' ? adminTeam(teamId) : team(teamId);
  return api<TeamDetail>('POST', `${base}/requests/${person(accountId)}/decision`, input);
}

export function removeMember(mode: TeamMode, teamId: string, accountId: string): Promise<TeamDetail> {
  return api<TeamDetail>('DELETE', `${mode === 'admin' ? adminTeam(teamId) : team(teamId)}/members/${person(accountId)}`);
}

/** Makes someone on the team a lead: a lead's co-lead, or a Membership Admin's choice. */
export function makeLead(mode: TeamMode, teamId: string, accountId: string): Promise<TeamDetail> {
  return mode === 'admin'
    ? setMember(teamId, { accountId, role: 'lead' })
    : api<TeamDetail>('POST', `${team(teamId)}/members/${person(accountId)}/lead`);
}

/** A Membership Admin puts an Active member on the team in a role, or changes the role of someone on it. */
export function setMember(teamId: string, input: TeamMemberInput): Promise<TeamDetail> {
  return api<TeamDetail>('POST', `${adminTeam(teamId)}/members`, input);
}

export function createTeam(input: CreateTeamInput): Promise<TeamDetail> {
  return api<TeamDetail>('POST', '/v1/admin/teams', input);
}

export function archiveTeam(teamId: string, archived: boolean): Promise<TeamDetail> {
  return api<TeamDetail>('POST', `${adminTeam(teamId)}/archive`, { archived });
}
