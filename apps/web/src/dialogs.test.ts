import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebase.js', () => ({ auth: { currentUser: null } }));
vi.mock('./router.js', () => ({ router: { push: vi.fn() } }));

const { reauthError } = await import('./dialogs.js');

describe('a failed confirmation of who is signed in (design §4)', () => {
  const mismatch = Object.assign(new Error('Firebase: Error (auth/user-mismatch).'), { code: 'auth/user-mismatch' });

  it('names the account to choose when another was chosen in the sign-in window', () => {
    expect(reauthError(mismatch, 'kev@example.test')).toBe(
      'That is a different account. In the sign-in window, choose kev@example.test, the account you are signed in with, and try again.',
    );
  });

  it('says so in general without the address, and leaves other errors as they are', () => {
    expect(reauthError(mismatch, null)).toBe('That is a different account. In the sign-in window, choose the account you are signed in with, and try again.');
    expect(reauthError(new Error('Firebase: Error (auth/popup-closed-by-user).'), 'kev@example.test')).toBe('Error (auth/popup-closed-by-user).');
  });
});
