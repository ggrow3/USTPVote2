import { Injectable } from '@nestjs/common';
import { TeamRepository } from './team.repository.js';

/** A team as other contexts see it: its name, whether it is archived, and how many places it has. */
export interface RosterTeam {
  readonly teamId: string;
  readonly name: string;
  readonly archived: boolean;
  readonly members: number;
}

/**
 * The teams context's port for the others (design §3.3): which teams there are and who is on them, read only. The Bills
 * tool (§5.14) is given to the teams a System Admin names, so it asks here which teams someone is on.
 */
@Injectable()
export class TeamRoster {
  constructor(private readonly teams: TeamRepository) {}

  /** Every team, archived ones too, with how many places each has (whoever holds them), by name. */
  async all(): Promise<RosterTeam[]> {
    const [teams, places] = await Promise.all([this.teams.all(), this.teams.placesOn()]);
    const count = new Map<string, number>();
    for (const p of places) count.set(p.teamId, (count.get(p.teamId) ?? 0) + 1);
    return teams
      .map((t) => ({ teamId: t.teamId, name: t.name, archived: t.archived, members: count.get(t.teamId) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  /** The IDs of the teams an account has a place on, as a member or a lead. */
  async teamIdsOf(accountId: string): Promise<string[]> {
    return (await this.teams.placesOf(accountId)).map((p) => p.teamId);
  }
}
