import { describe, expect, it } from 'vitest';
import { MEMBER_STATUSES } from '../membership/member-status.js';
import { ROLES, type Role } from '../roles.js';
import {
  ADMIN_SECTIONS,
  AUDIENCES,
  checkNavigationSettings,
  DEFAULT_NAVIGATION,
  MENU_LINKS,
  membershipAudience,
  menuLock,
  navigationChanges,
  navigationSettingsSchema,
  resolveNavigation,
  SECTION_ROLES,
  sectionLock,
  SIGN_IN_WAYS,
  shownTo,
  startPageFor,
  startPageOptions,
  startPagePath,
  type AdminSection,
  type NavigationSettings,
  type Viewer,
} from './navigation.js';

/** A copy of the settings with some cells changed, as an admin's edit would make it. */
function edit(base: NavigationSettings, change: (s: { -readonly [K in keyof NavigationSettings]: any }) => void): NavigationSettings {
  const copy = structuredClone(base) as any;
  change(copy);
  return copy;
}

const viewer = (membership: Viewer['membership'], ...roles: Role[]): Viewer => ({ membership, roles });

describe('defaults', () => {
  it('show Register, Ballot, Verify, Offices, Course and Admin to everyone, and Sign in while signed out', () => {
    const all = ['register', 'ballot', 'verify', 'offices', 'course', 'admin'];
    expect(shownTo(DEFAULT_NAVIGATION, viewer('signed_out')).menu).toEqual(MENU_LINKS);
    for (const membership of ['no_membership', ...MEMBER_STATUSES] as const) {
      expect(shownTo(DEFAULT_NAVIGATION, viewer(membership)).menu).toEqual(all);
    }
    expect(shownTo(DEFAULT_NAVIGATION, viewer('active', 'election_admin')).menu).toEqual(all);
  });

  it('let every role keep Ballot, Verify, Offices and Course without a membership', () => {
    for (const role of ROLES) expect(DEFAULT_NAVIGATION.menu[role]).toMatchObject({ ballot: true, verify: true, offices: true, course: true, register: false });
  });

  it('give each role the console tabs it had, and System Admins the link hub and the home page quote', () => {
    const tabs = (role: Role) => shownTo(DEFAULT_NAVIGATION, viewer('active', role)).sections;
    expect(tabs('membership_admin')).toEqual(['applications', 'members', 'photos', 'bylaws', 'registration', 'offices', 'approvals']);
    expect(tabs('election_admin')).toEqual(['elections', 'offices', 'approvals']);
    expect(tabs('auditor')).toEqual(['elections', 'offices', 'approvals', 'audit']);
    expect(tabs('system_admin')).toEqual(['approvals', 'people', 'signin', 'claude', 'email', 'testing', 'navigation', 'hub', 'quote']);
    expect(tabs('course_admin')).toEqual(['course']);
  });

  it('give settings saved before the Home page quote section existed its default', () => {
    const { quote: _, ...saved } = DEFAULT_NAVIGATION.sections.system_admin;
    const stored = { ...DEFAULT_NAVIGATION, sections: { ...DEFAULT_NAVIGATION.sections, system_admin: saved } };
    expect(resolveNavigation(stored).sections.system_admin.quote).toBe(true);
    expect(sectionLock('membership_admin', 'quote')).toBe('not_permitted');
  });

  it('give settings saved before the Registration form section existed its default', () => {
    const { registration: _, ...saved } = DEFAULT_NAVIGATION.sections.membership_admin;
    const stored = { ...DEFAULT_NAVIGATION, sections: { ...DEFAULT_NAVIGATION.sections, membership_admin: saved } };
    expect(resolveNavigation(stored).sections.membership_admin.registration).toBe(true);
    for (const role of ['election_admin', 'auditor', 'system_admin'] as const) {
      expect(sectionLock(role, 'registration')).toBe('not_permitted');
    }
  });

  it('give settings saved before the Link hub section existed its default', () => {
    const { hub: _, ...saved } = DEFAULT_NAVIGATION.sections.system_admin;
    const stored = { ...DEFAULT_NAVIGATION, sections: { ...DEFAULT_NAVIGATION.sections, system_admin: saved } };
    expect(resolveNavigation(stored).sections.system_admin.hub).toBe(true);
    for (const role of ['membership_admin', 'election_admin', 'auditor'] as const) expect(sectionLock(role, 'hub')).toBe('not_permitted');
  });

  it('give no admin section to anyone without a role', () => {
    expect(shownTo(DEFAULT_NAVIGATION, viewer('active')).sections).toEqual([]);
  });

  it('start a login with no membership on Register and everyone else on home', () => {
    expect(startPageFor(DEFAULT_NAVIGATION, viewer('no_membership'))).toBe('register');
    expect(startPageFor(DEFAULT_NAVIGATION, viewer('applicant'))).toBe('home');
    expect(startPageFor(DEFAULT_NAVIGATION, viewer('active', 'system_admin'))).toBe('home');
    expect(startPageFor(DEFAULT_NAVIGATION, viewer('signed_out'))).toBe('home');
  });

  it('are already resolved and pass their own check', () => {
    expect(resolveNavigation(DEFAULT_NAVIGATION)).toEqual(DEFAULT_NAVIGATION);
    expect(resolveNavigation(null)).toEqual(DEFAULT_NAVIGATION);
    expect(checkNavigationSettings(DEFAULT_NAVIGATION)).toEqual({ ok: true });
  });
});

