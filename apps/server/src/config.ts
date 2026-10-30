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
  /** `dev`, `staging` or `prod`, set by Terraform; null when unset, as against the emulators. */
  readonly deploymentEnvironment: 'dev' | 'staging' | 'prod' | null;
  /** System Admins may create test personas and act as them (design §10.4). Never in production. */
  readonly testingMode: boolean;
  /**
   * The advisory bylaws check (design §5.2): `claude` (the worker sends drafts to Anthropic, with the key a System Admin
   * adds, §5.6), `stub` (the emulator-only stand-in) or `off` (requests answer 503). Off unless set, outside the
   * emulators.
   */
  readonly bylawsChecker: 'claude' | 'stub' | 'off';
  /**
   * The platform consistency check (design §5.5), switched on its own because voters can ask for it: `claude`, `stub`
   * (the emulator-only stand-in) or `off` (requests answer 503). Off unless set, outside the emulators.
   */
  readonly consistencyChecker: 'claude' | 'stub' | 'off';
  /**
   * The election setup check (design §6.9), switched on its own because it sends an election's rules and proposal texts
   * with the bylaws, and its notes are shown to every member: `claude`, `stub` (the emulator-only stand-in) or `off`
   * (requests answer 503). Off unless set, outside the emulators.
   */
  readonly electionChecker: 'claude' | 'stub' | 'off';
  readonly bylawsCheckModel: string;
  readonly consistencyCheckModel: string;
  readonly electionCheckModel: string;
  /**
   * How election notices are sent (design §6.8): `ses` through Amazon SES, `outbox` recorded in Firestore instead of
   * mailed (the emulator-only stand-in), `off` not at all. Off unless set, outside the emulators.
   */
  readonly mailTransport: 'ses' | 'outbox' | 'off';
  /** The notices' From header. */
  readonly mailFrom: string;
  /** Their Reply-To header; null for none (the agreed From address takes no replies). */
  readonly mailReplyTo: string | null;
  /** Where the notices tell members to ask about an election (an address or a web page); null until set. */
  readonly noticeContact: string | null;
  /** Where the web app is served (an origin, e.g. `https://ustpvote2-dev.web.app`); notices link to it. */
  readonly webOrigin: string | null;
  /**
   * Where candidacies' districts come from (design §5.8): `census`, the Census Bureau's TIGERweb boundaries, or `local`
   * (the emulator-only stand-in, a few made-up districts per state, for tests that must not reach the internet).
   */
  readonly districtSource: 'census' | 'local';
  /**
   * The browser key for Google Maps on the Candidates page (design §5.8), restricted by Terraform to the Maps JavaScript
   * API and the web app's origins; it is public by nature. Null leaves the page without its map.
   */
  readonly googleMapsKey: string | null;
  /**
   * How many entries the proxies in front of the api append to X-Forwarded-For after the client's address (design
   * §10.7): the sign-in log takes the entry just before theirs. 1 unless set; checked on each deployment.
   */
  readonly trustedProxyHops: number;
  /**
   * The members' room's model (design §5.10): `ollama`, the self-hosted Ollama server at `roomModelUrl` (Gemma for
   * answers, EmbeddingGemma for search; nothing goes to an AI company), `local` (the emulator-only stand-in, answering
   * from keyword overlap) or `off` (`/ask` answers 503; the chat and memory work). Off unless set, outside the emulators.
   */
  readonly roomModel: 'ollama' | 'local' | 'off';
  readonly room: {
    /** The Ollama server: the private `room-model` Cloud Run service (called with an ID token), or a local one. */
    readonly modelUrl: string | null;
    readonly chatModel: string;
    readonly embedModel: string;
    /**
     * How a question reaches the assistant: `cloud-tasks`, a task on the worker queue that calls the worker (the model
     * may take minutes to load, longer than a request through Hosting may wait), or `inline` (the emulator-only stand-in:
     * the api answers it itself, after replying).
     */
    readonly dispatch: 'cloud-tasks' | 'inline';
    /** `projects/{p}/locations/{l}/queues/worker`. */
    readonly tasksQueue: string | null;
    /** The worker's URL, which the tasks call. */
    readonly workerUrl: string | null;
    /** The account whose OIDC token the tasks carry (the worker admits only it). */
    readonly tasksInvoker: string | null;
    /**
     * The STUN servers browsers in the room's call use to find their public address (`ROOM_VOICE_STUN`, comma-separated,
     * or `off`): they see that address, never the call.
     */
    readonly voiceStun: readonly string[];
  };
  /**
   * Amazon SES (worker only, `MAIL_TRANSPORT=ses`): its region, the configuration set that publishes bounces, the SQS
   * queue they arrive on, and the access key (from Secret Manager in Cloud Run; never logged).
   */
  readonly ses: {
    readonly region: string | null;
    readonly configurationSet: string | null;
    readonly eventsQueueUrl: string | null;
    readonly accessKeyId: string | null;
    readonly secretAccessKey: string | null;
    /** Messages a second at most, within the account's SES sending quota. */
    readonly maxSendRate: number;
  };
}

