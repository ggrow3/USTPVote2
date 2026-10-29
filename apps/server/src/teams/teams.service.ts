import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  addMember,
  archiveTeam,
  changeMember,
  checkActiveMember,
  createTeam,
  decideRequest,
  joinTeam,
  leaveTeam,
  personInfo,
  teamDetail,
  teamState,
  teamSummary,
  updateTeam,
  visibleToMembers,
  withdrawRequest,
  type CreateTeamInput,
  type JoinTeamInput,
  type LedgerEvent,
  type TeamActor,
  type TeamDetail,
  type TeamMemberInput,
  type TeamMemberRecord,
  type TeamPersonInfo,
  type TeamRecord,
  type TeamRequestDecisionInput,
  type TeamRequestRecord,
  type TeamSettings,
  type TeamState,
  type TeamSummary,
} from 'ustp-domain';
import { accepted, assertCheck } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { MemberDirectory } from '../membership/member-directory.js';
import { TeamRepository } from './team.repository.js';

/** Who acts on a team: a member at the Teams page, or a Membership Admin at the admin console (design §5.7). */
export interface TeamCaller {
  readonly accountId: string;
  readonly admin: boolean;
}

/** A team as a change reads it, in its transaction. */
interface Loaded {
  readonly team: TeamRecord | null;
  readonly places: readonly TeamMemberRecord[];
  readonly people: ReadonlyMap<string, TeamPersonInfo>;
  readonly state: TeamState;
  readonly actor: TeamActor;
}

