import { describe, expect, it } from 'vitest';
import { MEMBER_STATUSES } from '../membership/member-status.js';
import { ROLES, type Role } from '../roles.js';
import {
  ADMIN_SECTIONS,
  AUDIENCES,
  canHideFrom,
  checkNavigationSettings,
  DEFAULT_NAVIGATION,
  MENU_LINKS,
  membershipAudience,
  menuLock,
  navigationChanges,
  navigationSettingsSchema,
  requestedNavigation,
  resolveNavigation,
  ROLE_LINK_STATES,
  roleLinkState,
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
  it('show Register, Ballot, Verify, Offices, Candidates, News, Legislation, Course and Admin to everyone, Teams, Forum, Room and Bills to Active members, and Sign in while signed out', () => {
    const all = ['register', 'ballot', 'verify', 'offices', 'candidates', 'news', 'legislation', 'course', 'admin'];
    const withTeams = ['register', 'ballot', 'verify', 'offices', 'candidates', 'teams', 'forum', 'room', 'bills', 'news', 'legislation', 'course', 'admin'];
    expect(shownTo(DEFAULT_NAVIGATION, viewer('signed_out')).menu).toEqual([...all, 'signin']);
    for (const membership of ['no_membership', ...MEMBER_STATUSES] as const) {
      expect(shownTo(DEFAULT_NAVIGATION, viewer(membership)).menu).toEqual(membership === 'active' ? withTeams : all);
    }
    expect(shownTo(DEFAULT_NAVIGATION, viewer('active', 'election_admin')).menu).toEqual(withTeams);
    expect(shownTo(DEFAULT_NAVIGATION, viewer('applicant', 'membership_admin')).menu).toEqual(all);
    // Bills is for the legislative team: System Admins see its link too, other roles only as Active members (design §5.14).
    expect(shownTo(DEFAULT_NAVIGATION, viewer('applicant', 'system_admin')).menu).toEqual(['register', 'ballot', 'verify', 'offices', 'candidates', 'bills', 'news', 'legislation', 'course', 'admin']);
  });

  it('let every role keep Ballot, Verify, Offices, Candidates, News and Course without a membership', () => {
    for (const role of ROLES) {
      expect(DEFAULT_NAVIGATION.menu[role]).toMatchObject({ ballot: true, verify: true, offices: true, candidates: true, news: true, course: true, register: false });
    }
  });

  it('give each role the console tabs it had, System Admins the link hub, the home page quote and Bills, and Security to both', () => {
    const tabs = (role: Role) => shownTo(DEFAULT_NAVIGATION, viewer('active', role)).sections;
    expect(tabs('membership_admin')).toEqual(['applications', 'members', 'inbox', 'photos', 'registration', 'first_steps', 'offices', 'candidacies', 'teams', 'forum', 'room', 'approvals', 'email']);
    expect(tabs('election_admin')).toEqual(['elections', 'offices', 'forum', 'approvals']);
    expect(tabs('auditor')).toEqual(['elections', 'offices', 'approvals', 'audit', 'security']);
    expect(tabs('system_admin')).toEqual(['room', 'approvals', 'people', 'signin', 'claude', 'email', 'security', 'testing', 'navigation', 'hub', 'quote', 'bills']);
    // Site Admins: System Admins' tabs but Sign-in methods, API keys and Testing (design §10.1).
    expect(tabs('site_admin')).toEqual(['room', 'approvals', 'people', 'email', 'security', 'navigation', 'hub', 'quote', 'bills']);
    expect(tabs('course_admin')).toEqual(['course']);
    expect(tabs('communications_admin')).toEqual(['communications', 'hub']);
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

  it('give settings saved before the Getting started section existed its default', () => {
    const { first_steps: _, ...saved } = DEFAULT_NAVIGATION.sections.membership_admin;
    const stored = { ...DEFAULT_NAVIGATION, sections: { ...DEFAULT_NAVIGATION.sections, membership_admin: saved } };
    expect(resolveNavigation(stored).sections.membership_admin.first_steps).toBe(true);
    for (const role of ['election_admin', 'auditor', 'system_admin', 'site_admin'] as const) {
      expect(sectionLock(role, 'first_steps')).toBe('not_permitted');
    }
  });

  it('give settings saved before the Link hub section existed its default', () => {
    const { hub: _, ...saved } = DEFAULT_NAVIGATION.sections.system_admin;
    const stored = { ...DEFAULT_NAVIGATION, sections: { ...DEFAULT_NAVIGATION.sections, system_admin: saved } };
    expect(resolveNavigation(stored).sections.system_admin.hub).toBe(true);
    for (const role of ['membership_admin', 'election_admin', 'auditor'] as const) expect(sectionLock(role, 'hub')).toBe('not_permitted');
  });

  it('give settings saved before Candidates existed its defaults: the link for everyone, the section for Membership Admins', () => {
    const before = edit(DEFAULT_NAVIGATION, (s) => {
      for (const a of AUDIENCES) delete s.menu[a].candidates;
      for (const r of ROLES) delete s.sections[r].candidacies;
    });
    const resolved = resolveNavigation(before);
    expect(AUDIENCES.filter((a) => !resolved.menu[a].candidates)).toEqual([]);
    expect(ROLES.filter((r) => resolved.sections[r].candidacies)).toEqual(['membership_admin']);
    for (const role of ['election_admin', 'auditor', 'system_admin', 'course_admin'] as const) {
      expect(sectionLock(role, 'candidacies')).toBe('not_permitted');
    }
    expect(startPagePath('candidates')).toBe('/candidates');
  });

  it('give settings saved before Teams existed its defaults: the link for Active members, the section for Membership Admins', () => {
    const before = edit(DEFAULT_NAVIGATION, (s) => {
      for (const a of AUDIENCES) delete s.menu[a].teams;
      for (const r of ROLES) delete s.sections[r].teams;
    });
    const resolved = resolveNavigation(before);
    expect(AUDIENCES.filter((a) => resolved.menu[a].teams)).toEqual(['active']);
    expect(ROLES.filter((r) => resolved.sections[r].teams)).toEqual(['membership_admin']);
    for (const role of ['election_admin', 'auditor', 'system_admin', 'course_admin'] as const) {
      expect(sectionLock(role, 'teams')).toBe('not_permitted');
    }
    expect(startPagePath('teams')).toBe('/teams');
  });

  it('give settings saved before the forum existed its defaults: the link for Active members, the section for Membership and Election Admins', () => {
    const before = edit(DEFAULT_NAVIGATION, (s) => {
      for (const a of AUDIENCES) delete s.menu[a].forum;
      for (const r of ROLES) delete s.sections[r].forum;
    });
    const resolved = resolveNavigation(before);
    expect(AUDIENCES.filter((a) => resolved.menu[a].forum)).toEqual(['active']);
    expect(ROLES.filter((r) => resolved.sections[r].forum)).toEqual(['membership_admin', 'election_admin']);
    for (const role of ['auditor', 'system_admin', 'course_admin'] as const) expect(sectionLock(role, 'forum')).toBe('not_permitted');
    expect(startPagePath('forum')).toBe('/forum');
  });

  it('give settings saved before the members’ room existed its default: the link for Active members, and no section', () => {
    const before = edit(DEFAULT_NAVIGATION, (s) => {
      for (const a of AUDIENCES) delete s.menu[a].room;
    });
    const resolved = resolveNavigation(before);
    expect(AUDIENCES.filter((a) => resolved.menu[a].room)).toEqual(['active']);
    expect(startPagePath('room')).toBe('/room');
  });

  it('give settings saved before News existed its defaults: the link for everyone, the sections for Communications Admins', () => {
    const before = edit(DEFAULT_NAVIGATION, (s) => {
      for (const a of AUDIENCES) delete s.menu[a].news;
      for (const r of ROLES) delete s.sections[r].communications;
    });
    const resolved = resolveNavigation(before);
    expect(AUDIENCES.filter((a) => !resolved.menu[a].news)).toEqual([]);
    expect(ROLES.filter((r) => resolved.sections[r].communications)).toEqual(['communications_admin']);
    expect(ROLES.filter((r) => resolved.sections[r].hub)).toEqual(['system_admin', 'site_admin', 'communications_admin']);
    for (const role of ['membership_admin', 'election_admin', 'auditor', 'system_admin', 'course_admin'] as const) {
      expect(sectionLock(role, 'communications')).toBe('not_permitted');
    }
    expect(startPagePath('news')).toBe('/news');
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

  it('lock Sign-in methods, API keys and Testing off for Site Admins', () => {
    for (const section of ['signin', 'claude', 'testing'] as const) expect(sectionLock('site_admin', section)).toBe('not_permitted');
    expect(sectionLock('site_admin', 'people')).toBeNull();
    expect(sectionLock('site_admin', 'navigation')).toBeNull();
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

  it('adds each role they hold, taking nothing away unless a role hides it', () => {
    expect(shownTo(resolved, viewer('active', 'election_admin'))).toEqual({
      menu: ['ballot', 'verify', 'admin'],
      sections: ['elections', 'forum', 'approvals'],
    });
    expect(shownTo(resolved, viewer('applicant', 'membership_admin', 'election_admin')).sections).toEqual([
      'applications',
      'members',
      'inbox',
      'photos',
      'registration',
      'first_steps',
      'elections',
      'offices',
      'candidacies',
      'teams',
      'forum',
      'room',
      'approvals',
      'email',
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

describe('links a role hides', () => {
  // The System Admin column hides Register: their membership state still shows it to everyone else.
  const hideRegister = edit(DEFAULT_NAVIGATION, (s) => (s.hiddenFrom.system_admin.register = true));

  it('are none by default, and none in settings saved before roles could hide links', () => {
    for (const role of ROLES) expect(Object.values(DEFAULT_NAVIGATION.hiddenFrom[role]).some(Boolean)).toBe(false);
    const { hiddenFrom: _, ...older } = edit(DEFAULT_NAVIGATION, (s) => (s.menu.applicant.ballot = false));
    const resolved = resolveNavigation(older);
    expect(resolved.hiddenFrom).toEqual(DEFAULT_NAVIGATION.hiddenFrom);
    expect(resolved.menu.applicant.ballot).toBe(false);
    expect(shownTo(resolved, viewer('no_membership', 'system_admin')).menu).toContain('register');
  });

  it('take the link away from anyone holding the role, whatever their membership shows them', () => {
    const resolved = resolveNavigation(hideRegister);
    expect(checkNavigationSettings(resolved)).toEqual({ ok: true });
    for (const membership of ['no_membership', ...MEMBER_STATUSES] as const) {
      expect(shownTo(resolved, viewer(membership, 'system_admin')).menu).not.toContain('register');
      expect(shownTo(resolved, viewer(membership)).menu).toContain('register');
      expect(shownTo(resolved, viewer(membership, 'site_admin')).menu).toContain('register');
    }
    expect(shownTo(resolved, viewer('signed_out', 'system_admin')).menu).toContain('register');
  });

  it("win over another role's Shown, and over Active members' links", () => {
    const settings = resolveNavigation(
      edit(hideRegister, (s) => {
        s.menu.membership_admin.register = true;
        s.hiddenFrom.election_admin.teams = true;
      }),
    );
    expect(shownTo(settings, viewer('applicant', 'membership_admin')).menu).toContain('register');
    expect(shownTo(settings, viewer('applicant', 'membership_admin', 'system_admin')).menu).not.toContain('register');
    expect(shownTo(settings, viewer('active')).menu).toContain('teams');
    expect(shownTo(settings, viewer('active', 'election_admin')).menu).not.toContain('teams');
  });

  it('can be any link a role can switch: never Admin, which follows its sections, or Sign in', () => {
    for (const role of ROLES) {
      expect(MENU_LINKS.filter((l) => !canHideFrom(role, l))).toEqual(['admin', 'signin']);
    }
    const tampered = edit(DEFAULT_NAVIGATION, (s) => {
      s.hiddenFrom.auditor.admin = true;
      s.hiddenFrom.auditor.signin = true;
    });
    expect(resolveNavigation(tampered).hiddenFrom.auditor).toEqual(DEFAULT_NAVIGATION.hiddenFrom.auditor);
    expect(resolveNavigation(tampered).menu.auditor.admin).toBe(true);
    expect(checkNavigationSettings(tampered)).toMatchObject({ ok: false, reason: expect.stringMatching(/admin cannot be hidden from auditor/) });
    const signIn = edit(DEFAULT_NAVIGATION, (s) => (s.hiddenFrom.auditor.signin = true));
    expect(checkNavigationSettings(signIn)).toMatchObject({ ok: false, reason: expect.stringMatching(/signin cannot be hidden/) });
  });

  it('are never also shown to the role: refused as sent, and hidden once resolved', () => {
    const both = edit(DEFAULT_NAVIGATION, (s) => (s.hiddenFrom.election_admin.ballot = true));
    expect(DEFAULT_NAVIGATION.menu.election_admin.ballot).toBe(true);
    expect(checkNavigationSettings(both)).toMatchObject({ ok: false, reason: expect.stringMatching(/both shown to and hidden from election_admin/) });
    const resolved = resolveNavigation(both);
    expect(resolved.menu.election_admin.ballot).toBe(false);
    expect(checkNavigationSettings(resolved)).toEqual({ ok: true });
  });

  it("give each role's cell one of three states", () => {
    const settings = resolveNavigation(hideRegister);
    expect(roleLinkState(settings, 'system_admin', 'register')).toBe('hidden');
    expect(roleLinkState(settings, 'system_admin', 'ballot')).toBe('shown');
    expect(roleLinkState(settings, 'system_admin', 'teams')).toBe('membership');
    expect(ROLE_LINK_STATES).toEqual(['shown', 'membership', 'hidden']);
  });

  it('leave a start page the role hides off its choices, and send people starting on one to home', () => {
    const starts = edit(DEFAULT_NAVIGATION, (s) => (s.startsOn.election_admin = 'verify'));
    expect(startPageFor(starts, viewer('active', 'election_admin'))).toBe('verify');
    const hidden = edit(starts, (s) => {
      s.menu.election_admin.verify = false;
      s.hiddenFrom.election_admin.verify = true;
    });
    expect(startPageOptions(resolveNavigation(hidden), 'election_admin')).not.toContain('verify');
    expect(checkNavigationSettings(hidden)).toMatchObject({ ok: false, reason: expect.stringMatching(/election_admin cannot start on verify/) });
    // The Active member column still shows Verify, but the role they hold hides it.
    expect(startPageFor(hidden, viewer('active', 'election_admin'))).toBe('home');
    // Another role held that hides the page a first role starts on sends them home too.
    const other = edit(starts, (s) => (s.hiddenFrom.system_admin.verify = true));
    expect(startPageFor(resolveNavigation(other), viewer('active', 'election_admin', 'system_admin'))).toBe('home');
  });

  it('are ledgered with the cell: hidden, no longer hidden, and shown', () => {
    const hidden = resolveNavigation(edit(DEFAULT_NAVIGATION, (s) => {
      s.hiddenFrom.system_admin.register = true;
      s.menu.election_admin.ballot = false;
      s.hiddenFrom.election_admin.ballot = true;
    }));
    expect(navigationChanges(DEFAULT_NAVIGATION, hidden)).toEqual([
      { audience: 'election_admin', link: 'ballot', shown: false, hidden: true },
      { audience: 'system_admin', link: 'register', shown: false, hidden: true },
    ]);
    const after = resolveNavigation(edit(hidden, (s) => {
      s.hiddenFrom.system_admin.register = false;
      s.hiddenFrom.election_admin.ballot = false;
      s.menu.election_admin.ballot = true;
    }));
    expect(navigationChanges(hidden, after)).toEqual([
      { audience: 'election_admin', link: 'ballot', shown: true, hidden: false },
      { audience: 'system_admin', link: 'register', shown: false, hidden: false },
    ]);
    expect(navigationChanges(after, DEFAULT_NAVIGATION)).toEqual([]);
  });

  it('may be left out of a save by a page opened before roles could hide links, keeping those saved', () => {
    const saved = resolveNavigation(edit(DEFAULT_NAVIGATION, (s) => {
      s.hiddenFrom.system_admin.register = true;
      s.hiddenFrom.auditor.news = true;
    }));
    const { hiddenFrom: _, ...older } = saved;
    expect(navigationSettingsSchema.safeParse({ basedOn: 1, ...older }).success).toBe(true);
    expect(requestedNavigation(older, saved).hiddenFrom).toEqual(saved.hiddenFrom);
    // The older page shows News to Auditors: they want it shown, so it is no longer hidden.
    const showsNews = edit(older as NavigationSettings, (s) => (s.menu.auditor.news = true));
    const requested = requestedNavigation(showsNews, saved);
    expect(requested.hiddenFrom.auditor.news).toBe(false);
    expect(requested.hiddenFrom.system_admin.register).toBe(true);
    expect(checkNavigationSettings(requested)).toEqual({ ok: true });
    // A page that sends them has them as sent.
    expect(requestedNavigation(DEFAULT_NAVIGATION, saved).hiddenFrom).toEqual(DEFAULT_NAVIGATION.hiddenFrom);
  });

  it('are sent per role and link', () => {
    const { auditor: _, ...missing } = DEFAULT_NAVIGATION.hiddenFrom;
    expect(navigationSettingsSchema.safeParse({ basedOn: 0, ...DEFAULT_NAVIGATION, hiddenFrom: missing }).success).toBe(false);
    const asMember = { ...DEFAULT_NAVIGATION.hiddenFrom, active: DEFAULT_NAVIGATION.hiddenFrom.auditor };
    expect(navigationSettingsSchema.safeParse({ basedOn: 0, ...DEFAULT_NAVIGATION, hiddenFrom: asMember }).success).toBe(false);
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
    expect(startPageOptions(DEFAULT_NAVIGATION, 'applicant')).toEqual(['home', 'account', 'register', 'ballot', 'verify', 'offices', 'candidates', 'news', 'legislation', 'course']);
    expect(startPageOptions(DEFAULT_NAVIGATION, 'election_admin')).toEqual([
      'home',
      'account',
      'ballot',
      'verify',
      'offices',
      'candidates',
      'news',
      'legislation',
      'course',
      'admin/elections',
      'admin/offices',
      'admin/forum',
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
    expect(startPagePath('course')).toBe('/courses');
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
      candidates: true,
      teams: false,
      forum: false,
      room: false,
      bills: false,
      news: true,
      legislation: true,
      course: true,
      admin: true,
      signin: true,
    });
  });

  it('show Legislation to everyone when saved before it was a row (design §5.14)', () => {
    const before = edit(DEFAULT_NAVIGATION, (s) => {
      for (const a of AUDIENCES) delete (s.menu[a] as Partial<Record<string, boolean>>).legislation;
    });
    const resolved = resolveNavigation(before);
    expect(AUDIENCES.every((a) => resolved.menu[a].legislation)).toBe(true);
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
        for (const sec of ['elections', 'offices', 'forum', 'approvals'] satisfies AdminSection[]) s.sections.election_admin[sec] = false;
        s.sections.system_admin.offices = true;
        s.startsOn.active = 'verify';
      }),
    );
    expect(navigationChanges(DEFAULT_NAVIGATION, after)).toEqual([
      { audience: 'applicant', link: 'ballot', shown: false },
      { audience: 'election_admin', link: 'admin', shown: false },
      { audience: 'election_admin', section: 'elections', shown: false },
      { audience: 'election_admin', section: 'offices', shown: false },
      { audience: 'election_admin', section: 'forum', shown: false },
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
