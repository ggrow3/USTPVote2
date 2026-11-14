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
import { ACT_AS_HEADER, administersSite, adminSignInRefused, isUuidV7, PROBLEM_TYPES, secondFactorScope, type Role } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { SignInLogService } from '../security/sign-in-log.js';
import { APP_CHECKED_KEY, CHECK_REVOKED_KEY, MFA_EXEMPT_KEY, PUBLIC_KEY, ROLES_KEY } from './decorators.js';
import { DirectoryService } from './directory.service.js';
import { MfaPolicyService } from './mfa-policy.js';
import { principalFromToken, type Principal, type RequestContext } from './principal.js';
import { SignInMethodsService } from './sign-in-methods.service.js';

/**
 * Applied to every API route (design §4): App Check, a verified ID token from an enabled provider, for admin routes a
 * role plus multi-factor sign-in, and multi-factor sign-in on every route for System Admins, and for everyone while the
 * member requirement is on. Routes marked @Public() skip it.
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
    private readonly mfaPolicy: MfaPolicyService,
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
    const acting = personaId === undefined ? null : await this.operatorFor(request, principal, ownAccountId, personaId);
    const operator = acting?.operator ?? null;
    const accountId = personaId === undefined ? ownAccountId : personaId;
    let roles: Role[] = [];
    // A Site Admin acting as a persona without a second factor was let through as themselves (operatorFor).
    let secondFactorWaived = acting?.waived ?? false;
    if (required.length > 0) {
      if (!accountId) throw new ForbiddenException('no account');
      roles = await this.directory.activeRoles(accountId);
      // Acting as a persona, the admin was checked as themselves (operatorFor).
      if (personaId === undefined) await this.requireGoogleWhereDue(roles, principal);
      if (this.config.adminMfaRequired && !principal.mfa && !secondFactorWaived) {
        // Only a Site Admin while the Site Admins' setting is off, whatever other admin role they hold (design §4).
        secondFactorWaived = roles.includes('site_admin') && secondFactorScope(roles, await this.mfaPolicy.current()) === 'none';
        if (!secondFactorWaived) {
          throw new ForbiddenException({ message: 'admin actions require multi-factor sign-in', type: PROBLEM_TYPES.mfaRequired });
        }
      }
      if (!required.some((r) => roles.includes(r))) throw new ForbiddenException(`requires role ${required.join(' or ')}`);
    } else if (this.config.adminMfaRequired && !principal.mfa && !this.reflector.getAllAndOverride<boolean>(MFA_EXEMPT_KEY, targets)) {
      await this.requireSecondFactorWhereDue(ownAccountId);
    }

    const ctx: RequestContext = { principal, accountId, roles, operator, ...(secondFactorWaived && { secondFactorWaived }) };
    request.ctx = ctx;
    return true;
  }

  /**
   * A sign-in without a second factor, on a route that is neither an admin route nor exempt: refused for a System Admin
   * always, a Site Admin while the Site Admins' setting is on, and everyone else while the member requirement is on
   * (design §4). The roles are read fresh, so a new System Admin is held to it at once, and are not read at all while
   * both settings are on, when everyone is refused. Someone acting as a test persona was checked as themselves
   * (operatorFor), so the login's own account is the one that counts.
   */
  private async requireSecondFactorWhereDue(ownAccountId: string | null): Promise<void> {
    const policy = await this.mfaPolicy.current();
    const everyone = policy.membersRequired && policy.siteAdminsRequired;
    const roles = everyone || !ownAccountId ? [] : await this.directory.activeRoles(ownAccountId);
    if (secondFactorScope(roles, policy) !== 'everywhere') return;
    const message = roles.includes('system_admin')
      ? 'System Admins must sign in with two-step verification'
      : roles.includes('site_admin') && policy.siteAdminsRequired
        ? 'Site Admins must sign in with two-step verification'
        : 'this site requires two-step verification; set it up on your account page';
    throw new ForbiddenException({ message, type: PROBLEM_TYPES.mfaRequired });
  }

  /**
   * The admin tools, for a System or Site Admin, only with a sign-in with Google while that is required (design §4).
   * Their other pages, the Account page among them, stay open, so they can see why.
   */
  private async requireGoogleWhereDue(roles: readonly Role[], principal: Principal): Promise<void> {
    if (!adminSignInRefused(roles, principal.provider, await this.mfaPolicy.current())) return;
    throw new ForbiddenException({ message: 'System and Site Admins must sign in with Google', type: PROBLEM_TYPES.googleRequired });
  }

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

  /**
   * Checks a request to act as a test persona (design §10.4): testing mode is on, the caller is a System or Site Admin
   * signed in with MFA, or a Site Admin without it while the Site Admins' setting is off (`waived`), and the target is
   * a persona. Returns the caller's own accountId, the operator.
   */
  private async operatorFor(
    request: FastifyRequest,
    principal: Principal,
    ownAccountId: string | null,
    personaId: string,
  ): Promise<{ operator: string; waived: boolean }> {
    if (!this.config.testingMode) throw new ForbiddenException('testing mode is off on this deployment');
    if (!ownAccountId) throw new ForbiddenException('no account');
    const [roles, isPersona] = await Promise.all([this.directory.activeRoles(ownAccountId), this.directory.isPersona(personaId)]);
    await this.requireGoogleWhereDue(roles, principal);
    let waived = false;
    if (this.config.adminMfaRequired && !principal.mfa) {
      waived = roles.includes('site_admin') && secondFactorScope(roles, await this.mfaPolicy.current()) === 'none';
      if (!waived) {
        throw new ForbiddenException({ message: 'acting as a test persona requires multi-factor sign-in', type: PROBLEM_TYPES.mfaRequired });
      }
    }
    if (!administersSite(roles)) throw new ForbiddenException('only System and Site Admins can act as test personas');
    if (!isPersona) throw new ForbiddenException('not a test persona');
    // Persona accounts have no login of their own, so this log is what ties each persona action to a real person.
    this.logger.log(`${ownAccountId} acting as test persona ${personaId}: ${request.method} ${request.url.split('?', 1)[0]}`);
    return { operator: ownAccountId, waived };
  }
}
