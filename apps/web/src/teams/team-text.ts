import { DECLINED_RETRY_DAYS, type TeamColor, type TeamIcon, type TeamJoinPolicy, type TeamSettings, type TeamSummary } from 'ustp-domain';

/** Wording and colours for teams (design §5.7). */

/** Each team colour as a Quasar palette colour: dark enough for white icons and readable as text on white. */
export const COLOR_CLASSES: Readonly<Record<TeamColor, string>> = {
  blue: 'blue-8',
  teal: 'teal-8',
  green: 'green-8',
  amber: 'amber-9',
  orange: 'deep-orange-8',
  red: 'red-8',
  pink: 'pink-7',
  purple: 'purple-7',
  indigo: 'indigo-7',
  grey: 'blue-grey-7',
};

export const COLOR_LABELS: Readonly<Record<TeamColor, string>> = {
  blue: 'Blue',
  teal: 'Teal',
  green: 'Green',
  amber: 'Amber',
  orange: 'Orange',
  red: 'Red',
  pink: 'Pink',
  purple: 'Purple',
  indigo: 'Indigo',
  grey: 'Grey',
};

export const ICON_LABELS: Readonly<Record<TeamIcon, string>> = {
  groups: 'People',
  campaign: 'Megaphone',
  forum: 'Conversation',
  code: 'Code',
  brush: 'Brush',
  gavel: 'Gavel',
  school: 'Learning',
  science: 'Science',
  public: 'Globe',
  event: 'Calendar',
  volunteer_activism: 'Helping hand',
  handshake: 'Handshake',
  payments: 'Money',
  rocket_launch: 'Rocket',
};

export const POLICY_LABELS: Readonly<Record<TeamJoinPolicy, string>> = {
  open: 'Anyone can join',
  approval: 'Leads approve requests',
  closed: 'Not taking members',
};

export const POLICY_CAPTIONS: Readonly<Record<TeamJoinPolicy, string>> = {
  open: 'Any Active member joins at once.',
  approval: 'Members ask to join, answering the team’s question if it has one; a lead decides.',
  closed: 'Nobody can join or ask; a Membership Admin adds people.',
};

export const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** "4 members", "4 of 12 members". */
export function membersLine(summary: Pick<TeamSummary, 'members'> & { team: Pick<TeamSettings, 'capacity'> }): string {
  const { members, team } = summary;
  const noun = (team.capacity ?? members) === 1 ? 'member' : 'members';
  return team.capacity === null ? `${members} ${noun}` : `${members} of ${team.capacity} ${noun}`;
}

/** "Led by Lea Ortiz and Bo". */
export function leadsLine(summary: Pick<TeamSummary, 'leads'>): string {
  const names = summary.leads.map((l) => l.name);
  if (!names.length) return 'No lead';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Led by ${list}`;
}

/** The viewer's standing with a team, for a chip on its card; null when they have none. */
export function standingLabel(summary: Pick<TeamSummary, 'mine'>): string | null {
  if (summary.mine.role === 'lead') return 'You lead this team';
  if (summary.mine.role === 'member') return 'You are a member';
  return summary.mine.request?.status === 'pending' ? 'You asked to join' : null;
}

/** When a declined member may ask again. */
export function retryDay(decidedAt: string): string {
  return day(new Date(Date.parse(decidedAt) + DECLINED_RETRY_DAYS * 86_400_000).toISOString());
}

/** Whether the team has room for one more Active member. */
export const hasRoom = (summary: Pick<TeamSummary, 'members'> & { team: Pick<TeamSettings, 'capacity'> }): boolean =>
  summary.team.capacity === null || summary.members < summary.team.capacity;

/** A new team's settings form, and a new team's ID from its name: "Field Outreach!" → "field-outreach". */
export const emptySettings = (): TeamSettings => ({
  name: '',
  description: '',
  joinPolicy: 'approval',
  joinQuestion: null,
  capacity: null,
  memberLink: null,
  color: 'blue',
  icon: 'groups',
});

export function slugFrom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}