/** Gemma 4 26B A4B, quantization-aware 4-bit (16 GB, to fit one L4 with its context); `ROOM_CHAT_MODEL` overrides it. */
export const DEFAULT_ROOM_CHAT_MODEL = 'gemma4:26b-a4b-it-qat';
/** EmbeddingGemma (768 dimensions); `ROOM_EMBED_MODEL` overrides it. */
export const DEFAULT_ROOM_EMBED_MODEL = 'embeddinggemma';
/** Google's public STUN server; `ROOM_VOICE_STUN` overrides it. */
export const DEFAULT_ROOM_VOICE_STUN = ['stun:stun.l.google.com:19302'];

/** Claude Opus 5.5; `BYLAWS_CHECK_MODEL` overrides it. */
export const DEFAULT_BYLAWS_CHECK_MODEL = 'claude-opus-5-5';
/** Claude Opus 5.5; `CONSISTENCY_CHECK_MODEL` overrides it. */
export const DEFAULT_CONSISTENCY_CHECK_MODEL = 'claude-opus-5-5';
/** Claude Opus 5.5; `ELECTION_CHECK_MODEL` overrides it. */
export const DEFAULT_ELECTION_CHECK_MODEL = 'claude-opus-5-5';

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
  const deploymentEnvironment = (env.DEPLOYMENT_ENVIRONMENT || null) as ServerConfig['deploymentEnvironment'];
  if (deploymentEnvironment !== null && !['dev', 'staging', 'prod'].includes(deploymentEnvironment)) {
    throw new Error('DEPLOYMENT_ENVIRONMENT must be "dev", "staging" or "prod"');
  }
  const testingMode = env.TESTING_MODE === 'true';
  if (testingMode && !usingEmulators && deploymentEnvironment !== 'dev' && deploymentEnvironment !== 'staging') {
    throw new Error('TESTING_MODE=true is only allowed with the Firebase emulators or DEPLOYMENT_ENVIRONMENT dev or staging');
  }
  const bylawsChecker = (env.BYLAWS_CHECKER ?? (usingEmulators ? 'stub' : 'off')) as ServerConfig['bylawsChecker'];
  if (!['claude', 'stub', 'off'].includes(bylawsChecker)) throw new Error('BYLAWS_CHECKER must be "claude", "stub" or "off"');
  if (bylawsChecker === 'stub' && !usingEmulators) throw new Error('BYLAWS_CHECKER=stub is only allowed with the Firebase emulators');
  const consistencyChecker = (env.CONSISTENCY_CHECKER ?? (usingEmulators ? 'stub' : 'off')) as ServerConfig['consistencyChecker'];
  if (!['claude', 'stub', 'off'].includes(consistencyChecker)) throw new Error('CONSISTENCY_CHECKER must be "claude", "stub" or "off"');
  if (consistencyChecker === 'stub' && !usingEmulators) {
    throw new Error('CONSISTENCY_CHECKER=stub is only allowed with the Firebase emulators');
  }
  const electionChecker = (env.ELECTION_CHECKER ?? (usingEmulators ? 'stub' : 'off')) as ServerConfig['electionChecker'];
  if (!['claude', 'stub', 'off'].includes(electionChecker)) throw new Error('ELECTION_CHECKER must be "claude", "stub" or "off"');
  if (electionChecker === 'stub' && !usingEmulators) throw new Error('ELECTION_CHECKER=stub is only allowed with the Firebase emulators');

  const mailTransport = (env.MAIL_TRANSPORT ?? (usingEmulators ? 'outbox' : 'off')) as ServerConfig['mailTransport'];
  if (!['ses', 'outbox', 'off'].includes(mailTransport)) throw new Error('MAIL_TRANSPORT must be "ses", "outbox" or "off"');
  if (mailTransport === 'outbox' && !usingEmulators) throw new Error('MAIL_TRANSPORT=outbox is only allowed with the Firebase emulators');
  const districtSource = (env.DISTRICTS ?? 'census') as ServerConfig['districtSource'];
  if (districtSource !== 'census' && districtSource !== 'local') throw new Error('DISTRICTS must be "census" or "local"');
  if (districtSource === 'local' && !usingEmulators) throw new Error('DISTRICTS=local is only allowed with the Firebase emulators');
  const roomModel = (env.ROOM_MODEL ?? (usingEmulators ? 'local' : 'off')) as ServerConfig['roomModel'];
  if (!['ollama', 'local', 'off'].includes(roomModel)) throw new Error('ROOM_MODEL must be "ollama", "local" or "off"');
  if (roomModel === 'local' && !usingEmulators) throw new Error('ROOM_MODEL=local is only allowed with the Firebase emulators');
  const roomModelUrl = env.ROOM_MODEL_URL ? env.ROOM_MODEL_URL.replace(/\/+$/, '') : null;
  if (roomModel === 'ollama' && !roomModelUrl) throw new Error('ROOM_MODEL=ollama needs ROOM_MODEL_URL');
  const roomDispatch = (env.ROOM_DISPATCH ?? (usingEmulators ? 'inline' : 'cloud-tasks')) as ServerConfig['room']['dispatch'];
  if (roomDispatch !== 'cloud-tasks' && roomDispatch !== 'inline') throw new Error('ROOM_DISPATCH must be "cloud-tasks" or "inline"');
  if (roomDispatch === 'inline' && !usingEmulators) throw new Error('ROOM_DISPATCH=inline is only allowed with the Firebase emulators');
  const webOrigin = env.WEB_ORIGIN ? originOf(env.WEB_ORIGIN, 'WEB_ORIGIN') : usingEmulators ? 'http://localhost:5173' : null;

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
    deploymentEnvironment,
    testingMode,
    bylawsChecker,
    consistencyChecker,
    electionChecker,
    bylawsCheckModel: env.BYLAWS_CHECK_MODEL || DEFAULT_BYLAWS_CHECK_MODEL,
    consistencyCheckModel: env.CONSISTENCY_CHECK_MODEL || DEFAULT_CONSISTENCY_CHECK_MODEL,
    electionCheckModel: env.ELECTION_CHECK_MODEL || DEFAULT_ELECTION_CHECK_MODEL,
    mailTransport,
    mailFrom: env.MAIL_FROM || DEFAULT_MAIL_FROM,
    mailReplyTo: env.MAIL_REPLY_TO || null,
    noticeContact: env.NOTICE_CONTACT?.trim() || null,
    webOrigin,
    districtSource,
    googleMapsKey: env.GOOGLE_MAPS_BROWSER_KEY?.trim() || null,
    trustedProxyHops: wholeNumber(env.TRUSTED_PROXY_HOPS, 'TRUSTED_PROXY_HOPS') ?? DEFAULT_TRUSTED_PROXY_HOPS,
    roomModel,
    room: {
      modelUrl: roomModelUrl,
      chatModel: env.ROOM_CHAT_MODEL || DEFAULT_ROOM_CHAT_MODEL,
      embedModel: env.ROOM_EMBED_MODEL || DEFAULT_ROOM_EMBED_MODEL,
      dispatch: roomDispatch,
      tasksQueue: env.TASKS_QUEUE || null,
      workerUrl: env.WORKER_URL ? env.WORKER_URL.replace(/\/+$/, '') : null,
      tasksInvoker: env.TASKS_INVOKER || null,
      voiceStun: voiceStun(env.ROOM_VOICE_STUN),
    },
    ses: {
      region: env.SES_REGION || null,
      configurationSet: env.SES_CONFIGURATION_SET || null,
      eventsQueueUrl: env.SES_EVENTS_QUEUE_URL || null,
      accessKeyId: env.AWS_SES_ACCESS_KEY_ID || null,
      secretAccessKey: env.AWS_SES_SECRET_ACCESS_KEY || null,
      maxSendRate: positiveNumber(env.SES_MAX_SEND_RATE, 'SES_MAX_SEND_RATE') ?? DEFAULT_SES_MAX_SEND_RATE,
    },
  };
}

