import { createHash } from 'node:crypto';
import type { Auth, User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  confirmPasswordReset: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updatePassword: vi.fn(),
}));
vi.mock('firebase/auth', async (original) => ({ ...(await original<object>()), ...firebase }));

const { changePassword, checkNewPassword, PasswordRejected, resetPassword, sendPasswordReset } = await import('./sign-in.js');

const auth = {} as Auth;
const GOOD = 'violet harbor lantern';
const BREACHED = 'This password has appeared in a data breach. Choose another (a few unrelated words work well).';

/** Have I Been Pwned's range API, answering that `breached` (if any) has been seen 42 times. */
function pwned(breached?: string) {
  const fetch = vi.fn(async (url: string) => {
    const suffixes = ['0018A45C4D1DEF81644B54AB7F969B88D65:1'];
    if (breached) {
      const hex = createHash('sha1').update(breached).digest('hex').toUpperCase();
      if (url.endsWith(hex.slice(0, 5))) suffixes.push(`${hex.slice(5)}:42`);
    }
    return new Response(suffixes.join('\r\n'));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://ustpvote2-dev.web.app' });
  for (const fn of Object.values(firebase)) fn.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('checkNewPassword (design §4)', () => {
  it('applies the rule first, without asking the breach service', async () => {
    const fetch = pwned();
    await expect(checkNewPassword('short', 'ada@example.test')).rejects.toEqual(
      new PasswordRejected('Use at least 12 characters (a passphrase works well).'),
    );
    await expect(checkNewPassword('ada@example.test', 'ada@example.test')).rejects.toEqual(
      new PasswordRejected('Don’t use your email address as your password.'),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('then refuses a breached password, sending only the first 5 hex digits of its SHA-1', async () => {
    const fetch = pwned('correct horse battery');
    await expect(checkNewPassword('correct horse battery', 'ada@example.test')).rejects.toEqual(new PasswordRejected(BREACHED));
    const hex = createHash('sha1').update('correct horse battery').digest('hex').toUpperCase();
    expect(fetch).toHaveBeenCalledWith(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
    await expect(checkNewPassword(GOOD, 'ada@example.test')).resolves.toBeUndefined();
  });

  it('lets a password through when the breach service cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(checkNewPassword(GOOD, 'ada@example.test')).resolves.toBeUndefined();
  });
});

describe('sendPasswordReset', () => {
  it('sends the reset email with the sign-in page to continue to', async () => {
    await sendPasswordReset(auth, 'ada@example.test');
    expect(firebase.sendPasswordResetEmail).toHaveBeenCalledWith(auth, 'ada@example.test', { url: 'https://ustpvote2-dev.web.app/signin' });
  });

  it('answers the same for an address with no login, where enumeration protection is off', async () => {
    firebase.sendPasswordResetEmail.mockRejectedValue(Object.assign(new Error('no user'), { code: 'auth/user-not-found' }));
    await expect(sendPasswordReset(auth, 'nobody@example.test')).resolves.toBeUndefined();
  });

  it('passes other failures on', async () => {
    firebase.sendPasswordResetEmail.mockRejectedValue(Object.assign(new Error('slow down'), { code: 'auth/too-many-requests' }));
    await expect(sendPasswordReset(auth, 'ada@example.test')).rejects.toMatchObject({ code: 'auth/too-many-requests' });
  });
});

describe('resetPassword', () => {
  it('sets the new password once it passes the checks', async () => {
    pwned();
    await resetPassword(auth, 'code1', 'ada@example.test', GOOD);
    expect(firebase.confirmPasswordReset).toHaveBeenCalledWith(auth, 'code1', GOOD);
  });

  it('refuses one the checks reject, leaving the link unused', async () => {
    pwned('correct horse battery');
    await expect(resetPassword(auth, 'code1', 'ada@example.test', 'correct horse battery')).rejects.toEqual(new PasswordRejected(BREACHED));
    await expect(resetPassword(auth, 'code1', 'ada@example.test', 'Ada@Example.test')).rejects.toBeInstanceOf(PasswordRejected);
    expect(firebase.confirmPasswordReset).not.toHaveBeenCalled();
  });
});

describe('changePassword', () => {
  const CURRENT = 'old harbor lantern';

  /** A signed-in user whose token's sign-in time moves (or not) when the password changes, as Identity Platform decides. */
  function signedIn(timeMovesOnChange: boolean) {
    let authTime = '2026-11-03T15:00:00.000Z';
    const order: string[] = [];
    const reauthenticate = vi.fn(async (password: string, step: 'confirm' | 'renew') => {
      order.push(`${step}:${password}`);
      authTime = new Date(Date.parse(authTime) + 60_000).toISOString();
      return true;
    });
    firebase.updatePassword.mockImplementation(async () => {
      order.push('update');
      if (timeMovesOnChange) authTime = new Date(Date.parse(authTime) + 1_000).toISOString();
    });
    const me = { email: 'ada@example.test', getIdTokenResult: async () => ({ authTime }) } as unknown as User;
    return { me, order, reauthenticate };
  }

  it('checks the new password, re-authenticates with the current one, then changes it', async () => {
    pwned();
    const { me, order, reauthenticate } = signedIn(true);
    expect(await changePassword(me, CURRENT, GOOD, reauthenticate)).toBe('changed');
    expect(order).toEqual([`confirm:${CURRENT}`, 'update']);
    expect(firebase.updatePassword).toHaveBeenCalledWith(me, GOOD);
  });

  it('signs in again with the new password when the token kept its old sign-in time (the Auth emulator)', async () => {
    pwned();
    const { me, order, reauthenticate } = signedIn(false);
    expect(await changePassword(me, CURRENT, GOOD, reauthenticate)).toBe('changed');
    expect(order).toEqual([`confirm:${CURRENT}`, 'update', `renew:${GOOD}`]);
  });

  it('says to sign in again when that second sign-in is cancelled or fails, the password changed all the same', async () => {
    pwned();
    const cancelled = signedIn(false);
    cancelled.reauthenticate.mockImplementation(async (_password, step) => step === 'confirm');
    expect(await changePassword(cancelled.me, CURRENT, GOOD, cancelled.reauthenticate)).toBe('sign-in-again');
    const failed = signedIn(false);
    failed.reauthenticate.mockImplementation(async (_password, step) => {
      if (step === 'renew') throw new Error('offline');
      return true;
    });
    expect(await changePassword(failed.me, CURRENT, GOOD, failed.reauthenticate)).toBe('sign-in-again');
    expect(firebase.updatePassword).toHaveBeenCalledTimes(2);
  });

  it('asks nothing of someone whose new password is refused', async () => {
    pwned();
    const { me, reauthenticate } = signedIn(true);
    await expect(changePassword(me, CURRENT, 'ada', reauthenticate)).rejects.toBeInstanceOf(PasswordRejected);
    expect(reauthenticate).not.toHaveBeenCalled();
    expect(firebase.updatePassword).not.toHaveBeenCalled();
  });

  it('changes nothing if re-authenticating is cancelled', async () => {
    pwned();
    const { me } = signedIn(true);
    expect(await changePassword(me, CURRENT, GOOD, async () => false)).toBe('cancelled');
    expect(firebase.updatePassword).not.toHaveBeenCalled();
  });
});

describe('the re-authentication window (design §4)', () => {
  it('opens on the signed-in account for Google and Microsoft, and with no hint for Apple or without an address', async () => {
    const { providerFor } = await import('./sign-in.js');
    const params = (p: unknown) => (p as { getCustomParameters(): Record<string, string> }).getCustomParameters();
    expect(params(providerFor('google.com', 'kev@example.test'))).toEqual({ login_hint: 'kev@example.test' });
    expect(params(providerFor('microsoft.com', 'kev@example.test'))).toEqual({ login_hint: 'kev@example.test' });
    expect(params(providerFor('apple.com', 'kev@example.test'))).toEqual({});
    expect(params(providerFor('google.com'))).toEqual({});
    expect(params(providerFor('google.com', null))).toEqual({});
  });
});
