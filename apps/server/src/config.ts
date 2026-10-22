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
  /** Private bucket for profile photos (design §5.3); photo endpoints answer 503 until it is set. */
  readonly photosBucket: string | null;
  /** `vision`: Cloud Vision. `local`: the emulator-only stand-in (no face detection). */
  readonly photoChecker: 'vision' | 'local';
  /** Where tie-break seeds are kept: Secret Manager, or the emulator-only Firestore stand-in. */
  readonly secretStore: 'secret-manager' | 'emulator';
  /** Who signs ledger blocks and rolls (worker only): Cloud KMS, or the emulator-only local key. */
  readonly auditSigner: 'kms' | 'emulator';
  /** `projects/.../cryptoKeys/audit-signing/cryptoKeyVersions/N`; signing fails until it is set. */
  readonly auditSigningKeyVersion: string | null;
  /** Bucket with a retention policy for ledger anchors (design §8.4); anchoring is skipped until it is set. */
  readonly anchorsBucket: string | null;
  /** Ballot-pool keys (design §7.3): Cloud KMS, or the emulator-only local keys. */
  readonly ballotPool: 'kms' | 'emulator';
  /** `projects/.../cryptoKeys/ballot-pool` (RSA_DECRYPT_OAEP_3072_SHA256); secret elections cannot open until it is set. */
  readonly ballotPoolKey: string | null;
}

export const CONFIG = Symbol('ServerConfig');

/**
 * Reads configuration from the environment. The safety switches can only be relaxed against the emulators: in a real
 * project the server refuses to start rather than run without App Check, admin MFA or real photo checks.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const usingEmulators = Boolean(env.FIRESTORE_EMULATOR_HOST && env.FIREBASE_AUTH_EMULATOR_HOST);
  const appCheckEnforced = env.APP_CHECK_ENFORCED !== 'false';
  const adminMfaRequired = env.ADMIN_MFA_REQUIRED !== 'false';
  if (!usingEmulators && (!appCheckEnforced || !adminMfaRequired)) {
    throw new Error('APP_CHECK_ENFORCED=false and ADMIN_MFA_REQUIRED=false are only allowed with the Firebase emulators');
  }
  const photoChecker = (env.PHOTO_CHECKER ?? (usingEmulators ? 'local' : 'vision')) as ServerConfig['photoChecker'];
  if (photoChecker !== 'vision' && photoChecker !== 'local') throw new Error('PHOTO_CHECKER must be "vision" or "local"');
  if (photoChecker === 'local' && !usingEmulators) throw new Error('PHOTO_CHECKER=local is only allowed with the Firebase emulators');
  const secretStore = (env.SECRET_STORE ?? (usingEmulators ? 'emulator' : 'secret-manager')) as ServerConfig['secretStore'];
  if (secretStore !== 'secret-manager' && secretStore !== 'emulator') {
    throw new Error('SECRET_STORE must be "secret-manager" or "emulator"');
  }
  if (secretStore === 'emulator' && !usingEmulators) throw new Error('SECRET_STORE=emulator is only allowed with the Firebase emulators');
  const auditSigner = (env.AUDIT_SIGNER ?? (usingEmulators ? 'emulator' : 'kms')) as ServerConfig['auditSigner'];
  if (auditSigner !== 'kms' && auditSigner !== 'emulator') throw new Error('AUDIT_SIGNER must be "kms" or "emulator"');
  if (auditSigner === 'emulator' && !usingEmulators) throw new Error('AUDIT_SIGNER=emulator is only allowed with the Firebase emulators');
  const ballotPool = (env.BALLOT_POOL ?? (usingEmulators ? 'emulator' : 'kms')) as ServerConfig['ballotPool'];
  if (ballotPool !== 'kms' && ballotPool !== 'emulator') throw new Error('BALLOT_POOL must be "kms" or "emulator"');
  if (ballotPool === 'emulator' && !usingEmulators) throw new Error('BALLOT_POOL=emulator is only allowed with the Firebase emulators');

  const projectId = env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || undefined;
  return {
    projectId,
    usingEmulators,
    appCheckEnforced,
    adminMfaRequired,
    bootstrapSystemAdmins: (env.BOOTSTRAP_SYSTEM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    photosBucket: env.PHOTOS_BUCKET || (usingEmulators && projectId ? `${projectId}-profile-photos` : null),
    photoChecker,
    secretStore,
    auditSigner,
    auditSigningKeyVersion: env.AUDIT_SIGNING_KEY_VERSION || null,
    anchorsBucket: env.ANCHORS_BUCKET || (usingEmulators && projectId ? `${projectId}-anchors` : null),
    ballotPool,
    ballotPoolKey: env.BALLOT_POOL_KEY || null,
  };
}
