import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../config.js';
import type { Firebase } from '../infra/firebase.js';
import { SignInLinks } from './sign-in-links.js';

const config = (webOrigin: string | null) => ({ webOrigin }) as ServerConfig;
const firebase = (generateSignInWithEmailLink: (email: string, settings: object) => Promise<string>) =>
  ({ auth: { generateSignInWithEmailLink } }) as unknown as Firebase;

describe('SignInLinks', () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks Identity Platform for the address's sign-in link, opening the set-password page", async () => {
    const generate = vi.fn(async () => 'https://vote.example.org/email-action?mode=signIn&oobCode=abc');
    const links = new SignInLinks(firebase(generate), config('https://vote.example.org'));
    expect(await links.forSetPassword('ada@example.org')).toBe('https://vote.example.org/email-action?mode=signIn&oobCode=abc');
    expect(generate).toHaveBeenCalledWith('ada@example.org', { url: 'https://vote.example.org/set-password', handleCodeInApp: true });
  });

  it("gives none when Identity Platform refuses, saying why by code and never the address", async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const refused = Object.assign(new Error('Caller lacks permission for ada@example.org'), { code: 'auth/insufficient-permission' });
    const links = new SignInLinks(firebase(async () => Promise.reject(refused)), config('https://vote.example.org'));
    expect(await links.forSetPassword('ada@example.org')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('auth/insufficient-permission');
    expect(warn.mock.calls[0]![0]).not.toContain('ada@example.org');
  });

  it('gives none without WEB_ORIGIN', async () => {
    const generate = vi.fn(async () => 'link');
    expect(await new SignInLinks(firebase(generate), config(null)).forSetPassword('ada@example.org')).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});
