import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  sendEmailVerification,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  type Auth,
  type AuthProvider,
} from 'firebase/auth';
import type { SignInProvider } from 'ustp-domain';

/** NIST SP 800-63B-4 single-factor minimum (design §4); applied to every account. */
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

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

/** Returns a problem with the password, or null if it meets the policy. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `use at least ${MIN_PASSWORD_LENGTH} characters (a passphrase works well)`;
  if (password.length > MAX_PASSWORD_LENGTH) return `use at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

export async function signUpWithPassword(auth: Auth, email: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
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
