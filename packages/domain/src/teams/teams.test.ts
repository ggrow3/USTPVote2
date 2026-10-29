import { describe, expect, it } from 'vitest';
import { isPublicLedgerEvent } from '../ledger.js';
import {
  addMember,
  archiveTeam,
  changeMember,
  createTeam,
  createTeamSchema,
  decideRequest,
  joinTeam,
  joinTeamSchema,
  leadTeamSettingsSchema,
  leaveTeam,
  updateTeam,
  withdrawRequest,
  type TeamActor,
  type TeamMemberRecord,
  type TeamRecord,
  type TeamRequestRecord,
  type TeamState,
} from './team.js';
import { personInfo, teamDetail, teamState, teamSummary, type TeamPersonInfo } from './views.js';

const NOW = '2026-10-29T12:00:00.000Z';
const LATER = '2026-11-20T12:00:00.000Z';
const settings = {
  name: 'Outreach',
  description: 'Tabling, flyers and events',
  joinPolicy: 'approval' as const,
  joinQuestion: 'Which state are you in?',
  capacity: null,
  memberLink: 'https://discord.gg/outreach',
  color: 'teal' as const,
  icon: 'campaign' as const,
};
const team: TeamRecord = {
  teamId: 'outreach',
  ...settings,
  archived: false,
  version: 1,
  createdAt: NOW,
  createdBy: 'ma',
  updatedAt: NOW,
  updatedBy: 'ma',
};
const place = (accountId: string, role: 'lead' | 'member' = 'member'): TeamMemberRecord => ({
  teamId: 'outreach',
  accountId,
  role,
  joinedAt: NOW,
  addedBy: 'ma',
});
const state = (over: Partial<TeamState> = {}): TeamState => ({ team, activeMembers: 2, leads: 1, ...over });
const actor = (accountId: string, membership: TeamMemberRecord | null = null, admin = false): TeamActor => ({ accountId, admin, membership });
const admin = actor('ma', null, true);
const lead = actor('lea', place('lea', 'lead'));
const pending: TeamRequestRecord = {
  teamId: 'outreach',
  accountId: 'ada',
  status: 'pending',
  message: 'I can table in Austin',
  question: 'Which state are you in?',
  answer: 'Texas',
  askedAt: NOW,
  decidedAt: null,
  decidedBy: null,
  note: null,
};
const reasonOf = (outcome: { ok: boolean; reason?: string }) => (outcome.ok ? 'ok' : outcome.reason);

