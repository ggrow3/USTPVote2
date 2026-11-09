import { Controller, Get, Inject, Injectable, Logger, Query } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Timestamp } from 'firebase-admin/firestore';
import {
  clientAddress,
  Collections,
  SIGN_IN_LIMITS,
  SIGN_IN_LOG_MAX,
  SIGN_IN_LOG_PERIODS,
  SIGN_IN_RETENTION_DAYS,
  type SignInLog,
  type SignInRecord,
} from 'ustp-domain';
import { Roles } from '../auth/decorators.js';
import { DirectoryService } from '../auth/directory.service.js';
import type { Principal } from '../auth/principal.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';

/** gRPC status ALREADY_EXISTS, as Firestore reports a `create` of a document that exists. */
const ALREADY_EXISTS = 6;
/** Sign-ins this instance already recorded, so later requests with the same token skip Firestore. */
const SEEN_MAX = 5000;
const DAY_MS = 86_400_000;

type Stored = Omit<SignInRecord, 'id'> & { readonly expireAt: Timestamp };

/**
 * The sign-in log (design §10.7): the first request the api sees with a new `auth_time` records who signed in, how,
 * from which address and browser. Identity Platform's own request logs (Cloud Logging) hold every attempt, failed ones
 * included; this log is the part an admin can read in the app. Personal data, so it stays out of the ledger and
 * expires after SIGN_IN_RETENTION_DAYS (a Firestore TTL policy on `expireAt`).
 */
@Injectable()
export class SignInLogService {
  private readonly logger = new Logger('SignInLog');
  private readonly seen = new Set<string>();

  constructor(
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
    private readonly directory: DirectoryService,
  ) {}

  /**
   * Records the sign-in behind this request once. Never fails the request: a sign-in that cannot be recorded is logged
   * and the request goes on.
   */
  async note(principal: Principal, accountId: string | null, request: FastifyRequest): Promise<void> {
    const id = `${principal.uid}_${principal.authTime}`;
    if (this.seen.has(id)) return;
    const { ip, chain } = clientAddress(request.headers['x-forwarded-for'], request.socket?.remoteAddress, this.config.trustedProxyHops);
    const userAgent = request.headers['user-agent'];
    const now = Date.now();
    const record: Stored = {
      uid: principal.uid,
      accountId,
      email: principal.email,
      provider: principal.provider,
      mfa: principal.mfa,
      signedInAt: new Date(principal.authTime * 1000).toISOString(),
      seenAt: new Date(now).toISOString(),
      ip,
      forwardedFor: chain,
      userAgent: typeof userAgent === 'string' && userAgent ? userAgent.slice(0, SIGN_IN_LIMITS.userAgent) : null,
      expireAt: Timestamp.fromMillis(now + SIGN_IN_RETENTION_DAYS * DAY_MS),
    };
    try {
      await this.firebase.db.collection(Collections.signIns).doc(id).create(record);
    } catch (e) {
      if ((e as { code?: unknown }).code !== ALREADY_EXISTS) {
        this.logger.error(`could not record a sign-in: ${(e as Error).message}`);
        return;
      }
    }
    if (this.seen.size >= SEEN_MAX) this.seen.clear();
    this.seen.add(id);
  }

  /**
   * The sign-ins seen in the last `days` days, newest first, at most SIGN_IN_LOG_MAX. A sign-in recorded before its
   * login had an account (the first step of Register) shows the account the login has now, if any.
   */
  async list(days: number): Promise<SignInLog> {
    const since = new Date(Date.now() - days * DAY_MS).toISOString();
    const snap = await this.firebase.db
      .collection(Collections.signIns)
      .where('seenAt', '>=', since)
      .orderBy('seenAt', 'desc')
      .limit(SIGN_IN_LOG_MAX + 1)
      .get();
    const records = snap.docs.slice(0, SIGN_IN_LOG_MAX).map((doc) => {
      const { expireAt: _expires, ...data } = doc.data() as Stored;
      return { id: doc.id, ...data };
    });
    const unknown = [...new Set(records.filter((r) => !r.accountId).map((r) => r.uid))];
    const accounts = new Map(await Promise.all(unknown.map(async (uid) => [uid, await this.directory.accountIdForUid(uid)] as const)));
    const signIns = records.map((r) => (r.accountId ? r : { ...r, accountId: accounts.get(r.uid) ?? null }));
    return { days, signIns, truncated: snap.size > SIGN_IN_LOG_MAX };
  }

  /** Forgets which sign-ins this instance recorded (tests reset Firestore between cases). */
  forget(): void {
    this.seen.clear();
  }
}

/** System Admins and Auditors read the sign-in log (design §10.7). */
@Controller('v1/admin/security')
export class SecurityController {
  constructor(private readonly signIns: SignInLogService) {}

  @Get('sign-ins')
  @Roles('system_admin', 'site_admin', 'auditor')
  list(@Query('days') days?: string): Promise<SignInLog> {
    const n = Number(days);
    return this.signIns.list((SIGN_IN_LOG_PERIODS as readonly number[]).includes(n) ? n : 30);
  }
}
