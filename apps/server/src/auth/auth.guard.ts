import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ACT_AS_HEADER, isUuidV7, PROBLEM_TYPES, type Role } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { SignInLogService } from '../security/sign-in-log.js';
import { APP_CHECKED_KEY, CHECK_REVOKED_KEY, PUBLIC_KEY, ROLES_KEY } from './decorators.js';
import { DirectoryService } from './directory.service.js';
import { principalFromToken, type Principal, type RequestContext } from './principal.js';
import { SignInMethodsService } from './sign-in-methods.service.js';

/**
 * Applied to every API route (design §4): App Check, a verified ID token from an enabled provider, and for
 * admin routes a role plus multi-factor sign-in. Routes marked @Public() skip it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger('TestPersonas');

  constructor(
    private readonly reflector: Reflector,
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
    private readonly signInMethods: SignInMethodsService,
    private readonly directory: DirectoryService,
    @Optional() private readonly signInLog?: SignInLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) {
      if (this.reflector.getAllAndOverride<boolean>(APP_CHECKED_KEY, targets)) await this.verifyAppCheck(request);
      return true;
    }
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets) ?? [];
    const actAsHeader = request.headers[ACT_AS_HEADER];
    if (actAsHeader !== undefined && (typeof actAsHeader !== 'string' || !isUuidV7(actAsHeader))) {
      throw new BadRequestException(`${ACT_AS_HEADER} must be a test persona's accountId`);
    }
    const personaId = actAsHeader as string | undefined;
    const checkRevoked =
      required.length > 0 || personaId !== undefined || !!this.reflector.getAllAndOverride<boolean>(CHECK_REVOKED_KEY, targets);

    await this.verifyAppCheck(request);

    const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('sign in required');
    let principal;
    try {
      // Admin routes and casting also check revocation, so a disabled or signed-out user loses access immediately.
      principal = principalFromToken(await this.firebase.auth.verifyIdToken(match[1]!, checkRevoked));
    } catch {
      throw new UnauthorizedException('invalid or expired sign-in');
    }
    if (!(await this.signInMethods.isEnabled(principal.provider))) {
      throw new ForbiddenException(`sign-in with ${principal.provider} is not enabled`);
    }

    const ownAccountId = await this.directory.accountIdForUid(principal.uid);
    // The sign-in log (design §10.7): the real person who signed in, even while they act as a test persona.
    await this.signInLog?.note(principal, ownAccountId, request);
    const operator = personaId === undefined ? null : await this.operatorFor(request, principal, ownAccountId, personaId);
    const accountId = personaId === undefined ? ownAccountId : personaId;
    let roles: Role[] = [];
    if (required.length > 0) {
      if (!accountId) throw new ForbiddenException('no account');
      if (this.config.adminMfaRequired && !principal.mfa) {
        throw new ForbiddenException({ message: 'admin actions require multi-factor sign-in', type: PROBLEM_TYPES.mfaRequired });
      }
      roles = await this.directory.activeRoles(accountId);
      if (!required.some((r) => roles.includes(r))) throw new ForbiddenException(`requires role ${required.join(' or ')}`);
    }

    const ctx: RequestContext = { principal, accountId, roles, operator };
    request.ctx = ctx;
    return true;
  }

  /**
   * Checks a request to act as a test persona (design §10.4): testing mode is on, the caller is a System Admin signed
   * in with MFA, and the target is a persona. Returns the caller's own accountId, the operator.
   */
  /** Where App Check is enforced, the request carries a valid App Check token. */
  private async verifyAppCheck(request: FastifyRequest): Promise<void> {
    if (!this.config.appCheckEnforced) return;
    const appCheckToken = request.headers['x-firebase-appcheck'];
    if (typeof appCheckToken !== 'string' || !appCheckToken) throw new UnauthorizedException('App Check token required');
    try {
      await this.firebase.appCheck.verifyToken(appCheckToken);
    } catch {
      throw new UnauthorizedException('invalid App Check token');
    }
  }

  private async operatorFor(
    request: FastifyRequest,
    principal: Principal,
    ownAccountId: string | null,
    personaId: string,
  ): Promise<string> {
    if (!this.config.testingMode) throw new ForbiddenException('testing mode is off on this deployment');
    if (!ownAccountId) throw new ForbiddenException('no account');
    if (this.config.adminMfaRequired && !principal.mfa) {
      throw new ForbiddenException({ message: 'acting as a test persona requires multi-factor sign-in', type: PROBLEM_TYPES.mfaRequired });
    }
    const [roles, isPersona] = await Promise.all([this.directory.activeRoles(ownAccountId), this.directory.isPersona(personaId)]);
    if (!roles.includes('system_admin')) throw new ForbiddenException('only System Admins can act as test personas');
    if (!isPersona) throw new ForbiddenException('not a test persona');
    // Persona accounts have no login of their own, so this log is what ties each persona action to a real person.
    this.logger.log(`${ownAccountId} acting as test persona ${personaId}: ${request.method} ${request.url}`);
    return ownAccountId;
  }
}
