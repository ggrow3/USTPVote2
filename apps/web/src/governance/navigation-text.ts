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
};

export const MENU_LABELS: Readonly<Record<MenuLink, string>> = {
  register: 'Register',
  ballot: 'Ballot',
  verify: 'Verify',
  admin: 'Admin',
  signin: 'Sign in',
};

export const MENU_CAPTIONS: Readonly<Record<MenuLink, string>> = {
  register: 'Create a login and apply; the application and membership status',
  ballot: 'Cast votes, see results',
  verify: 'Check a vote receipt',
  admin: 'The admin console',
  signin: "The header's button, for visitors",
};

/** The admin console's tab names. */
export const SECTION_LABELS: Readonly<Record<AdminSection, string>> = {
  applications: 'Applications',
  members: 'Members',
  photos: 'Photos',
  bylaws: 'Bylaws',
  elections: 'Elections',
  offices: 'Offices',
  approvals: 'Approvals',
  people: 'People',
  signin: 'Sign-in methods',
  claude: 'Claude',
  email: 'Election emails',
  audit: 'Audit ledger',
  testing: 'Testing',
  navigation: 'Navigation',
};

export const SECTION_CAPTIONS: Readonly<Record<AdminSection, string>> = {
  applications: 'Approve or reject applications to join',
  members: 'Find members, change status, correct details',
  photos: 'Review flagged profile photos',
  bylaws: 'Draft, check and publish the bylaws',
  elections: 'Set up elections, rolls and results',
  offices: 'Offices and who holds them',
  approvals: 'Two-person requests waiting for a decision',
  people: 'Accounts and their roles; change roles',
  signin: 'Switch sign-in methods on or off',
  claude: 'The Anthropic API key for the Claude checks',
  email: 'Which emails go to voters, when, and their wording',
  audit: 'Read and verify the audit ledger',
  testing: 'Test personas, where testing mode is on',
  navigation: 'Who sees which link (this page)',
};

/** "Ballot", "Admin › Elections". */
export function startPageLabel(page: StartPage): string {
  if (page === 'home') return 'Home';
  if (page === 'account') return 'Account';
  if (page.startsWith('admin/')) return `Admin › ${SECTION_LABELS[page.slice(6) as AdminSection]}`;
  return MENU_LABELS[page as MenuLink];
}

/** A cell's accessible name: "Show Ballot to Applicant". */
export function cellName(item: MenuLink | AdminSection, audience: Audience, kind: 'link' | 'section'): string {
  const label = kind === 'link' ? MENU_LABELS[item as MenuLink] : SECTION_LABELS[item as AdminSection];
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
