import { ADMIN_SECTIONS, type AdminSection } from 'ustp-domain';
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
 * In menu order, which is also the order the console picks the first section in when the address names none (after
 * any favourites): so a Membership Admin or a Site Admin opens on Applications, an Election Admin and an Auditor on
 * Elections, a System Admin on Approvals, a Communications Admin on Communications and a Course Administrator on their
 * course.
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

/** The heading over the sections someone has starred, above the rest. */
export const FAVOURITES = 'Favourites';

const menuSection = (name: AdminSection): MenuSection => ({ name, label: SECTION_LABELS[name], icon: SECTION_ICONS[name] });

/**
 * The groups as someone sees them: only their sections, in menu order, and no heading left without one. Their
 * favourites come first under their own heading, in the order they were starred, and leave their usual group, as the
 * Cloud console's pinned products do; a favourite they no longer see is left out but kept.
 */
export function menuFor(shown: readonly AdminSection[], favourites: readonly AdminSection[] = []): ShownGroup[] {
  const pinned = favourites.filter((s, i) => shown.includes(s) && favourites.indexOf(s) === i);
  const groups = MENU_GROUPS.map((g) => ({
    label: g.label,
    sections: g.sections.filter((s) => shown.includes(s) && !pinned.includes(s)).map(menuSection),
  }));
  return [{ label: FAVOURITES, sections: pinned.map(menuSection) }, ...groups].filter((g) => g.sections.length > 0);
}

/** Starring a section adds it to the end of the favourites; starring it again takes it off. */
export function toggleFavourite(favourites: readonly AdminSection[], section: AdminSection): AdminSection[] {
  return favourites.includes(section) ? favourites.filter((s) => s !== section) : [...favourites, section];
}

/**
 * Favourites are kept in this browser, per account (as the ballot list's "Show finished votes" is, design §10.5):
 * nothing is sent anywhere, and someone else signing in on the same browser has their own.
 */
const favouritesKey = (accountId: string) => `ustp-admin-favourites:${accountId}`;

/** Favourites as stored: known sections only, each once; none where the browser keeps nothing or the value is not ours. */
export function readFavourites(accountId: string | null): AdminSection[] {
  if (!accountId) return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(favouritesKey(accountId)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const known = raw.filter((s): s is AdminSection => typeof s === 'string' && (ADMIN_SECTIONS as readonly string[]).includes(s));
    return known.filter((s, i) => known.indexOf(s) === i);
  } catch {
    return [];
  }
}

export function saveFavourites(accountId: string | null, favourites: readonly AdminSection[]): void {
  if (!accountId) return;
  try {
    if (favourites.length) localStorage.setItem(favouritesKey(accountId), JSON.stringify(favourites));
    else localStorage.removeItem(favouritesKey(accountId));
  } catch {
    // A private window or blocked storage: the stars still work until the page is left.
  }
}
