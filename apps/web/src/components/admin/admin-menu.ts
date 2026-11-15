import type { AdminSection } from 'ustp-domain';
import { SECTION_LABELS } from '../../governance/navigation-text.js';

/**
 * The admin console's side menu (design §10.1): its sections under a few headings, each with an icon. Which sections a
 * person sees is still the navigation settings' (§10.5); this only orders and groups them.
 */
export interface MenuGroup {
  readonly label: string;
  readonly sections: readonly AdminSection[];
}

/**
 * In menu order, which is also the order the console picks the first section in when the address names none: so a
 * Membership Admin opens on Applications, an Election Admin and an Auditor on Elections, a System or Site Admin on
 * Approvals, a Communications Admin on Communications and a Course Administrator on their course.
 */
export const MENU_GROUPS: readonly MenuGroup[] = [
  { label: 'Membership', sections: ['applications', 'members', 'inbox', 'registration', 'first_steps', 'photos', 'teams'] },
  { label: 'Elections', sections: ['elections', 'offices', 'candidacies', 'approvals', 'audit'] },
  { label: 'Community', sections: ['forum', 'room', 'course', 'bills'] },
  { label: 'Outreach', sections: ['communications', 'email', 'hub', 'quote'] },
  { label: 'System', sections: ['people', 'signin', 'security', 'claude', 'navigation', 'testing'] },
];

/** Material icon names (the font's ligatures). */
export const SECTION_ICONS: Readonly<Record<AdminSection, string>> = {
  applications: 'how_to_reg',
  members: 'badge',
  inbox: 'inbox',
  registration: 'app_registration',
  first_steps: 'checklist',
  photos: 'portrait',
  teams: 'groups',
  elections: 'how_to_vote',
  offices: 'account_balance',
  candidacies: 'emoji_people',
  approvals: 'approval',
  audit: 'receipt_long',
  forum: 'forum',
  room: 'chat',
  course: 'school',
  bills: 'gavel',
  communications: 'campaign',
  email: 'mail',
  hub: 'hub',
  quote: 'format_quote',
  people: 'manage_accounts',
  signin: 'login',
  security: 'shield',
  claude: 'key',
  navigation: 'toc',
  testing: 'science',
};

export interface MenuSection {
  readonly name: AdminSection;
  readonly label: string;
  readonly icon: string;
}

export interface ShownGroup {
  readonly label: string;
  readonly sections: readonly MenuSection[];
}

/** The groups as someone sees them: only their sections, in menu order, and no heading left without one. */
export function menuFor(shown: readonly AdminSection[]): ShownGroup[] {
  return MENU_GROUPS.map((g) => ({
    label: g.label,
    sections: g.sections.filter((s) => shown.includes(s)).map((name) => ({ name, label: SECTION_LABELS[name], icon: SECTION_ICONS[name] })),
  })).filter((g) => g.sections.length > 0);
}