describe('locked cells', () => {
  it('lock off every section a role may not use, and every section for membership alone', () => {
    expect(sectionLock('election_admin', 'members')).toBe('not_permitted');
    expect(sectionLock('auditor', 'applications')).toBe('not_permitted');
    expect(sectionLock('membership_admin', 'audit')).toBe('not_permitted');
    expect(sectionLock('active', 'elections')).toBe('no_role');
    expect(sectionLock('signed_out', 'approvals')).toBe('no_role');
    for (const role of ROLES) {
      for (const s of ADMIN_SECTIONS) {
        expect(sectionLock(role, s) === 'not_permitted').toBe(!SECTION_ROLES[s].includes(role));
      }
    }
  });

  it('lock on Navigation and People for System Admins, and nothing else', () => {
    const guarded = ROLES.flatMap((r) => ADMIN_SECTIONS.filter((s) => sectionLock(r, s) === 'guarded').map((s) => `${r}:${s}`));
    expect(guarded).toEqual(['system_admin:people', 'system_admin:navigation']);
  });

  it("make a role's Admin link follow its sections, and leave the other links free", () => {
    expect(menuLock('election_admin', 'admin')).toBe('follows_sections');
    expect(menuLock('active', 'admin')).toBeNull();
    expect(menuLock('auditor', 'ballot')).toBeNull();
    expect(menuLock('signed_out', 'signin')).toBeNull();
    const noSections = edit(DEFAULT_NAVIGATION, (s) => {
      for (const sec of ADMIN_SECTIONS) s.sections.auditor[sec] = false;
    });
    expect(resolveNavigation(noSections).menu.auditor.admin).toBe(false);
    expect(resolveNavigation(DEFAULT_NAVIGATION).menu.auditor.admin).toBe(true);
  });

  it('lock off Sign in for everyone signed in', () => {
    expect(AUDIENCES.filter((a) => menuLock(a, 'signin') === 'signed_in')).toEqual(AUDIENCES.filter((a) => a !== 'signed_out'));
    const tampered = edit(DEFAULT_NAVIGATION, (s) => (s.menu.active.signin = true));
    expect(resolveNavigation(tampered).menu.active.signin).toBe(false);
    expect(checkNavigationSettings(tampered)).toMatchObject({ ok: false, reason: expect.stringMatching(/they are signed in/) });
  });

  it('keep signed-out visitors a way to sign in: Sign in, Register, Ballot or Admin', () => {
    const only = (link: (typeof SIGN_IN_WAYS)[number]) =>
      edit(DEFAULT_NAVIGATION, (s) => {
        for (const l of MENU_LINKS) s.menu.signed_out[l] = l === link || l === 'verify';
      });
    for (const link of SIGN_IN_WAYS) expect(checkNavigationSettings(only(link))).toEqual({ ok: true });
    const stranded = edit(DEFAULT_NAVIGATION, (s) => {
      for (const l of SIGN_IN_WAYS) s.menu.signed_out[l] = false;
    });
    expect(checkNavigationSettings(stranded)).toMatchObject({ ok: false, refusal: 'conflict', reason: expect.stringMatching(/way to sign in/) });
  });

  it('are put back to their locked value when resolving', () => {
    const tampered = edit(DEFAULT_NAVIGATION, (s) => {
      s.sections.election_admin.members = true;
      s.sections.system_admin.navigation = false;
      s.menu.system_admin.admin = false;
    });
    const resolved = resolveNavigation(tampered);
    expect(resolved.sections.election_admin.members).toBe(false);
    expect(resolved.sections.system_admin.navigation).toBe(true);
    expect(resolved.menu.system_admin.admin).toBe(true);
  });

  it('are refused when sent switched', () => {
    const forbidden = edit(DEFAULT_NAVIGATION, (s) => (s.sections.election_admin.members = true));
    expect(checkNavigationSettings(forbidden)).toMatchObject({ ok: false, reason: expect.stringMatching(/does not let/) });
    const lockOut = edit(DEFAULT_NAVIGATION, (s) => (s.sections.system_admin.people = false));
    expect(checkNavigationSettings(lockOut)).toMatchObject({ ok: false, refusal: 'conflict' });
  });
});