describe('team settings', () => {
  it('need a name, a policy, a colour and an icon; blank texts are none; links are https', () => {
    const input = { ...settings, teamId: 'outreach', leadAccountId: 'lea' };
    expect(createTeamSchema.parse({ ...input, joinQuestion: '  ', memberLink: '' })).toMatchObject({ joinQuestion: null, memberLink: null });
    expect(createTeamSchema.safeParse({ ...input, name: ' ' }).success).toBe(false);
    expect(createTeamSchema.safeParse({ ...input, teamId: 'Out Reach' }).success).toBe(false);
    expect(createTeamSchema.safeParse({ ...input, color: 'chartreuse' }).success).toBe(false);
    expect(createTeamSchema.safeParse({ ...input, capacity: 0 }).success).toBe(false);
    const http = createTeamSchema.safeParse({ ...input, memberLink: 'http://discord.gg/outreach' });
    expect(http.error?.issues[0]).toMatchObject({ path: ['memberLink'], message: 'use the https:// address' });
    // A lead's change leaves the name out.
    expect(leadTeamSettingsSchema.safeParse({ ...settings, basedOn: 1 }).success).toBe(false);
    const { name: _, ...rest } = settings;
    expect(leadTeamSettingsSchema.safeParse({ ...rest, basedOn: 1 }).success).toBe(true);
    expect(joinTeamSchema.parse({})).toEqual({ message: null, answer: null });
  });

  it('create a team with its first lead, ledgered as two entries Auditors read', () => {
    const created = createTeam({ ...settings, teamId: 'outreach', leadAccountId: 'lea' }, null, 'ma', NOW);
    expect(created.ok && created.value.team).toEqual(team);
    expect(created.ok && created.value.lead).toEqual(place('lea', 'lead'));
    expect(created.ok && created.value.events.map((e) => [e.type, e.subject, e.payload])).toEqual([
      ['team.changed', 'outreach', expect.objectContaining({ change: 'created', version: 1 })],
      ['team.member_changed', 'lea', { teamId: 'outreach', change: 'added', role: 'lead' }],
    ]);
    expect(isPublicLedgerEvent('team.changed')).toBe(false);
    expect(isPublicLedgerEvent('team.member_changed')).toBe(false);
    expect(reasonOf(createTeam({ ...settings, teamId: 'outreach', leadAccountId: 'lea' }, team, 'ma', NOW))).toBe(
      'a team with the ID outreach already exists',
    );
  });

  it('change from the version read: a lead all but the name, a Membership Admin all', () => {
    const changed = updateTeam(team, { ...settings, joinPolicy: 'open', capacity: 12 }, 1, lead, LATER);
    expect(changed.ok && changed.value.team).toMatchObject({ joinPolicy: 'open', capacity: 12, version: 2, updatedBy: 'lea' });
    expect(changed.ok && changed.value.event?.payload).toEqual({ teamId: 'outreach', change: 'updated', version: 2, fields: ['joinPolicy', 'capacity'] });
    expect(reasonOf(updateTeam(team, { ...settings, name: 'Field team' }, 1, lead, LATER))).toBe('only a Membership Admin renames a team');
    expect(updateTeam(team, { ...settings, name: 'Field team' }, 1, admin, LATER).ok).toBe(true);
    expect(reasonOf(updateTeam(team, settings, 1, actor('ada', place('ada')), LATER))).toBe('only the team’s leads and Membership Admins change it');
    expect(reasonOf(updateTeam(team, { ...settings, capacity: 3 }, 0, admin, LATER))).toMatch(/someone changed the team/);
    // Nothing changed: nothing to save or ledger.
    expect(updateTeam(team, settings, 1, lead, LATER)).toEqual({ ok: true, value: { team, event: null } });
    expect(reasonOf(updateTeam({ ...team, archived: true }, settings, 1, lead, LATER))).toBe('the team is archived');
  });

  it('archive and restore', () => {
    const archived = archiveTeam(team, true, 'ma', LATER);
    expect(archived.ok && archived.value.team).toMatchObject({ archived: true, version: 2 });
    expect(archived.ok && archived.value.event.payload).toMatchObject({ change: 'archived' });
    expect(reasonOf(archiveTeam(team, false, 'ma', LATER))).toBe('the team is not archived');
    expect(reasonOf(archiveTeam(null, true, 'ma', LATER))).toBe('no such team');
  });
});

describe('joining', () => {
  const ada = actor('ada');
  const ask = { message: 'I can table in Austin', answer: 'Texas' };

  it('an open team takes a member at once', () => {
    const joined = joinTeam(state({ team: { ...team, joinPolicy: 'open' } }), ada, null, ask, NOW);
    expect(joined.ok && 'member' in joined.value && joined.value.member).toEqual({ ...place('ada'), addedBy: 'ada' });
    expect(joined.ok && 'event' in joined.value && joined.value.event.payload).toEqual({ teamId: 'outreach', change: 'joined', role: 'member' });
  });

  it('a team whose leads decide gets a request with the answer to its question', () => {
    expect(joinTeam(state(), ada, null, ask, NOW)).toEqual({ ok: true, value: { request: pending } });
    expect(reasonOf(joinTeam(state(), ada, null, { message: null, answer: null }, NOW))).toBe('answer the team’s question to ask to join');
    const noQuestion = joinTeam(state({ team: { ...team, joinQuestion: null } }), ada, null, ask, NOW);
    expect(noQuestion.ok && 'request' in noQuestion.value && noQuestion.value.request).toMatchObject({ question: null, answer: null });
  });

  it('refuses a closed, full or archived team, a member, and a second request', () => {
    expect(reasonOf(joinTeam(state({ team: { ...team, joinPolicy: 'closed' } }), ada, null, ask, NOW))).toMatch(/not taking members/);
    expect(reasonOf(joinTeam(state({ team: { ...team, capacity: 2 } }), ada, null, ask, NOW))).toBe('the team is full');
    expect(reasonOf(joinTeam(state({ team: { ...team, archived: true } }), ada, null, ask, NOW))).toBe('the team is archived');
    expect(reasonOf(joinTeam(state({ team: null }), ada, null, ask, NOW))).toBe('no such team');
    expect(reasonOf(joinTeam(state(), actor('ada', place('ada')), null, ask, NOW))).toBe('you are already on this team');
    expect(reasonOf(joinTeam(state(), ada, pending, ask, NOW))).toBe('you have already asked to join; a lead will decide');
  });

  it('lets a declined member ask again two weeks after the decision', () => {
    const declined = { ...pending, status: 'declined' as const, decidedAt: NOW, decidedBy: 'lea' };
    expect(reasonOf(joinTeam(state(), ada, declined, ask, '2026-11-01T00:00:00.000Z'))).toBe(
      'a lead declined your last request; you can ask again from 2026-11-12',
    );
    expect(joinTeam(state(), ada, declined, ask, '2026-11-12T12:00:00.000Z').ok).toBe(true);
    // Withdrawing has no wait.
    expect(joinTeam(state(), ada, { ...pending, status: 'withdrawn' }, ask, NOW).ok).toBe(true);
  });

  it('withdraws only a waiting request', () => {
    expect(withdrawRequest(pending, LATER)).toEqual({ ok: true, value: { ...pending, status: 'withdrawn', decidedAt: LATER } });
    expect(reasonOf(withdrawRequest(null, LATER))).toBe('you have no request waiting for this team');
  });
});

