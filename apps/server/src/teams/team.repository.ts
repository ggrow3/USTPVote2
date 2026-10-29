import { Injectable } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { Collections, teamMemberId, type TeamMemberRecord, type TeamRecord, type TeamRequestRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * Storage of teams (design §5.7, §11): `teams`, `team_members` and `team_requests`. Only the teams context uses it.
 * Queries are on one field each, so they need no composite index; results are sorted by the caller.
 */
@Injectable()
export class TeamRepository {
  constructor(private readonly firebase: Firebase) {}

  private teams() {
    return this.firebase.db.collection(Collections.teams);
  }

  private places() {
    return this.firebase.db.collection(Collections.teamMembers);
  }

  private requests() {
    return this.firebase.db.collection(Collections.teamRequests);
  }

  async all(): Promise<TeamRecord[]> {
    return (await this.teams().get()).docs.map((d) => d.data() as TeamRecord);
  }

  async find(teamId: string): Promise<TeamRecord | null> {
    return ((await this.teams().doc(teamId).get()).data() as TeamRecord | undefined) ?? null;
  }

  async get(tx: Transaction, teamId: string): Promise<TeamRecord | null> {
    return ((await tx.get(this.teams().doc(teamId))).data() as TeamRecord | undefined) ?? null;
  }

  /** Every place on every team, or on one. */
  async placesOn(teamId?: string): Promise<TeamMemberRecord[]> {
    const query = teamId === undefined ? this.places() : this.places().where('teamId', '==', teamId);
    return (await query.get()).docs.map((d) => d.data() as TeamMemberRecord);
  }

  /** The team's places, read in `tx`. */
  async placesIn(tx: Transaction, teamId: string): Promise<TeamMemberRecord[]> {
    return (await tx.get(this.places().where('teamId', '==', teamId))).docs.map((d) => d.data() as TeamMemberRecord);
  }

  /** Every request to join the team, whatever its status. */
  async requestsTo(teamId: string): Promise<TeamRequestRecord[]> {
    return (await this.requests().where('teamId', '==', teamId).get()).docs.map((d) => d.data() as TeamRequestRecord);
  }

  /** Every request waiting for a decision, on any team. */
  async pending(): Promise<TeamRequestRecord[]> {
    return (await this.requests().where('status', '==', 'pending').get()).docs.map((d) => d.data() as TeamRequestRecord);
  }

  /** Every request the member made, to any team. */
  async requestsBy(accountId: string): Promise<TeamRequestRecord[]> {
    return (await this.requests().where('accountId', '==', accountId).get()).docs.map((d) => d.data() as TeamRequestRecord);
  }

  async getRequest(tx: Transaction, teamId: string, accountId: string): Promise<TeamRequestRecord | null> {
    return ((await tx.get(this.requests().doc(teamMemberId(teamId, accountId)))).data() as TeamRequestRecord | undefined) ?? null;
  }

  createTeam(tx: Transaction, team: TeamRecord): void {
    tx.create(this.teams().doc(team.teamId), team);
  }

  setTeam(tx: Transaction, team: TeamRecord): void {
    tx.set(this.teams().doc(team.teamId), team);
  }

  setPlace(tx: Transaction, place: TeamMemberRecord): void {
    tx.set(this.places().doc(teamMemberId(place.teamId, place.accountId)), place);
  }

  deletePlace(tx: Transaction, teamId: string, accountId: string): void {
    tx.delete(this.places().doc(teamMemberId(teamId, accountId)));
  }

  setRequest(tx: Transaction, request: TeamRequestRecord): void {
    tx.set(this.requests().doc(teamMemberId(request.teamId, request.accountId)), request);
  }
}
