import { ADMIN_SECTIONS, DEFAULT_NAVIGATION, ROLES, shownTo, type AdminSection, type Role } from 'ustp-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MENU_GROUPS, menuFor, readFavourites, saveFavourites, toggleFavourite } from './admin-menu.js';

describe('the admin side menu', () => {
  it('puts every section under exactly one heading', () => {
    const grouped = MENU_GROUPS.flatMap((g) => g.sections);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ADMIN_SECTIONS].sort());
  });

  it('shows only the sections given, in menu order, and drops empty headings', () => {
    expect(menuFor(['testing', 'email', 'approvals'])).toEqual([
      { label: 'Elections', sections: [{ name: 'approvals', label: 'Approvals', icon: 'approval' }] },
      { label: 'Outreach', sections: [{ name: 'email', label: 'Email', icon: 'mail' }] },
      { label: 'System', sections: [{ name: 'testing', label: 'Testing', icon: 'science' }] },
    ]);
    expect(menuFor([])).toEqual([]);
  });

  it('keeps the sections each role is shown by default, and opens on the one the role is mostly for', () => {
    // A Site Admin is shown every other role's sections but System Admin's own (design §10.1), Applications first.
    const opens: Record<Role, AdminSection> = {
      membership_admin: 'applications',
      election_admin: 'elections',
      auditor: 'elections',
      system_admin: 'approvals',
      site_admin: 'applications',
      course_admin: 'course',
      communications_admin: 'communications',
    };
    for (const role of ROLES) {
      const given = shownTo(DEFAULT_NAVIGATION, { membership: 'no_membership', roles: [role] }).sections;
      const listed = menuFor(given).flatMap((g) => g.sections.map((s) => s.name));
      expect([...listed].sort(), role).toEqual([...given].sort());
      expect(listed[0], role).toBe(opens[role]);
    }
  });
});

describe('favourites', () => {
  const names = (groups: ReturnType<typeof menuFor>) => groups.map((g) => `${g.label}: ${g.sections.map((s) => s.name).join(' ')}`);

  it('come first, in the order starred, and leave their own group, which goes if it is left empty', () => {
    const shown = ['approvals', 'email', 'people', 'testing'] as const;
    expect(names(menuFor(shown, ['testing', 'approvals']))).toEqual(['Favourites: testing approvals', 'Outreach: email', 'System: people']);
    expect(names(menuFor(shown, []))).toEqual(['Elections: approvals', 'Outreach: email', 'System: people testing']);
  });

  it('leave out a section the person no longer sees, and a repeat', () => {
    expect(names(menuFor(['email'], ['audit', 'email', 'email']))).toEqual(['Favourites: email']);
  });

  it('are starred onto the end and unstarred', () => {
    expect(toggleFavourite(['email'], 'people')).toEqual(['email', 'people']);
    expect(toggleFavourite(['email', 'people'], 'email')).toEqual(['people']);
  });

  describe('in this browser', () => {
    afterEach(() => vi.unstubAllGlobals());
    const held = new Map<string, string>();
    const stub = () => {
      held.clear();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => held.get(key) ?? null,
        setItem: (key: string, value: string) => void held.set(key, value),
        removeItem: (key: string) => void held.delete(key),
      });
    };

    it('are kept per account, and only known sections are read back', () => {
      stub();
      saveFavourites('a1', ['people', 'email']);
      expect(readFavourites('a1')).toEqual(['people', 'email']);
      expect(readFavourites('a2')).toEqual([]);
      expect(readFavourites(null)).toEqual([]);
      held.set('ustp-admin-favourites:a3', JSON.stringify(['email', 'nonsense', 3, 'email']));
      expect(readFavourites('a3')).toEqual(['email']);
      held.set('ustp-admin-favourites:a4', '{not json');
      expect(readFavourites('a4')).toEqual([]);
      saveFavourites('a1', []);
      expect(held.has('ustp-admin-favourites:a1')).toBe(false);
    });

    it('are none, and nothing breaks, when storage is blocked', () => {
      const blocked = () => {
        throw new Error('blocked');
      };
      vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
      expect(readFavourites('a1')).toEqual([]);
      expect(() => saveFavourites('a1', ['email'])).not.toThrow();
    });
  });
});
