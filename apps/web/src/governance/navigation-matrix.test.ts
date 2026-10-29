import { AUDIENCES, MEMBERSHIP_AUDIENCES, menuLock, ROLES } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { cellRuns } from './navigation-matrix.js';

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
