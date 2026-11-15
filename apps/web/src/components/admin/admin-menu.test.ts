import { ADMIN_SECTIONS, DEFAULT_NAVIGATION, ROLES, type AdminSection, type Role } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { MENU_GROUPS, menuFor } from './admin-menu.js';

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

  it('keeps each role’s default sections, and opens on the one the role is mostly for', () => {
    const opens: Record<Role, AdminSection> = {
      membership_admin: 'applications',
      election_admin: 'elections',
      auditor: 'elections',
      system_admin: 'approvals',
      site_admin: 'approvals',
      course_admin: 'course',
      communications_admin: 'communications',
    };
    for (const role of ROLES) {
      const given = ADMIN_SECTIONS.filter((s) => DEFAULT_NAVIGATION.sections[role][s]);
      const listed = menuFor(given).flatMap((g) => g.sections.map((s) => s.name));
      expect([...listed].sort(), role).toEqual([...given].sort());
      expect(listed[0], role).toBe(opens[role]);
    }
  });
});
