import { AUDIENCES, DEFAULT_NAVIGATION, MEMBERSHIP_AUDIENCES, menuLock, roleLinkState, ROLES } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { cellRuns, setRoleLink } from './navigation-matrix.js';

const signedIn = (a: (typeof AUDIENCES)[number]) => (menuLock(a, 'signin') === 'signed_in' ? 'signed in' : null);

describe('navigation matrix layout', () => {
  it('merges the Sign in row for everyone signed in into one cell', () => {
    expect(cellRuns(AUDIENCES, signedIn)).toEqual([{ audience: 'signed_out' }, { audiences: AUDIENCES.slice(1), reason: 'signed in' }]);
    expect(cellRuns(MEMBERSHIP_AUDIENCES, signedIn)).toEqual([
      { audience: 'signed_out' },
      { audiences: MEMBERSHIP_AUDIENCES.slice(1), reason: 'signed in' },
    ]);
    expect(cellRuns(ROLES, signedIn)).toEqual([{ audiences: ROLES, reason: 'signed in' }]);
  });

  it('keeps every cell of its own where nothing is merged', () => {
    expect(cellRuns(ROLES, () => null)).toEqual(ROLES.map((audience) => ({ audience })));
    expect(cellRuns([], () => 'x')).toEqual([]);
  });

  it('merges only neighbours with the same reason', () => {
    const reasons: Record<string, string | null> = { a: 'x', b: 'x', c: null, d: 'x', e: 'y' };
    expect(cellRuns(['a', 'b', 'c', 'd', 'e'], (k) => reasons[k] ?? null)).toEqual([
      { audiences: ['a', 'b'], reason: 'x' },
      { audience: 'c' },
      { audiences: ['d'], reason: 'x' },
      { audiences: ['e'], reason: 'y' },
    ]);
  });
});

describe("a staff role's menu cell", () => {
  it('sets shown, not added or hidden, never both shown and hidden', () => {
    const draft = structuredClone(DEFAULT_NAVIGATION);
    setRoleLink(draft, 'system_admin', 'register', 'hidden');
    expect([draft.menu.system_admin.register, draft.hiddenFrom.system_admin.register]).toEqual([false, true]);
    expect(roleLinkState(draft, 'system_admin', 'register')).toBe('hidden');
    setRoleLink(draft, 'system_admin', 'register', 'shown');
    expect([draft.menu.system_admin.register, draft.hiddenFrom.system_admin.register]).toEqual([true, false]);
    expect(roleLinkState(draft, 'system_admin', 'register')).toBe('shown');
    setRoleLink(draft, 'system_admin', 'register', 'membership');
    expect([draft.menu.system_admin.register, draft.hiddenFrom.system_admin.register]).toEqual([false, false]);
    expect(draft).toEqual(DEFAULT_NAVIGATION);
  });
});
