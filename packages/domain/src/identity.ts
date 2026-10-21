/**
 * Identity Platform providers the system accepts, by the ID token's `firebase.sign_in_provider` claim
 * (design §4). Passwordless email link and email/password both report `password`, so switching between
 * those two is done in Identity Platform's own configuration; the API switch covers both.
 */
export const SIGN_IN_PROVIDERS = ['google.com', 'microsoft.com', 'apple.com', 'password'] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

export function isSignInProvider(value: unknown): value is SignInProvider {
  return typeof value === 'string' && (SIGN_IN_PROVIDERS as readonly string[]).includes(value);
}
