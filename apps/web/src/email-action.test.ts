import { describe, expect, it } from 'vitest';
import { emailAction, identityPlatformActionPage } from './email-action.js';

const HANDLER = 'https://ustpvote2-dev.firebaseapp.com/__/auth/action';
const at = (query: string) => emailAction(`https://ustpvote2-dev.web.app/email-action${query}`, HANDLER);

describe('emailAction (design §4)', () => {
  it('handles a password reset here', () => {
    expect(at('?mode=resetPassword&oobCode=abc123&apiKey=AIza&lang=en')).toEqual({ kind: 'reset-password', oobCode: 'abc123' });
  });

  it('sends every other link on to Identity Platform’s own page, query and all', () => {
    for (const mode of ['verifyEmail', 'signIn', 'recoverEmail', 'verifyAndChangeEmail', 'revertSecondFactorAddition']) {
      const query = `?mode=${mode}&oobCode=x%2By&apiKey=AIza&continueUrl=https%3A%2F%2Fustpvote2-dev.web.app%2Fregister&lang=en`;
      expect(at(query)).toEqual({ kind: 'elsewhere', url: `${HANDLER}${query}` });
    }
  });

  it('calls a link without its mode or code incomplete', () => {
    expect(at('')).toEqual({ kind: 'incomplete' });
    expect(at('?mode=resetPassword')).toEqual({ kind: 'incomplete' });
    expect(at('?oobCode=abc123')).toEqual({ kind: 'incomplete' });
    expect(at('?mode=resetPassword&oobCode=')).toEqual({ kind: 'incomplete' });
  });
});

describe('identityPlatformActionPage', () => {
  it('is the hosted page on the auth domain, or the Auth emulator’s', () => {
    expect(identityPlatformActionPage({ config: { authDomain: 'ustpvote2-dev.firebaseapp.com' }, emulatorConfig: null } as never)).toBe(HANDLER);
    expect(
      identityPlatformActionPage({
        config: { authDomain: 'demo-ustpvote.firebaseapp.com' },
        emulatorConfig: { protocol: 'http', host: '127.0.0.1', port: 9099, options: { disableWarnings: true } },
      } as never),
    ).toBe('http://127.0.0.1:9099/emulator/action');
  });
});
