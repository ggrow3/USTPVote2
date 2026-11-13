import { Injectable } from '@nestjs/common';
import { Collections, ElectionCollections, ownTicks, type FirstStep, type FirstStepsView, type MemberRecord } from 'ustp-domain';
import { ForumActivity } from '../forum/forum-activity.js';
import { Firebase } from '../infra/firebase.js';
import { RoomEntry } from '../room/room-entry.js';
import { TeamRoster } from '../teams/team-roster.js';
import { FirstStepsRepository } from './first-steps.repository.js';

/** Documents read in one `getAll`. */
const GET_ALL_BATCH = 300;
/** Elections looked through for a member's first ballot, when the caller names none. */
const ELECTIONS_MAX = 500;

/**
 * What a member has done so far, each from the first record that says so (design §5.15, §5.16): cast a ballot, started
 * a course, joined a team, entered the members' room, posted in the forum. For the join funnel's counts and for a new
 * member's own list of first steps, with the steps Membership Admins set and those the member ticked themselves. What
 * belongs to another context (teams, the forum, the room) is asked of its port.
 */
@Injectable()
export class FirstStepsReader {
  constructor(
    private readonly firebase: Firebase,
    private readonly teams: TeamRoster,
    private readonly forum: ForumActivity,
    private readonly room: RoomEntry,
    private readonly list: FirstStepsRepository,
  ) {}

  /** `electionIds`: the elections they could have voted in, when the caller knows; else every election. */
  async done(accountId: string, electionIds?: readonly string[]): Promise<FirstStep[]> {
    const db = this.firebase.db;
    const course = async () => !(await db.collection(Collections.courseProgress).where('accountId', '==', accountId).limit(1).get()).empty;
    const voted = async () => {
      const ids = electionIds ?? (await db.collection(Collections.elections).select().limit(ELECTIONS_MAX).get()).docs.map((d) => d.id);
      for (let i = 0; i < ids.length; i += GET_ALL_BATCH) {
        const refs = ids.slice(i, i + GET_ALL_BATCH).map((id) => db.collection(Collections.elections).doc(id).collection(ElectionCollections.participation).doc(accountId));
        if ((await db.getAll(...refs)).some((snap) => snap.exists)) return true;
      }
      return false;
    };
    const [hasVoted, onCourse, teamIds, inRoom, posted] = await Promise.all([
      voted(),
      course(),
      this.teams.teamIdsOf(accountId),
      this.room.hasEntered(accountId),
      this.forum.hasPosted(accountId),
    ]);
    return [hasVoted && 'voted', onCourse && 'course', teamIds.length > 0 && 'team', inRoom && 'room', posted && 'posted'].filter(
      (step): step is FirstStep => typeof step === 'string',
    );
  }

  /** The member's own list: nothing for someone who is not an Active member, and no records read for an empty list. */
  async mine(accountId: string, member: MemberRecord | null): Promise<FirstStepsView> {
    if (member?.status !== 'active') return { memberSince: null, done: [], steps: [], ticked: [] };
    const settings = await this.list.settings();
    const memberSince = member.memberSince ?? member.statusChangedAt;
    if (!settings.steps.length) return { memberSince, done: [], steps: [], ticked: [] };
    const [done, ticked] = await Promise.all([this.done(accountId), this.list.ticks(accountId)]);
    return { memberSince, done, steps: settings.steps, ticked: ownTicks(settings, ticked) };
  }
}
