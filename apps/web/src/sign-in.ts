import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  type Auth,
  type AuthProvider,
  type User,
} from 'firebase/auth';
import type { SignInProvider } from 'ustp-domain';
import { passwordProblem } from './password-policy.js';

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordProblem } from './password-policy.js';

export type FederatedProvider = Exclude<SignInProvider, 'password'>;

export const PROVIDER_LABELS: Record<SignInProvider, string> = {
  'google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
  password: 'Email',
};

function providerFor(id: FederatedProvider): AuthProvider {
  if (id === 'google.com') return new GoogleAuthProvider();
  const provider = new OAuthProvider(id);
  provider.addScope('email');
  return provider;
}

export function signInWithProvider(auth: Auth, id: FederatedProvider) {
  return signInWithPopup(auth, providerFor(id));
}

export function isFederatedProvider(id: string): id is FederatedProvider {
  return id === 'google.com' || id === 'microsoft.com' || id === 'apple.com';
}

/** Proves the signed-in user is still present, refreshing `auth_time` (design §10.2: approvals need ≤ 15 minutes). */
export function reauthenticate(user: User, method: { provider: FederatedProvider } | { password: string }) {
  return 'provider' in method
    ? reauthenticateWithPopup(user, providerFor(method.provider))
    : reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', method.password));
}

/**
 * How often the password appears in known breaches (design §4, Q9), from Have I Been Pwned's k-anonymity range API:
 * only the first 5 hex digits of its SHA-1 leave the browser, and padded responses hide which range was of interest.
 * Null when the service cannot be reached, so an outage does not stop anyone signing up.
 */
export async function breachCount(password: string): Promise<number | null> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return null;
    const suffix = hex.slice(5);
    for (const line of (await res.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':');
      if (candidate === suffix) return Number(count);
    }
    return 0;
  } catch {
    return null;
  }
}

/** The chosen password breaks the policy or is breached, so the form can show the message on the password field. */
export class PasswordRejected extends Error {}

/** Creates an email/password login and sends the verification email, whose link leads back to registering. */
export async function signUpWithPassword(auth: Auth, email: string, password: string) {
  const problem = passwordProblem(password, email);
  if (problem) throw new PasswordRejected(problem);
  const breaches = await breachCount(password);
  if (breaches) {
    throw new PasswordRejected('This password has appeared in a data breach. Choose another (a few unrelated words work well).');
  }
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user, { url: `${location.origin}/register` });
  return credential;
}

export function signInWithPassword(auth: Auth, email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

const EMAIL_LINK_KEY = 'ustp.emailLinkAddress';

export async function sendEmailLink(auth: Auth, email: string): Promise<void> {
  await sendSignInLinkToEmail(auth, email, { url: `${location.origin}/signin`, handleCodeInApp: true });
  try {
    localStorage.setItem(EMAIL_LINK_KEY, email);
  } catch {
    // Storage unavailable: the user will be asked for their email when they open the link.
  }
}

/** If the current URL is an email sign-in link, the address it was sent to (when this browser remembers it). */
export function pendingEmailLink(auth: Auth): { isLink: boolean; email: string | null } {
  if (!isSignInWithEmailLink(auth, location.href)) return { isLink: false, email: null };
  let email: string | null = null;
  try {
    email = localStorage.getItem(EMAIL_LINK_KEY);
  } catch {
    // ignore
  }
  return { isLink: true, email };
}

export async function completeEmailLink(auth: Auth, email: string) {
  const credential = await signInWithEmailLink(auth, email, location.href);
  try {
    localStorage.removeItem(EMAIL_LINK_KEY);
  } catch {
    // ignore
  }
  return credential;
}
