import type { Actor } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { personaStart } from './acting.js';
import { roleChangeBlocker } from './role-change.js';

describe('roleChangeBlocker', () => {
  const siteAdmin: Actor = { accountId: 'test-site-admin', roles: ['site_admin'], mfa: true, authAgeSeconds: 0 };
  const persona = { accountId: 'test-course-admin', roles: ['course_admin'] as const };
  const real = { accountId: 'pat', roles: [] };
  const acting = { personaIds: new Set(['test-site-admin', 'test-course-admin']) };

  it("explains the API's refusals as sentences, with role names as people read them", () => {
    expect(roleChangeBlocker(siteAdmin, persona, 'grant', 'communications_admin', null)).toBeNull();
    expect(roleChangeBlocker(siteAdmin, persona, 'grant', 'system_admin', null)).toBe(
      'System Admin is granted and revoked only by a System Admin.',
    );
    expect(roleChangeBlocker(siteAdmin, { accountId: 'x', roles: ['course_admin', 'site_admin'] }, 'grant', 'election_admin', null)).toBe(
      'An account may hold at most 2 roles, and this one already holds Course Administrator and Site Admin.',
    );
  });

  it('while acting as a test persona, refuses any account that is not one (design §10.4)', () => {
    expect(roleChangeBlocker(siteAdmin, persona, 'grant', 'communications_admin', acting)).toBeNull();
    expect(roleChangeBlocker(siteAdmin, real, 'grant', 'course_admin', acting)).toBe(
      "Acting as a test persona, you change the roles of test personas only; stop acting to change a real account's roles.",
    );
    // A typed ID that is no persona: refused too, though its roles are unknown.
    expect(roleChangeBlocker(siteAdmin, { accountId: 'typed', roles: null }, 'grant', 'course_admin', acting)).toMatch(/test personas only/);
    // Personas not loaded yet: the API decides.
    expect(roleChangeBlocker(siteAdmin, real, 'grant', 'course_admin', { personaIds: null })).toBeNull();
  });

  it('checks in the API\'s order: what it checks first, then whether the account is a persona, then the roles held', () => {
    // Granting System Admin is refused before the account is looked at.
    expect(roleChangeBlocker(siteAdmin, real, 'grant', 'system_admin', acting)).toMatch(/only by a System Admin/);
    // A real account whose roles would not allow the change: the persona rule comes first.
    const full = { accountId: 'pat', roles: ['membership_admin', 'election_admin'] as const };
    expect(roleChangeBlocker(siteAdmin, full, 'grant', 'course_admin', acting)).toMatch(/test personas only/);
    // Its own account, whether or not it is a persona.
    expect(roleChangeBlocker(siteAdmin, { accountId: 'test-site-admin', roles: ['site_admin'] }, 'grant', 'course_admin', acting)).toMatch(
      /your own account/,
    );
  });
});

describe('personaStart', () => {
  it('opens each persona where its work is', () => {
    expect(personaStart('voter')).toBe('/ballot');
    expect(personaStart('site_admin')).toEqual({ path: '/admin', query: { tab: 'people' } });
    expect(personaStart('course_admin')).toEqual({ path: '/admin', query: { tab: 'course' } });
    expect(personaStart('election_admin')).toBe('/admin');
  });
});