describe('what a person sees', () => {
  const settings = edit(DEFAULT_NAVIGATION, (s) => {
    for (const a of AUDIENCES) for (const l of MENU_LINKS) s.menu[a][l] = false;
    s.menu.applicant.register = true;
    s.menu.active.ballot = true;
    s.menu.active.verify = true;
    s.menu.election_admin.verify = true;
    s.sections.election_admin.offices = false;
  });
  const resolved = resolveNavigation(settings);

  it('is their membership state alone when they hold no role', () => {
    expect(shownTo(resolved, viewer('applicant'))).toEqual({ menu: ['register'], sections: [] });
    expect(shownTo(resolved, viewer('lapsed'))).toEqual({ menu: [], sections: [] });
  });

  it('adds each role they hold, never taking anything away', () => {
    expect(shownTo(resolved, viewer('active', 'election_admin'))).toEqual({
      menu: ['ballot', 'verify', 'admin'],
      sections: ['elections', 'approvals'],
    });
    expect(shownTo(resolved, viewer('applicant', 'membership_admin', 'election_admin')).sections).toEqual([
      'applications',
      'members',
      'photos',
      'bylaws',
      'registration',
      'elections',
      'offices',
      'approvals',
    ]);
  });

  it('ignores roles while signed out', () => {
    expect(shownTo(resolved, viewer('signed_out', 'system_admin'))).toEqual({ menu: [], sections: [] });
  });

  it('maps the session to a membership state', () => {
    expect(membershipAudience(false, 'active')).toBe('signed_out');
    expect(membershipAudience(true, null)).toBe('no_membership');
    expect(membershipAudience(true, 'suspended')).toBe('suspended');
  });
});

describe('start pages', () => {
  const settings = edit(DEFAULT_NAVIGATION, (s) => {
    s.startsOn.active = 'ballot';
    s.startsOn.membership_admin = 'admin/applications';
    s.startsOn.election_admin = 'admin/elections';
    s.startsOn.system_admin = 'admin/people';
  });

  it('offer home, account and what the audience sees', () => {
    expect(startPageOptions(DEFAULT_NAVIGATION, 'applicant')).toEqual(['home', 'account', 'register', 'ballot', 'verify', 'offices', 'course']);
    expect(startPageOptions(DEFAULT_NAVIGATION, 'election_admin')).toEqual([
      'home',
      'account',
      'ballot',
      'verify',
      'offices',
      'course',
      'admin/elections',
      'admin/offices',
      'admin/approvals',
    ]);
  });

  it("follow the first role held, in the order Membership Admin, Election Admin, Auditor, System Admin", () => {
    expect(startPageFor(settings, viewer('active'))).toBe('ballot');
    expect(startPageFor(settings, viewer('active', 'election_admin'))).toBe('admin/elections');
    expect(startPageFor(settings, viewer('active', 'system_admin', 'membership_admin'))).toBe('admin/applications');
    expect(startPageFor(settings, viewer('no_membership', 'system_admin'))).toBe('admin/people');
  });

  it('fall back to home when the page is hidden from the person', () => {
    const hidden = edit(settings, (s) => (s.menu.active.ballot = false));
    expect(checkNavigationSettings(hidden)).toMatchObject({ ok: false, reason: expect.stringMatching(/active cannot start on ballot/) });
    expect(resolveNavigation(hidden).startsOn.active).toBe('home');
    expect(startPageFor(hidden, viewer('active'))).toBe('home');
  });

  it('have paths in the web app', () => {
    expect(startPagePath('home')).toBe('/vote');
    expect(startPagePath('ballot')).toBe('/ballot');
    expect(startPagePath('offices')).toBe('/offices');
    expect(startPagePath('course')).toBe('/course/transhumanism');
    expect(startPagePath('admin/elections')).toBe('/admin?tab=elections');
  });
});

