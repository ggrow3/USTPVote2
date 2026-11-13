import { ADMIN_SECTIONS, AUDIENCES, MENU_LINKS, ROLE_LINK_STATES, ROLES, START_PAGES } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_LABELS,
  cellName,
  describeChange,
  lockText,
  MENU_CAPTIONS,
  MENU_LABELS,
  ROLE_LINK_STATE_LABELS,
  roleCellName,
  SECTION_LABELS,
  startPageLabel,
} from './navigation-text.js';

describe('navigation settings wording', () => {
  it('names every cell by what it shows and to whom', () => {
    expect(cellName('ballot', 'applicant', 'link')).toBe('Show Ballot to Applicant');
    expect(cellName('members', 'membership_admin', 'section')).toBe('Show Admin › Members to Membership Admin');
    expect(cellName('offices', 'auditor', 'link')).toBe('Show Offices to Auditor');
    expect(cellName('offices', 'auditor', 'section')).toBe('Show Admin › Offices to Auditor');
    const names = AUDIENCES.flatMap((a) => [
      ...MENU_LINKS.map((l) => cellName(l, a, 'link')),
      ...ADMIN_SECTIONS.map((s) => cellName(s, a, 'section')),
    ]);
    // A staff role's menu cell is a list of three states, named by the link and the role.
    const roleNames = ROLES.flatMap((r) => MENU_LINKS.map((l) => roleCellName(l, r)));
    expect(roleCellName('register', 'system_admin')).toBe('Register for System Admin');
    expect(new Set([...names, ...roleNames]).size).toBe(names.length + roleNames.length);
  });

  it("words the three states of a staff role's menu cell", () => {
    expect(ROLE_LINK_STATES.map((state) => ROLE_LINK_STATE_LABELS[state])).toEqual([
      'Shown: added to their membership',
      'Not added: their membership decides',
      'Hidden, whatever their membership',
    ]);
  });

  it('labels every audience, section and start page', () => {
    expect(AUDIENCES.every((a) => AUDIENCE_LABELS[a])).toBe(true);
    expect(ADMIN_SECTIONS.every((s) => SECTION_LABELS[s])).toBe(true);
    expect(START_PAGES.map(startPageLabel)).toContain('Admin › Sign-in methods');
    expect(startPageLabel('home')).toBe('Voting home');
    expect(startPageLabel('ballot')).toBe('Ballot');
    expect(MENU_LINKS.every((l) => MENU_LABELS[l] && MENU_CAPTIONS[l])).toBe(true);
    expect(startPageLabel('offices')).toBe('Offices');
  });

  it('says why a cell is locked', () => {
    expect(lockText('not_permitted', 'election_admin', 'members')).toBe('Not available: only Membership Admins may use this');
    expect(lockText('not_permitted', 'system_admin', 'elections')).toBe(
      'Not available: only Election Admins and Auditors may use this',
    );
    expect(lockText('no_role', 'active', 'audit')).toMatch(/staff roles/);
    expect(lockText('guarded', 'system_admin', 'people')).toMatch(/cannot be locked out/);
    expect(lockText('follows_sections', 'auditor', undefined, true)).toBe('Shown while Auditors have any admin section');
    expect(lockText('follows_sections', 'auditor', undefined, false)).toBe('Hidden while Auditors have no admin section');
    expect(lockText('signed_in', 'active')).toBe('Not applicable: already signed in');
  });

  it('describes each change in words', () => {
    expect(describeChange({ audience: 'applicant', link: 'ballot', shown: false })).toBe('Hide Ballot from Applicant');
    expect(describeChange({ audience: 'system_admin', section: 'offices', shown: true })).toBe('Show Admin › Offices to System Admin');
    expect(describeChange({ audience: 'active', startsOn: 'admin/elections' })).toBe('Active member starts on Admin › Elections');
    expect(describeChange({ audience: 'signed_out', link: 'signin', shown: false })).toBe('Hide Sign in from Signed out');
    // A staff role's menu cell: shown, hidden whatever their membership, or left to their membership.
    expect(describeChange({ audience: 'system_admin', link: 'register', shown: false, hidden: true })).toBe(
      'Hide Register from System Admin, whatever their membership',
    );
    expect(describeChange({ audience: 'system_admin', link: 'register', shown: false, hidden: false })).toBe(
      'Let membership decide Register for System Admin',
    );
    expect(describeChange({ audience: 'auditor', link: 'news', shown: false })).toBe('Let membership decide News for Auditor');
    expect(describeChange({ audience: 'auditor', link: 'news', shown: true, hidden: false })).toBe('Show News to Auditor');
    // A role's Admin link follows its sections: it is hidden, never left to membership.
    expect(describeChange({ audience: 'auditor', link: 'admin', shown: false })).toBe('Hide Admin from Auditor');
  });
});
