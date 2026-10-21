export interface ServerConfig {
  /** GCP project; Firebase Admin falls back to GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT when unset. */
  readonly projectId: string | undefined;
  /** Firestore and Auth emulators are configured (local development and integration tests). */
  readonly usingEmulators: boolean;
  /** Require a valid X-Firebase-AppCheck token on every authenticated request. */
  readonly appCheckEnforced: boolean;
  /** Admin endpoints require an ID token issued after a second factor. */
  readonly adminMfaRequired: boolean;
  /** Verified emails that receive System Admin when their account is created (design §10.1). Lowercase. */
  readonly bootstrapSystemAdmins: readonly string[];
}

export const CONFIG = Symbol('ServerConfig');

/**
 * Reads configuration from the environment. The two safety switches can only be turned off against the
 * emulators: in a real project the server refuses to start rather than run without App Check or admin MFA.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const usingEmulators = Boolean(env.FIRESTORE_EMULATOR_HOST && env.FIREBASE_AUTH_EMULATOR_HOST);
  const appCheckEnforced = env.APP_CHECK_ENFORCED !== 'false';
  const adminMfaRequired = env.ADMIN_MFA_REQUIRED !== 'false';
  if (!usingEmulators && (!appCheckEnforced || !adminMfaRequired)) {
    throw new Error('APP_CHECK_ENFORCED=false and ADMIN_MFA_REQUIRED=false are only allowed with the Firebase emulators');
  }
  return {
    projectId: env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || undefined,
    usingEmulators,
    appCheckEnforced,
    adminMfaRequired,
    bootstrapSystemAdmins: (env.BOOTSTRAP_SYSTEM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}
