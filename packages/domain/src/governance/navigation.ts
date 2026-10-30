import { z } from 'zod';
import { deny, OK, refuse, type Check } from '../check.js';
import { MEMBER_STATUSES, type MemberStatus } from '../membership/member-status.js';
import { ROLES, type Role } from '../roles.js';

/**
 * What the web app shows each person (design §10.5): the main-menu links and admin console sections each membership
 * state and staff role sees, and the page each lands on. It decides what is shown, never what is allowed: the API's
 * role checks stay as they are, and a section a role may not use stays hidden from it.
 */

/** The menu bar's links in menu order, then the header's Sign in button (which only signed-out visitors can use). */
export const MENU_LINKS = ['register', 'ballot', 'verify', 'offices', 'candidates', 'teams', 'forum', 'room', 'news', 'course', 'admin', 'signin'] as const;
export type MenuLink = (typeof MENU_LINKS)[number];

/** The admin console's sections (tabs), in tab order. */
export const ADMIN_SECTIONS = [
  'applications',
  'members',
  'photos',
  'bylaws',
  'registration',
  'elections',
  'offices',
  'candidacies',
  'teams',
  'forum',
  'room',
  'approvals',
  'people',
  'signin',
  'claude',
  'email',
  'audit',
  'security',
  'testing',
  'navigation',
  'communications',
  'hub',
  'quote',
  'course',
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** Where someone is in joining: signed out, signed in with no member record, or their member status. */
export const MEMBERSHIP_AUDIENCES = ['signed_out', 'no_membership', ...MEMBER_STATUSES] as const;
export type MembershipAudience = (typeof MEMBERSHIP_AUDIENCES)[number];

/** Every column of the settings: membership states, then the staff roles a person holds on top of one. */
export const AUDIENCES = [...MEMBERSHIP_AUDIENCES, ...ROLES] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Audiences that sign in, and so have a page they start on. Signed-out visitors always start on the public home. */
export type SignedInAudience = Exclude<Audience, 'signed_out'>;
export const SIGNED_IN_AUDIENCES = AUDIENCES.filter((a): a is SignedInAudience => a !== 'signed_out');

/**
 * The roles the API lets use each section (its `@Roles` on the routes the section calls; design §10.1, §12). A section
 * is never shown to another role: those cells are locked off.
 */
export const SECTION_ROLES: Readonly<Record<AdminSection, readonly Role[]>> = {
  applications: ['membership_admin'],
  members: ['membership_admin'],
  photos: ['membership_admin'],
  bylaws: ['membership_admin'],
  // The registration form's wording: its intro and questions (design §5.2).
  registration: ['membership_admin'],
  elections: ['election_admin', 'auditor'],
  // Every admin may read the offices; Membership and Election Admins change them.
  offices: ROLES,
  // Reviewing members' candidacies for public office before they are public (design §5.8).
  candidacies: ['membership_admin'],
  // Creating, renaming and archiving teams and naming their leads (design §5.7).
  teams: ['membership_admin'],
  // Moderating the forum, and reading it to put proposals on ballots (design §5.9).
  forum: ['membership_admin', 'election_admin'],
  // The members' room's switches: open or closed (Membership and System Admins), its model server on or off (System
  // Admins; design §5.10).
  room: ['membership_admin', 'system_admin'],
  approvals: ROLES,
  people: ['system_admin'],
  signin: ['system_admin'],
  claude: ['system_admin'],
  // The election emails' settings (design §6.8).
  email: ['system_admin'],
  audit: ['auditor'],
  // The sign-in log and site analytics (design §10.7): System Admins and Auditors read the log; System Admins set analytics.
  security: ['system_admin', 'auditor'],
  testing: ['system_admin'],
  navigation: ['system_admin'],
  // The home page hub: System Admins, and Communications Admins, since its links are the party's social accounts.
  hub: ['system_admin', 'communications_admin'],
  // News, the press kit, the share kit, the social media calendar, suggestions and bots (design §10.9).
  communications: ['communications_admin'],
  quote: ['system_admin'],
  course: ['course_admin'],
};

/** Links that lead a signed-out visitor to sign in: Sign in itself, Register (its first step), and Ballot and Admin. */
export const SIGN_IN_WAYS: readonly MenuLink[] = ['signin', 'register', 'ballot', 'admin'];

/**
 * Sections System Admins always see: these settings and People (where roles change). Without them nobody could give
 * System Admins their tools back.
 */
export const GUARDED_SECTIONS: readonly AdminSection[] = ['people', 'navigation'];

/** A page someone can start on: home, their account, a menu page, or an admin section. */
export type StartPage = 'home' | 'account' | Exclude<MenuLink, 'admin' | 'signin'> | `admin/${AdminSection}`;
export const START_PAGES: readonly StartPage[] = [
  'home',
  'account',
  'register',
  'ballot',
  'verify',
  'offices',
  'candidates',
  'teams',
  'forum',
  'room',
  'news',
  'course',
  ...ADMIN_SECTIONS.map((s) => `admin/${s}` as const),
];

export interface NavigationSettings {
  /** Whether each audience sees each menu link. A role's Admin link follows its sections (shown while any is). */
  readonly menu: Readonly<Record<Audience, Readonly<Record<MenuLink, boolean>>>>;
  /** Whether each role sees each admin section. Only roles have sections: a membership state alone has none. */
  readonly sections: Readonly<Record<Role, Readonly<Record<AdminSection, boolean>>>>;
  /** The page each signed-in audience lands on after signing in, and when a browser tab first opens the app. */
  readonly startsOn: Readonly<Record<SignedInAudience, StartPage>>;
}

/** `navigation/current`; version 0 (never saved) is the defaults. */
export interface NavigationRecord extends NavigationSettings {
  /** Counts saves, so an edit made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** `GET /v1/navigation`: what everyone's web app follows, without who changed it. */
export type PublicNavigation = NavigationSettings & { readonly version: number };

/** Why a cell cannot be switched. */
export type CellLock =
  /** No staff role, so no admin section: always hidden. */
  | 'no_role'
  /** The API refuses the section to this role: always hidden. */
  | 'not_permitted'
  /** The lock-out guard: always shown. */
  | 'guarded'
  /** A role's Admin link: shown while the role has any section. */
  | 'follows_sections'
  /** Sign in, for someone already signed in: always hidden. */
  | 'signed_in';

const isRole = (audience: Audience): audience is Role => (ROLES as readonly string[]).includes(audience);

export function menuLock(audience: Audience, link: MenuLink): CellLock | null {
  if (link === 'signin') return audience === 'signed_out' ? null : 'signed_in';
  return link === 'admin' && isRole(audience) ? 'follows_sections' : null;
}

export function sectionLock(audience: Audience, section: AdminSection): CellLock | null {
  if (!isRole(audience)) return 'no_role';
  if (!SECTION_ROLES[section].includes(audience)) return 'not_permitted';
  return audience === 'system_admin' && GUARDED_SECTIONS.includes(section) ? 'guarded' : null;
}

const links = (...shown: MenuLink[]) => Object.fromEntries(MENU_LINKS.map((l) => [l, shown.includes(l)])) as Record<MenuLink, boolean>;
const sectionsOf = (role: Role) =>
  Object.fromEntries(ADMIN_SECTIONS.map((s) => [s, defaultSection(role, s)])) as Record<AdminSection, boolean>;

/**
 * Today's console: each role sees what it may use, except Offices for System Admins (they may read it, not change it),
 * only Course for Course Admins, and only Communications and the Link hub for Communications Admins (both may read
 * Offices and Approvals, but have nothing to do there).
 */
function defaultSection(role: Role, section: AdminSection): boolean {
  if (role === 'course_admin') return section === 'course';
  if (role === 'communications_admin') return section === 'communications' || section === 'hub';
  return SECTION_ROLES[section].includes(role) && !(section === 'offices' && role === 'system_admin');
}

/**
 * The menu as it was before these settings (design §5.2): Register, Ballot, Verify and Admin for everyone, each page
 * explaining itself to people it is not for, and Sign in while signed out; admin sections by role. Offices, the public
 * list of who holds each office, came later and is for everyone too, as is Candidates (members running for public
 * office, design §5.8). Roles add Ballot, Verify, Offices and Candidates, so a staff member with no membership keeps
 * them, and Admin (from their sections). Signing in lands on Register with no membership, as it did, and on the home
 * page otherwise. Teams, the forum and the members' room are for Active members only (design §5.7, §5.9, §5.10); News is for everyone (design §10.9).
 */
export const DEFAULT_NAVIGATION: NavigationSettings = {
  menu: Object.fromEntries(
    AUDIENCES.map((a) => [
      a,
      isRole(a)
        ? links('ballot', 'verify', 'offices', 'candidates', 'news', 'course', 'admin')
        : a === 'signed_out'
          ? links('register', 'ballot', 'verify', 'offices', 'candidates', 'news', 'course', 'admin', 'signin')
          : a === 'active'
            ? links('register', 'ballot', 'verify', 'offices', 'candidates', 'teams', 'forum', 'room', 'news', 'course', 'admin')
            : links('register', 'ballot', 'verify', 'offices', 'candidates', 'news', 'course', 'admin'),
    ]),
  ) as Record<Audience, Record<MenuLink, boolean>>,
  sections: Object.fromEntries(ROLES.map((r) => [r, sectionsOf(r)])) as Record<Role, Record<AdminSection, boolean>>,
  startsOn: Object.fromEntries(SIGNED_IN_AUDIENCES.map((a) => [a, a === 'no_membership' ? 'register' : 'home'])) as Record<
    SignedInAudience,
    StartPage
  >,
};

/** The pages an audience may start on: home, account, and the menu pages and sections it sees. */
export function startPageOptions(settings: NavigationSettings, audience: SignedInAudience): StartPage[] {
  return START_PAGES.filter((page) => {
    if (page === 'home' || page === 'account') return true;
    if (page.startsWith('admin/')) return isRole(audience) && settings.sections[audience][page.slice(6) as AdminSection];
    return settings.menu[audience][page as MenuLink];
  });
}

type Stored = {
  readonly menu?: Partial<Record<string, Partial<Record<string, unknown>>>>;
  readonly sections?: Partial<Record<string, Partial<Record<string, unknown>>>>;
  readonly startsOn?: Partial<Record<string, unknown>>;
};

/**
 * The settings in force from what was saved: defaults for anything missing (a link or section added since, say), locked
 * cells at their locked value, and a start page the audience no longer sees replaced by its default, or home.
 */
export function resolveNavigation(stored: Stored | null | undefined): NavigationSettings {
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const sections = Object.fromEntries(
    ROLES.map((role) => [
      role,
      Object.fromEntries(
        ADMIN_SECTIONS.map((s) => {
          const lock = sectionLock(role, s);
          const shown = lock === 'guarded' ? true : lock ? false : flag(stored?.sections?.[role]?.[s], DEFAULT_NAVIGATION.sections[role][s]);
          return [s, shown];
        }),
      ),
    ]),
  ) as Record<Role, Record<AdminSection, boolean>>;
  const menu = Object.fromEntries(
    AUDIENCES.map((a) => [
      a,
      Object.fromEntries(
        MENU_LINKS.map((l) => {
          const lock = menuLock(a, l);
          if (lock === 'follows_sections') return [l, Object.values(sections[a as Role]).some(Boolean)];
          return [l, lock === 'signed_in' ? false : flag(stored?.menu?.[a]?.[l], DEFAULT_NAVIGATION.menu[a][l])];
        }),
      ),
    ]),
  ) as Record<Audience, Record<MenuLink, boolean>>;
  const partial: NavigationSettings = { menu, sections, startsOn: DEFAULT_NAVIGATION.startsOn };
  const startsOn = Object.fromEntries(
    SIGNED_IN_AUDIENCES.map((a) => {
      const options = startPageOptions(partial, a);
      const saved = stored?.startsOn?.[a];
      const fallback = options.includes(DEFAULT_NAVIGATION.startsOn[a]) ? DEFAULT_NAVIGATION.startsOn[a] : 'home';
      return [a, options.includes(saved as StartPage) ? saved : fallback];
    }),
  ) as Record<SignedInAudience, StartPage>;
  return { menu, sections, startsOn };
}

/**
 * Whether settings can be saved as sent: no section for a role the API refuses it to, no guarded section hidden from
 * System Admins, Sign in only for visitors and always some way for them to sign in, and every start page one its
 * audience sees. A role's Admin link is recomputed, not checked.
 */
export function checkNavigationSettings(settings: NavigationSettings): Check {
  for (const a of AUDIENCES) {
    if (menuLock(a, 'signin') === 'signed_in' && settings.menu[a].signin) return deny(`signin cannot be shown to ${a}: they are signed in`);
  }
  if (!SIGN_IN_WAYS.some((l) => settings.menu.signed_out[l])) {
    return refuse('conflict', 'signed-out visitors need a way to sign in: show them Sign in, Register, Ballot or Admin');
  }
  for (const role of ROLES) {
    for (const s of ADMIN_SECTIONS) {
      const lock = sectionLock(role, s);
      if (lock === 'not_permitted' && settings.sections[role][s]) {
        return deny(`${s} cannot be shown to ${role}: the API does not let that role use it`);
      }
      if (lock === 'guarded' && !settings.sections[role][s]) {
        return refuse('conflict', `${s} stays shown to System Admins, so nobody can lock them out of roles and these settings`);
      }
    }
  }
  const resolved = resolveNavigation(settings);
  for (const a of SIGNED_IN_AUDIENCES) {
    if (!startPageOptions(resolved, a).includes(settings.startsOn[a])) {
      return deny(`${a} cannot start on ${settings.startsOn[a]}: it is not shown to them`);
    }
  }
  return OK;
}

/** One cell that changed, as the ledger records it (`navigation.changed`). */
export type NavigationChange =
  | { readonly audience: Audience; readonly link: MenuLink; readonly shown: boolean }
  | { readonly audience: Role; readonly section: AdminSection; readonly shown: boolean }
  | { readonly audience: SignedInAudience; readonly startsOn: StartPage };

/** `navigation.changed`: the settings' new version and every cell that changed in it. */
export interface NavigationChangedPayload {
  readonly version: number;
  readonly changes: readonly NavigationChange[];
}

/** Every cell that differs between two resolved settings, in the matrix's order (menu, sections, start pages). */
export function navigationChanges(before: NavigationSettings, after: NavigationSettings): NavigationChange[] {
  return [
    ...AUDIENCES.flatMap((audience) =>
      MENU_LINKS.filter((l) => before.menu[audience][l] !== after.menu[audience][l]).map((link) => ({
        audience,
        link,
        shown: after.menu[audience][link],
      })),
    ),
    ...ROLES.flatMap((audience) =>
      ADMIN_SECTIONS.filter((s) => before.sections[audience][s] !== after.sections[audience][s]).map((section) => ({
        audience,
        section,
        shown: after.sections[audience][section],
      })),
    ),
    ...SIGNED_IN_AUDIENCES.filter((a) => before.startsOn[a] !== after.startsOn[a]).map((audience) => ({
      audience,
      startsOn: after.startsOn[audience],
    })),
  ];
}

/** Whoever is looking: their membership state (signed out, none, or a status) and the roles they hold. */
export interface Viewer {
  readonly membership: MembershipAudience;
  readonly roles: readonly Role[];
}

export function membershipAudience(signedIn: boolean, status: MemberStatus | null | undefined): MembershipAudience {
  if (!signedIn) return 'signed_out';
  return status ?? 'no_membership';
}

/** The audiences a viewer belongs to: their membership state, then each role they hold (none while signed out). */
function audiencesOf(viewer: Viewer): Audience[] {
  return viewer.membership === 'signed_out' ? ['signed_out'] : [viewer.membership, ...ROLES.filter((r) => viewer.roles.includes(r))];
}

/** What a viewer sees: everything any of their audiences sees (roles add to what membership shows, never take away). */
export function shownTo(settings: NavigationSettings, viewer: Viewer): { menu: MenuLink[]; sections: AdminSection[] } {
  const audiences = audiencesOf(viewer);
  return {
    menu: MENU_LINKS.filter((l) => audiences.some((a) => settings.menu[a][l])),
    sections: ADMIN_SECTIONS.filter((s) => audiences.some((a) => isRole(a) && settings.sections[a][s])),
  };
}

/**
 * Where a viewer starts: the start page of the first role they hold, in the order Membership Admin, Election Admin,
 * Auditor, System Admin, Course Admin, Communications Admin (staff come for their tools, and System Admin's are the
 * occasional ones); with no role, their membership state's. Signed-out visitors, and anyone whose page is not shown
 * to them, start on home.
 */
export function startPageFor(settings: NavigationSettings, viewer: Viewer): StartPage {
  if (viewer.membership === 'signed_out') return 'home';
  const role = ROLES.find((r) => viewer.roles.includes(r));
  const page = settings.startsOn[role ?? viewer.membership];
  const shown = shownTo(settings, viewer);
  if (page.startsWith('admin/')) {
    return shown.menu.includes('admin') && shown.sections.includes(page.slice(6) as AdminSection) ? page : 'home';
  }
  return page === 'home' || page === 'account' || shown.menu.includes(page as MenuLink) ? page : 'home';
}

/**
 * The path of a start page in the web app. `home` is the voting home, `/vote` (what `/` was before the hub took it,
 * design §10.6), so settings saved with it keep sending people where they went.
 */
export function startPagePath(page: StartPage): string {
  if (page === 'home') return '/vote';
  if (page === 'course') return '/course/transhumanism';
  return page.startsWith('admin/') ? `/admin?tab=${page.slice(6)}` : `/${page}`;
}

const flags = <K extends string>(keys: readonly [K, ...K[]]) => z.record(z.enum(keys), z.boolean());

/** `PUT /v1/admin/navigation`: the whole matrix, and the version it was edited from. */
export const navigationSettingsSchema = z.strictObject({
  basedOn: z.number().int().min(0),
  menu: z.record(z.enum(AUDIENCES), flags(MENU_LINKS)),
  sections: z.record(z.enum(ROLES), flags(ADMIN_SECTIONS)),
  startsOn: z.record(
    z.enum(SIGNED_IN_AUDIENCES as [SignedInAudience, ...SignedInAudience[]]),
    z.enum(START_PAGES as [StartPage, ...StartPage[]]),
  ),
});
export type NavigationSettingsInput = z.infer<typeof navigationSettingsSchema>;
