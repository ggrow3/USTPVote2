import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordProblem } from './password-policy.js';

describe('the password rule', () => {
  it('accepts 12 or more characters of any kind, with no composition rules', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordProblem('violet harbor')).toBeNull();
    expect(passwordProblem('alllowercase')).toBeNull();
    expect(passwordProblem('123456789012x')).toBeNull(); // breached ones are the breach screen's job
    expect(passwordProblem('pässwörd für €')).toBeNull();
    expect(passwordProblem(' leading space')).toBeNull();
    expect(passwordProblem('x'.repeat(MAX_PASSWORD_LENGTH - 1) + 'y')).toBeNull();
    expect(PASSWORD_HINT).toBe('At least 12 characters, any you like. A few unrelated words work well.');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(passwordProblem('🦊🦊🦊🦊🦊 fox den')).toBeNull(); // 13 characters
    expect(passwordProblem('🦊🦊🦊🦊🦊🦊 fox')).toBe('Use at least 12 characters (a passphrase works well).'); // 10, but 16 units
  });

  it('refuses short and overlong passwords', () => {
    expect(passwordProblem('')).toBe('Use at least 12 characters (a passphrase works well).');
    expect(passwordProblem('elevenchars')).toBe('Use at least 12 characters (a passphrase works well).');
    expect(passwordProblem('x'.repeat(MAX_PASSWORD_LENGTH) + 'y')).toBe(`Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  });

  it('refuses the email address, whole or before the @, in any case and spacing', () => {
    const email = 'ada.brooks.2026@example.test';
    expect(passwordProblem('ada.brooks.2026@example.test', email)).toBe('Don’t use your email address as your password.');
    expect(passwordProblem('Ada Brooks 2026', email)).toBe('Don’t use your email address as your password.');
    expect(passwordProblem('Ada Brooks 2026!', email)).toBeNull(); // only the whole password is compared
    expect(passwordProblem('ada.brooks.2026@example.test', '')).toBeNull();
  });

  it('refuses the party’s name and one character over and over', () => {
    const tooEasy = 'That password is too easy to guess. Choose another (a few unrelated words work well).';
    expect(passwordProblem('Transhumanist Party')).toBe(tooEasy);
    expect(passwordProblem('US Transhumanist Party')).toBe(tooEasy);
    expect(passwordProblem('aaaaaaaaaaaa')).toBe(tooEasy);
    expect(passwordProblem('AAAA aaaa AAAA')).toBe(tooEasy);
    expect(passwordProblem('            ')).toBe(tooEasy);
    expect(passwordProblem('Transhumanist Party of Kansas')).toBeNull();
  });
});
