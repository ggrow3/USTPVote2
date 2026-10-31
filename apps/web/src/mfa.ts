import {
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
  type Auth,
  type MultiFactorError,
  type MultiFactorInfo,
  type TotpSecret,
  type User,
  type UserCredential,
} from 'firebase/auth';
import QRCode from 'qrcode';
import { APP_NAME } from './app-name.js';

/**
 * Two-step verification with an authenticator app (TOTP), required for admin roles (design §4). SMS is not offered:
 * NIST SP 800-63B-4 restricts it, and Identity Platform bills per message.
 */

export const ISSUER = APP_NAME;
export const CODE_PATTERN = /^\d{6}$/;

/** Sign-in (or re-authentication) stopped and needs the second step. */
export function isSecondFactorChallenge(error: unknown): error is MultiFactorError {
  return (error as { code?: unknown } | null)?.code === 'auth/multi-factor-auth-required';
}

export function enrolledFactors(user: User | null): MultiFactorInfo[] {
  return user ? [...multiFactor(user).enrolledFactors] : [];
}

export function hasAuthenticatorHint(auth: Auth, challenge: MultiFactorError): boolean {
  return getMultiFactorResolver(auth, challenge).hints.some((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
}

/** Completes a challenged sign-in with a 6-digit code from the authenticator app. */
export async function resolveWithAuthenticator(auth: Auth, challenge: MultiFactorError, code: string): Promise<UserCredential> {
  const resolver = getMultiFactorResolver(auth, challenge);
  const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) {
    throw new Error(`This account's second step is not an authenticator app, which ${APP_NAME} does not support. Ask a System Admin for help.`);
  }
  return resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim()));
}

export interface AuthenticatorSetup {
  readonly secret: TotpSecret;
  /** For typing into the app when the QR code cannot be scanned. */
  readonly key: string;
  readonly qrDataUrl: string;
}

export async function beginAuthenticatorSetup(user: User): Promise<AuthenticatorSetup> {
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const uri = secret.generateQrCodeUrl(user.email ?? 'member', ISSUER);
  return { secret, key: secret.secretKey, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 200 }) };
}

export async function finishAuthenticatorSetup(user: User, setup: AuthenticatorSetup, code: string, name: string): Promise<void> {
  await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(setup.secret, code.trim()), name);
}

export function removeFactor(user: User, factor: MultiFactorInfo): Promise<void> {
  return multiFactor(user).unenroll(factor);
}