describe('saved settings', () => {
  it('show Sign in to visitors when saved before it was a row', () => {
    const { signin: _, ...older } = DEFAULT_NAVIGATION.menu.signed_out;
    const stored = edit(DEFAULT_NAVIGATION, (s) => (s.menu.signed_out = { ...older, ballot: false }));
    expect(resolveNavigation(stored).menu.signed_out).toEqual({
      register: true,
      ballot: false,
      verify: true,
      offices: true,
      course: true,
      admin: true,
      signin: true,
    });
  });

  it('show Offices as its default when saved before it was a row, keeping every other saved cell', () => {
    const before = edit(DEFAULT_NAVIGATION, (s) => {
      for (const a of AUDIENCES) delete s.menu[a].offices;
      s.menu.applicant.ballot = false;
      s.startsOn.active = 'verify';
    });
    const resolved = resolveNavigation(before);
    for (const a of AUDIENCES) expect(resolved.menu[a].offices).toBe(DEFAULT_NAVIGATION.menu[a].offices);
    expect(resolved.menu.applicant.ballot).toBe(false);
    expect(resolved.startsOn.active).toBe('verify');
    expect(navigationChanges(DEFAULT_NAVIGATION, resolved)).toEqual([
      { audience: 'applicant', link: 'ballot', shown: false },
      { audience: 'active', startsOn: 'verify' },
    ]);
    expect(checkNavigationSettings(resolved)).toEqual({ ok: true });
  });

  it('let an audience start on Offices only while it is shown to them', () => {
    const starts = edit(DEFAULT_NAVIGATION, (s) => (s.startsOn.active = 'offices'));
    expect(checkNavigationSettings(starts)).toEqual({ ok: true });
    expect(startPageFor(starts, viewer('active'))).toBe('offices');
    const hidden = edit(starts, (s) => (s.menu.active.offices = false));
    expect(checkNavigationSettings(hidden)).toMatchObject({ ok: false, reason: expect.stringMatching(/active cannot start on offices/) });
    expect(resolveNavigation(hidden).startsOn.active).toBe('home');
  });

  it('fill in anything missing from the defaults, such as a section added since', () => {
    const { navigation: _, ...older } = DEFAULT_NAVIGATION.sections.system_admin;
    const stored = { ...DEFAULT_NAVIGATION, sections: { ...DEFAULT_NAVIGATION.sections, system_admin: older }, startsOn: {} };
    expect(resolveNavigation(stored)).toEqual(DEFAULT_NAVIGATION);
  });

  it('list each changed cell for the ledger, derived Admin links included', () => {
    const after = resolveNavigation(
      edit(DEFAULT_NAVIGATION, (s) => {
        s.menu.applicant.ballot = false;
        for (const sec of ['elections', 'offices', 'approvals'] satisfies AdminSection[]) s.sections.election_admin[sec] = false;
        s.sections.system_admin.offices = true;
        s.startsOn.active = 'verify';
      }),
    );
    expect(navigationChanges(DEFAULT_NAVIGATION, after)).toEqual([
      { audience: 'applicant', link: 'ballot', shown: false },
      { audience: 'election_admin', link: 'admin', shown: false },
      { audience: 'election_admin', section: 'elections', shown: false },
      { audience: 'election_admin', section: 'offices', shown: false },
      { audience: 'election_admin', section: 'approvals', shown: false },
      { audience: 'system_admin', section: 'offices', shown: true },
      { audience: 'active', startsOn: 'verify' },
    ]);
    expect(navigationChanges(after, after)).toEqual([]);
  });

  it('are sent whole, with the version they were edited from', () => {
    expect(navigationSettingsSchema.safeParse({ basedOn: 0, ...DEFAULT_NAVIGATION }).success).toBe(true);
    const { applicant: _, ...missing } = DEFAULT_NAVIGATION.menu;
    expect(navigationSettingsSchema.safeParse({ basedOn: 0, ...DEFAULT_NAVIGATION, menu: missing }).success).toBe(false);
    expect(navigationSettingsSchema.safeParse({ ...DEFAULT_NAVIGATION }).success).toBe(false);
    const badPage = edit(DEFAULT_NAVIGATION, (s) => (s.startsOn.active = 'admin/nowhere'));
    expect(navigationSettingsSchema.safeParse({ basedOn: 1, ...badPage }).success).toBe(false);
  });
});
