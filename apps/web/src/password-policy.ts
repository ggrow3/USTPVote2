/**
 * The rule for new email/password logins (design §4): 12 or more characters of any kind, counted as Unicode code points
 * (NIST SP 800-63B-4), with no composition rules. A password that is just the email address, the party's name, or one
 * character over and over (spaces and dots alone count too) is refused, since those are the first guesses. Identity Platform enforces the length; the
 * breached-password screen in sign-in.ts comes on top.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Shown under the password field when creating a login. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters, any you like. A few unrelated words work well.`;

/** The party's names, compared with the whole password once case and spaces are set aside. */
const PARTY_NAMES = ['transhumanist', 'transhumanistparty', 'ustranshumanistparty', 'unitedstatestranshumanistparty', 'ustpvote'];

const squeeze = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '');

/** Returns a problem with the password, or null if it meets the rule. `email` is the address the login is for. */
export function passwordProblem(password: string, email = ''): string | null {
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters (a passphrase works well).`;
  if (length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  const guess = squeeze(password);
  const address = squeeze(email.trim());
  if (address && (guess === address || guess === address.split('@')[0])) return 'Don’t use your email address as your password.';
  if (!guess || PARTY_NAMES.includes(guess) || /^(.)\1*$/su.test(guess)) {
    return 'That password is too easy to guess. Choose another (a few unrelated words work well).';
  }
  return null;
}