/**
 * Teams (design §5.7). Members see and join teams and leads run them through `/v1/teams`; Membership Admins create,
 * rename and archive them and name their leads through `/v1/admin/teams`. Every change is ledgered in the transaction
 * that makes it; a request to join is not, until it is approved.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly firebase: Firebase,
    private readonly teams: TeamRepository,
    private readonly ledger: LedgerService,
    private readonly members: MemberDirectory,
  ) {}

  /** Every team: for a member, those not archived; for a Membership Admin, all. */
  async list(viewer: TeamCaller): Promise<TeamSummary[]> {
    if (!viewer.admin) await this.assertActive(viewer.accountId);
    const [teams, places, pending, mine] = await Promise.all([
      this.teams.all(),
      this.teams.placesOn(),
      this.teams.pending(),
      this.teams.requestsBy(viewer.accountId),
    ]);
    const people = await this.people(places.map((p) => p.accountId));
    const requests = [...pending, ...mine.filter((r) => r.status !== 'pending')];
    return teams
      .filter((team) => viewer.admin || visibleToMembers(team))
      .map((team) =>
        teamSummary({
          team,
          members: places.filter((p) => p.teamId === team.teamId),
          requests: requests.filter((r) => r.teamId === team.teamId),
          people,
          viewer,
        }),
      )
      .sort((a, b) => Number(a.team.archived) - Number(b.team.archived) || a.team.name.localeCompare(b.team.name));
  }

  /** One team with who is on it, and for its leads and Membership Admins, who is waiting to join. */
  async detail(teamId: string, viewer: TeamCaller): Promise<TeamDetail> {
    if (!viewer.admin) await this.assertActive(viewer.accountId);
    const team = await this.teams.find(teamId);
    if (!team || !(viewer.admin || visibleToMembers(team))) throw new NotFoundException('no such team');
    const [places, requests] = await Promise.all([this.teams.placesOn(teamId), this.teams.requestsTo(teamId)]);
    const people = await this.people([...places, ...requests].map((p) => p.accountId));
    return teamDetail({ team, members: places, requests, people, viewer });
  }

  /** A new team, led by an Active member (Membership Admins). */
  async create(caller: TeamCaller, input: CreateTeamInput): Promise<TeamDetail> {
    await this.firebase.db.runTransaction(async (tx) => {
      const [existing, [lead]] = await Promise.all([this.teams.get(tx, input.teamId), this.members.getAll(tx, [input.leadAccountId])]);
      if (!personInfo(lead ?? null).active) throw new ConflictException('the lead must be an Active member');
      const at = new Date().toISOString();
      const { team, lead: place, events } = accepted(createTeam(input, existing, caller.accountId, at));
      await this.ledger.record(tx, events);
      this.teams.createTeam(tx, team);
      this.teams.setPlace(tx, place);
    });
    return this.detail(input.teamId, caller);
  }

  /** Changes a team's settings: a Membership Admin any of them, a lead all but the name. */
  async update(caller: TeamCaller, teamId: string, settings: Omit<TeamSettings, 'name'> & { name?: string }, basedOn: number) {
    await this.change(caller, teamId, [], async (tx, loaded) => {
      const named = { ...settings, name: settings.name ?? loaded.team?.name ?? '' };
      const { team, event } = accepted(updateTeam(loaded.team, named, basedOn, loaded.actor, new Date().toISOString()));
      if (!event) return;
      await this.ledger.record(tx, [event]);
      this.teams.setTeam(tx, team);
    });
    return this.detail(teamId, caller);
  }

  /** Archives or restores a team (Membership Admins). */
  async archive(caller: TeamCaller, teamId: string, archived: boolean): Promise<TeamDetail> {
    await this.change(caller, teamId, [], async (tx, { team: current }) => {
      const { team, event } = accepted(archiveTeam(current, archived, caller.accountId, new Date().toISOString()));
      await this.ledger.record(tx, [event]);
      this.teams.setTeam(tx, team);
    });
    return this.detail(teamId, caller);
  }

  /** Joins an open team, or asks to join one whose leads decide. */
  async join(caller: TeamCaller, teamId: string, input: JoinTeamInput): Promise<TeamDetail> {
    await this.change(caller, teamId, [], async (tx, loaded) => {
      const current = await this.teams.getRequest(tx, teamId, caller.accountId);
      const at = new Date().toISOString();
      const outcome = accepted(joinTeam(loaded.state, loaded.actor, current, input, at));
      if ('request' in outcome) {
        this.teams.setRequest(tx, outcome.request);
        return;
      }
      await this.place(tx, outcome.member, [outcome.event], current, at);
    });
    return this.detail(teamId, caller);
  }

  /** Withdraws the caller's own request to join. */
  async withdraw(caller: TeamCaller, teamId: string): Promise<TeamDetail> {
    await this.change(caller, teamId, [], async (tx) => {
      const request = accepted(withdrawRequest(await this.teams.getRequest(tx, teamId, caller.accountId), new Date().toISOString()));
      this.teams.setRequest(tx, request);
    });
    return this.detail(teamId, caller);
  }

  /** A lead's or Membership Admin's decision on a request to join. */
  async decide(caller: TeamCaller, teamId: string, accountId: string, decision: TeamRequestDecisionInput): Promise<TeamDetail> {
    await this.change(caller, teamId, [accountId], async (tx, loaded) => {
      const current = await this.teams.getRequest(tx, teamId, accountId);
      const requesterActive = loaded.people.get(accountId)?.active ?? false;
      const at = new Date().toISOString();
      const { request, member, event } = accepted(decideRequest(loaded.state, loaded.actor, current, requesterActive, decision, at));
      if (event) await this.ledger.record(tx, [event]);
      this.teams.setRequest(tx, request);
      if (member) this.teams.setPlace(tx, member);
    });
    return this.detail(teamId, caller);
  }

  /** Leaves the team. */
  async leave(caller: TeamCaller, teamId: string): Promise<TeamDetail> {
    await this.change(caller, teamId, [], async (tx, loaded) => {
      const event = accepted(leaveTeam(loaded.state, loaded.actor));
      await this.ledger.record(tx, [event]);
      this.teams.deletePlace(tx, teamId, caller.accountId);
    });
    return this.detail(teamId, caller);
  }

  /** Removes someone, makes them a lead, or takes the lead from them (stepping down, when they are the caller). */
  async changeMember(
    caller: TeamCaller,
    teamId: string,
    accountId: string,
    change: 'remove' | 'make_lead' | 'make_member',
  ): Promise<TeamDetail> {
    await this.change(caller, teamId, [], async (tx, loaded) => {
      const target = loaded.places.find((p) => p.accountId === accountId) ?? null;
      const { member, event } = accepted(changeMember(loaded.state, loaded.actor, target, change));
      await this.ledger.record(tx, [event]);
      if (member) this.teams.setPlace(tx, member);
      else this.teams.deletePlace(tx, teamId, accountId);
    });
    return this.detail(teamId, caller);
  }

  /** Puts an Active member on the team in a role, or changes the role of someone on it (Membership Admins). */
  async addMember(caller: TeamCaller, teamId: string, input: TeamMemberInput): Promise<TeamDetail> {
    await this.change(caller, teamId, [input.accountId], async (tx, loaded) => {
      if (!loaded.people.get(input.accountId)?.active) throw new ConflictException('they are not an Active member');
      const current = loaded.places.find((p) => p.accountId === input.accountId) ?? null;
      const request = current ? null : await this.teams.getRequest(tx, teamId, input.accountId);
      const at = new Date().toISOString();
      const { member, event } = accepted(addMember(loaded.state, loaded.actor, current, input, at));
      await this.place(tx, member, [event], request, at);
    });
    return this.detail(teamId, caller);
  }

  /**
   * Gives someone their place on the team, closing a request they still had waiting (it is approved by whoever put
   * them on), so nobody is both on a team and waiting to join it.
   */
  private async place(tx: Transaction, member: TeamMemberRecord, events: LedgerEvent[], request: TeamRequestRecord | null, at: string) {
    await this.ledger.record(tx, events);
    this.teams.setPlace(tx, member);
    if (request?.status === 'pending') {
      this.teams.setRequest(tx, { ...request, status: 'approved', decidedAt: at, decidedBy: member.addedBy });
    }
  }

  /**
   * Runs a change to one team in a transaction, after reading the team, its places and the people on it (and `also`).
   * A member must still be Active to act; Membership Admins act as admins whatever their own membership.
   */
  private async change(
    caller: TeamCaller,
    teamId: string,
    also: readonly string[],
    act: (tx: Transaction, loaded: Loaded) => Promise<void>,
  ): Promise<void> {
    await this.firebase.db.runTransaction(async (tx) => {
      const [team, places] = await Promise.all([this.teams.get(tx, teamId), this.teams.placesIn(tx, teamId)]);
      if (!team || !(caller.admin || visibleToMembers(team))) throw new NotFoundException('no such team');
      const ids = [...new Set([...places.map((p) => p.accountId), caller.accountId, ...also])];
      const records = await this.members.getAll(tx, ids);
      const people = new Map(ids.map((id, i) => [id, personInfo(records[i] ?? null)]));
      if (!caller.admin) assertCheck(checkActiveMember(people.get(caller.accountId)?.active ? 'active' : null));
      const membership = places.find((p) => p.accountId === caller.accountId) ?? null;
      await act(tx, { team, places, people, state: teamState(team, places, people), actor: { ...caller, membership } });
    });
  }

  private async assertActive(accountId: string): Promise<void> {
    assertCheck(checkActiveMember((await this.members.find(accountId))?.status));
  }

  /** What the team pages show of each person, from their member records. */
  private async people(accountIds: readonly string[]): Promise<Map<string, TeamPersonInfo>> {
    const ids = [...new Set(accountIds)];
    const records = await this.members.findMany(ids);
    return new Map(ids.map((id, i) => [id, personInfo(records[i] ?? null)]));
  }
}
