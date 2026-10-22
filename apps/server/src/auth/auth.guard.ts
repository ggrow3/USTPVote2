import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PROBLEM_TYPES, type Role } from 'ustp-domain';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { CHECK_REVOKED_KEY, PUBLIC_KEY, ROLES_KEY } from './decorators.js';
import { DirectoryService } from './directory.service.js';
import { principalFromToken, type RequestContext } from './principal.js';
import { SignInMethodsService } from './sign-in-methods.service.js';

/**
 * Applied to every API route (design §4): App Check, a verified ID token from an enabled provider, and for
 * admin routes a role plus multi-factor sign-in. Routes marked @Public() skip it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly firebase: Firebase,
    @Inject(CONFIG) private readonly config: ServerConfig,
    private readonly signInMethods: SignInMethodsService,
    private readonly directory: DirectoryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets) ?? [];
    const checkRevoked = required.length > 0 || !!this.reflector.getAllAndOverride<boolean>(CHECK_REVOKED_KEY, targets);
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (this.config.appCheckEnforced) {
      const appCheckToken = request.headers['x-firebase-appcheck'];
      if (typeof appCheckToken !== 'string' || !appCheckToken) throw new UnauthorizedException('App Check token required');
      try {
        await this.firebase.appCheck.verifyToken(appCheckToken);
      } catch {
        throw new UnauthorizedException('invalid App Check token');
      }
    }

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

    const accountId = await this.directory.accountIdForUid(principal.uid);
    let roles: Role[] = [];
    if (required.length > 0) {
      if (!accountId) throw new ForbiddenException('no account');
      if (this.config.adminMfaRequired && !principal.mfa) {
        throw new ForbiddenException({ message: 'admin actions require multi-factor sign-in', type: PROBLEM_TYPES.mfaRequired });
      }
      roles = await this.directory.activeRoles(accountId);
      if (!required.some((r) => roles.includes(r))) throw new ForbiddenException(`requires role ${required.join(' or ')}`);
    }

    const ctx: RequestContext = { principal, accountId, roles };
    request.ctx = ctx;
    return true;
  }
}