describe('deciding requests', () => {
  const approve = { decision: 'approve' as const, note: null };

  it('a lead approves an Active member onto the team, ledgered as joined', () => {
    const decided = decideRequest(state(), lead, pending, true, approve, LATER);
    expect(decided.ok && decided.value.request).toMatchObject({ status: 'approved', decidedBy: 'lea', decidedAt: LATER });
    expect(decided.ok && decided.value.member).toEqual({ ...place('ada'), joinedAt: LATER, addedBy: 'lea' });
    expect(decided.ok && decided.value.event).toMatchObject({ actor: 'lea', subject: 'ada', payload: { change: 'joined' } });
  });

  it('declines with a note, and nothing joins or is ledgered', () => {
    const decided = decideRequest(state(), admin, pending, true, { decision: 'decline', note: 'We are full this season' }, LATER);
    expect(decided).toEqual({
      ok: true,
      value: { request: { ...pending, status: 'declined', decidedAt: LATER, decidedBy: 'ma', note: 'We are full this season' }, member: null, event: null },
    });
  });

  it('refuses members who do not lead, a request no longer waiting, a full team and someone no longer Active', () => {
    expect(reasonOf(decideRequest(state(), actor('bo', place('bo')), pending, true, approve, LATER))).toBe(
      'only the team’s leads and Membership Admins decide requests',
    );
    expect(reasonOf(decideRequest(state(), lead, { ...pending, status: 'withdrawn' }, true, approve, LATER))).toBe(
      'no request from that member is waiting',
    );
    expect(reasonOf(decideRequest(state({ team: { ...team, capacity: 2 } }), lead, pending, true, approve, LATER))).toBe('the team is full');
    expect(reasonOf(decideRequest(state(), lead, pending, false, approve, LATER))).toMatch(/no longer an Active member/);
    // A full team can still decline.
    expect(decideRequest(state({ team: { ...team, capacity: 2 } }), lead, pending, true, { decision: 'decline', note: null }, LATER).ok).toBe(true);
  });
});

