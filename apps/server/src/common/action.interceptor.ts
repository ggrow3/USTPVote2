import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { NO_ACTOR_LOG_KEY } from '../auth/decorators.js';

/**
 * Names each request's handler and caller for its log lines (design §14, "Logging"): `action` is `Controller.handler`,
 * which is also where to look in the code. Runs after the AuthGuard, so the caller is known; a route marked
 * `@NoActorLog()` is logged without one.
 */
@Injectable()
export class ActionInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const log = request.logContext;
    if (log) {
      log.action = `${context.getClass().name}.${context.getHandler().name}`;
      const anonymous = this.reflector.getAllAndOverride<boolean>(NO_ACTOR_LOG_KEY, [context.getHandler(), context.getClass()]);
      const ctx = request.ctx;
      if (ctx && !anonymous) {
        if (ctx.accountId) log.accountId = ctx.accountId;
        if (ctx.roles.length) log.roles = ctx.roles;
        if (ctx.operator) log.operator = ctx.operator;
      }
    }
    return next.handle();
  }
}
