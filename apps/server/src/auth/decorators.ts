import { createParamDecorator, ForbiddenException, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Role } from 'ustp-domain';
import type { RequestContext } from './principal.js';

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestContext;
  }
}

export const PUBLIC_KEY = 'ustp:public';
export const ROLES_KEY = 'ustp:roles';

/** No sign-in required. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * The caller must hold at least one of these roles. Also implies multi-factor sign-in and a revocation check on
 * the ID token (design §4).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated caller. */
export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  const ctx = host.switchToHttp().getRequest<FastifyRequest>().ctx;
  if (!ctx) throw new Error('Ctx used on a route without authentication');
  return ctx;
});

/** The caller's accountId; 403 until they have created their account. */
export function requireAccount(ctx: RequestContext): string {
  if (!ctx.accountId) throw new ForbiddenException('create your account first (POST /v1/accounts)');
  return ctx.accountId;
}