describe('leads and members', () => {
  const two = state({ leads: 2 });

  it('a lead makes a member a co-lead; only a Membership Admin takes the lead from someone else', () => {
    const made = changeMember(state(), lead, place('bo'), 'make_lead');
    expect(made.ok && made.value.member).toEqual(place('bo', 'lead'));
    expect(made.ok && made.value.event.payload).toEqual({ teamId: 'outreach', change: 'made_lead', role: 'lead' });
    expect(reasonOf(changeMember(state(), actor('bo', place('bo')), place('cy'), 'make_lead'))).toMatch(/only the team’s leads/);
    expect(reasonOf(changeMember(two, lead, place('kim', 'lead'), 'make_member'))).toBe('only a Membership Admin takes the lead from someone else');
    const taken = changeMember(two, admin, place('kim', 'lead'), 'make_member');
    expect(taken.ok && taken.value.event.payload).toMatchObject({ change: 'made_member', role: 'member' });
  });

  it('a lead steps down while another lead stays; the team always keeps one', () => {
    const stepped = changeMember(two, lead, place('lea', 'lead'), 'make_member');
    expect(stepped.ok && stepped.value.event.payload).toMatchObject({ change: 'stepped_down', role: 'member' });
    expect(reasonOf(changeMember(state(), lead, place('lea', 'lead'), 'make_member'))).toBe(
      'the team needs a lead: make someone else a lead first',
    );
    expect(reasonOf(changeMember(state(), admin, place('lea', 'lead'), 'remove'))).toBe('the team needs a lead: make someone else a lead first');
    expect(reasonOf(leaveTeam(state(), lead))).toBe('you are the team’s only lead: make someone else a lead first');
    expect(leaveTeam(two, lead).ok).toBe(true);
  });

  it('a lead removes members but not leads, nor themselves', () => {
    const removed = changeMember(state(), lead, place('bo'), 'remove');
    expect(removed.ok && removed.value).toMatchObject({ member: null, event: { subject: 'bo', payload: { change: 'removed', role: null } } });
    expect(reasonOf(changeMember(two, lead, place('kim', 'lead'), 'remove'))).toBe('only a Membership Admin removes a lead');
    expect(changeMember(two, admin, place('kim', 'lead'), 'remove').ok).toBe(true);
    expect(reasonOf(changeMember(state(), lead, place('lea', 'lead'), 'remove'))).toBe('to leave the team, use Leave');
    expect(reasonOf(changeMember(state(), lead, null, 'remove'))).toBe('they are not on this team');
  });

  it('members leave; a Membership Admin adds anyone in either role, past the capacity too', () => {
    expect(leaveTeam(state(), actor('bo', place('bo'))).ok).toBe(true);
    expect(reasonOf(leaveTeam(state(), actor('bo')))).toBe('you are not on this team');
    const full = state({ team: { ...team, joinPolicy: 'closed', capacity: 2 } });
    const added = addMember(full, admin, null, { accountId: 'cy', role: 'lead' }, LATER);
    expect(added.ok && added.value.member).toEqual({ ...place('cy', 'lead'), joinedAt: LATER });
    expect(added.ok && added.value.event.payload).toMatchObject({ change: 'added', role: 'lead' });
    const promoted = addMember(state(), admin, place('bo'), { accountId: 'bo', role: 'lead' }, LATER);
    expect(promoted.ok && promoted.value.member).toEqual(place('bo', 'lead'));
    expect(reasonOf(addMember(state(), admin, place('bo'), { accountId: 'bo', role: 'member' }, LATER))).toBe('they are already on the team');
    expect(reasonOf(addMember(state(), lead, null, { accountId: 'cy', role: 'member' }, LATER))).toBe('only Membership Admins add members directly');
  });
});

describe('what members see', () => {
  const people = new Map<string, TeamPersonInfo>([
    ['lea', personInfo({ legalName: 'Lea Ortiz', preferredName: null, state: 'TX', status: 'active' })],
    ['bo', personInfo({ legalName: 'Robert Lee', preferredName: 'Bo', state: 'CA', status: 'active' })],
    ['gone', personInfo({ legalName: 'Gone Away', preferredName: null, state: 'NY', status: 'resigned' })],
    ['ada', personInfo({ legalName: 'Ada Brooks', preferredName: null, state: 'TX', status: 'active' })],
  ]);
  const members = [place('bo'), place('gone'), place('lea', 'lead')];
  const input = { team, members, requests: [pending], people };

  it('counts Active members only, and every lead toward keeping one', () => {
    expect(teamState(team, members, people)).toEqual({ team, activeMembers: 2, leads: 1 });
  });

  it('a member sees the roster of Active members and no requests; the link only once on the team', () => {
    const outsider = teamDetail({ ...input, viewer: { accountId: 'ada', admin: false } });
    expect(outsider).toMatchObject({ members: 2, leads: [{ accountId: 'lea', name: 'Lea Ortiz' }], waiting: null, requests: null });
    expect(outsider.mine).toEqual({ role: null, request: pending });
    expect(outsider.team.memberLink).toBeNull();
    expect(outsider.roster.map((p) => [p.name, p.role])).toEqual([
      ['Lea Ortiz', 'lead'],
      ['Bo', 'member'],
    ]);
    const bo = teamSummary({ ...input, viewer: { accountId: 'bo', admin: false } });
    expect(bo).toMatchObject({ mine: { role: 'member', request: null }, waiting: null, team: { memberLink: 'https://discord.gg/outreach' } });
  });

  it('a lead or a Membership Admin also sees who waits and who is no longer Active', () => {
    const led = teamDetail({ ...input, viewer: { accountId: 'lea', admin: false } });
    expect(led.waiting).toBe(1);
    expect(led.requests).toEqual([{ ...pending, name: 'Ada Brooks', state: 'TX', active: true }]);
    expect(led.roster.map((p) => [p.name, p.active])).toEqual([
      ['Lea Ortiz', true],
      ['Bo', true],
      ['Gone Away', false],
    ]);
    expect(teamDetail({ ...input, viewer: { accountId: 'ma', admin: true } }).roster).toHaveLength(3);
  });
});