/** The From address USTP agreed for election notices (Q15); it takes no replies. */
export const DEFAULT_MAIL_FROM = 'USTP Elections <noreply@transhumanist-party.org>';

/** A new SES account in production may send 14 a second; stay under it. */
export const DEFAULT_SES_MAX_SEND_RATE = 10;

export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

function wholeNumber(value: string | undefined, name: string): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number`);
  return n;
}

function positiveNumber(value: string | undefined, name: string): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

/** `ROOM_VOICE_STUN`: `stun:` URLs, comma-separated; `off` for none (calls then work only on one network). */
function voiceStun(value: string | undefined): string[] {
  if (!value?.trim()) return DEFAULT_ROOM_VOICE_STUN;
  if (value.trim() === 'off') return [];
  const urls = value.split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls.every((u) => /^stuns?:[^\s/]+$/.test(u))) throw new Error('ROOM_VOICE_STUN must be stun: URLs, comma-separated, or "off"');
  return urls;
}

/** An http(s) origin with nothing after it, as links are built from it. */
function originOf(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a URL such as https://vote.example.org`);
  }
  if (!['https:', 'http:'].includes(url.protocol) || `${url.origin}/` !== url.href) {
    throw new Error(`${name} must be an origin (scheme, host and port only), such as https://vote.example.org`);
  }
  return url.origin;
}
