import {
  ROLES,
  SECTION_ROLES,
  type AdminSection,
  type Audience,
  type CellLock,
  type MenuLink,
  type NavigationChange,
  type Role,
  type StartPage,
} from 'ustp-domain';
import { roleLabel } from '../approval-text.js';

/** Wording for the navigation settings (design §10.5): the matrix's headers, its cells' names and its changes. */

export const AUDIENCE_LABELS: Readonly<Record<Audience, string>> = {
  signed_out: 'Signed out',
  no_membership: 'No membership',
  applicant: 'Applicant',
  active: 'Active member',
  lapsed: 'Lapsed',
  suspended: 'Suspended',
  resigned: 'Resigned',
  rejected: 'Rejected',
  ...(Object.fromEntries(ROLES.map((r) => [r, roleLabel(r)])) as Record<Role, string>),
};

/** One line under each column's name. */
export const AUDIENCE_CAPTIONS: Readonly<Record<Audience, string>> = {
  signed_out: 'Visitors',
  no_membership: 'Signed in, never applied',
  applicant: 'Applied, not yet decided',
  active: 'On voter rolls',
  lapsed: 'A Membership Admin renews',
  suspended: 'Until reinstated',
  resigned: 'May apply again',
  rejected: 'May apply again',
  membership_admin: 'Applications, members',
  election_admin: 'Elections, offices',
  auditor: 'Approvals, the ledger',
  system_admin: 'Roles, settings',
  course_admin: 'Course content',
  communications_admin: 'News, press, social',
};

export const MENU_LABELS: Readonly<Record<MenuLink, string>> = {
  register: 'Register',
  ballot: 'Ballot',
  verify: 'Verify',
  offices: 'Offices',
  candidates: 'Candidates',
  teams: 'Teams',
  forum: 'Forum',
  room: 'Room',
  news: 'News',
  course: 'Courses',
  admin: 'Admin',
  signin: 'Sign in',
};

export const MENU_CAPTIONS: Readonly<Record<MenuLink, string>> = {
  register: 'Create a login and apply; the application and membership status',
  ballot: 'Cast votes, see results',
  verify: 'Check a vote receipt',
  offices: 'The public page of who holds each office',
  candidates: 'Members running for public office, on a map; members declare theirs',
  teams: 'Join a team, see who is on each; leads run theirs (Active members only)',
  forum: 'Discuss and propose, vote posts up or down (Active members only)',
  room: 'The members’ chat room and its assistant, after accepting its terms (Active members only)',
  news: 'News and press releases, the press kit, the share kit and the suggestions form',
  course: 'The course map: public lessons, quizzes and a certificate for each course',
  admin: 'The admin console',
  signin: "The header's button, for visitors",
};

/** The admin console's tab names. */
export const SECTION_LABELS: Readonly<Record<AdminSection, string>> = {
  applications: 'Applications',
  members: 'Members',
  photos: 'Photos',
  bylaws: 'Bylaws',
  registration: 'Registration form',
  elections: 'Elections',
  offices: 'Offices',
  candidacies: 'Candidacies',
  teams: 'Teams',
  forum: 'Forum',
  room: 'Members’ room',
  approvals: 'Approvals',
  people: 'People',
  signin: 'Sign-in methods',
  claude: 'Claude',
  email: 'Election emails',
  audit: 'Audit ledger',
  security: 'Security',
  testing: 'Testing',
  navigation: 'Navigation',
  hub: 'Link hub',
  communications: 'Communications',
  quote: 'Home page quote',
  course: 'Course administration',
};

export const SECTION_CAPTIONS: Readonly<Record<AdminSection, string>> = {
  applications: 'Approve or reject applications to join',
  members: 'Find members, change status, correct details',
  photos: 'Review flagged profile photos',
  bylaws: 'Draft, check and publish the bylaws',
  registration: "The Register page's intro, questions and Core Ideals",
  elections: 'Set up elections, rolls and results',
  offices: 'Offices and who holds them',
  candidacies: 'Review members’ candidacies for public office',
  teams: 'Create, rename and archive teams; name their leads',
  forum: 'Reports and moderation; proposals to put on ballots',
  room: 'Open or close the members’ room; switch its model server on or off',
  approvals: 'Two-person requests waiting for a decision',
  people: 'Accounts and their roles; change roles',
  signin: 'Switch sign-in methods on or off; require two-step verification',
  claude: 'The Anthropic API key for the Claude checks',
  email: 'Which emails go to voters, when, and their wording',
  audit: 'Read and verify the audit ledger',
  security: 'Sign-ins with their addresses; Google Analytics',
  testing: 'Test personas, where testing mode is on',
  navigation: 'Who sees which link (this page)',
  hub: "The home page's links, profile and Discord card, and their clicks",
  communications: 'News, the share kit, the social media calendar, suggestions, the press kit and bots',
  quote: 'Change the quote on the home page, or switch it off',
  course: 'Add courses and place them on the map; write and publish their lessons, quizzes and profiles; see how students stand and switch their messages',
};

/** "Ballot", "Admin › Elections". */
export function startPageLabel(page: StartPage): string {
  if (page === 'home') return 'Voting home';
  if (page === 'account') return 'Account';
  if (page.startsWith('admin/')) return `Admin › ${SECTION_LABELS[page.slice(6) as AdminSection]}`;
  return MENU_LABELS[page as MenuLink];
}

/**
 * A cell's accessible name, worded as its change is: "Show Ballot to Applicant", "Show Admin › Offices to Auditor" (the
 * Offices link and the Offices section are both rows).
 */
export function cellName(item: MenuLink | AdminSection, audience: Audience, kind: 'link' | 'section'): string {
  const label = kind === 'link' ? MENU_LABELS[item as MenuLink] : `Admin › ${SECTION_LABELS[item as AdminSection]}`;
  return `Show ${label} to ${AUDIENCE_LABELS[audience]}`;
}

const plural = (role: Role) => `${roleLabel(role)}s`;

/** What a locked cell holds and why it cannot be switched, for its tooltip and for screen readers. */
export function lockText(lock: CellLock, audience: Audience, section?: AdminSection, shown?: boolean): string {
  switch (lock) {
    case 'no_role':
      return 'Not available: staff roles only';
    case 'not_permitted': {
      const allowed = section ? SECTION_ROLES[section].map(plural).join(' and ') : '';
      return `Not available: only ${allowed} may use this`;
    }
    case 'guarded':
      return 'Always shown, so System Admins cannot be locked out';
    case 'follows_sections':
      return shown
        ? `Shown while ${plural(audience as Role)} have any admin section`
        : `Hidden while ${plural(audience as Role)} have no admin section`;
    case 'signed_in':
      return 'Not applicable: already signed in';
  }
}

/** One unsaved change in words: "Hide Ballot from Applicant", "Active member starts on Ballot". */
export function describeChange(change: NavigationChange): string {
  const who = AUDIENCE_LABELS[change.audience];
  if ('startsOn' in change) return `${who} starts on ${startPageLabel(change.startsOn)}`;
  const what = 'link' in change ? MENU_LABELS[change.link] : `Admin › ${SECTION_LABELS[change.section]}`;
  return change.shown ? `Show ${what} to ${who}` : `Hide ${what} from ${who}`;
}
