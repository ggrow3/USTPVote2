import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  accountPreferencesSchema,
  linkIdentitySchema,
  reasonInputSchema,
  ROLES,
  type AccountPreferencesInput,
  type LinkIdentityInput,
  type ReasonInput,
} from 'ustp-domain';
import { z } from 'zod';
import { Ctx, MfaExempt, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { AccountsService } from './accounts.service.js';

/** Primary emails are stored lowercase (principalFromToken), so the prefix is too; an empty one means no filter. */
const emailPrefix = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .optional()
  .transform((v) => v || undefined);

@Controller('v1')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** Says whether the caller still needs a second factor, so it answers without one (design §4). */
  @Get('me')
  @MfaExempt()
  me(@Ctx() ctx: RequestContext) {
    return this.accounts.me(ctx);
  }

  @Post('accounts')
  @MfaExempt()
  async create(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.accounts.create(ctx);
    void reply.status(result.created ? 201 : 200);
    return result;
  }

  /** The caller's own display choices (design §4.1); `GET /v1/me` returns them on the account. */
  @Put('me/preferences')
  preferences(@Ctx() ctx: RequestContext, @Body(new ZodPipe(accountPreferencesSchema)) body: AccountPreferencesInput) {
    return this.accounts.updatePreferences(ctx, body);
  }

  @Post('me/identities')
  link(@Ctx() ctx: RequestContext, @Body(new ZodPipe(linkIdentitySchema)) body: LinkIdentityInput) {
    return this.accounts.link(ctx, body.idToken);
  }

  @Delete('me/identities/:uid')
  @HttpCode(204)
  async unlink(@Ctx() ctx: RequestContext, @Param('uid') uid: string) {
    await this.accounts.unlink(ctx, uid);
  }
}

/**
 * The People list (design §10.3), so System and Site Admins can see who holds which role and pick whose to change, and
 * deleting an account on the deployment's deletion list (§4), which only System Admins do.
 */
@Controller('v1/admin/accounts')
@Roles('system_admin', 'site_admin')
export class AccountsAdminController {
  constructor(private readonly accounts: AccountsService) {}

  /** Permanently deletes the account and its logins; the ledger keeps its entries and records the deletion. */
  @Post(':accountId/delete')
  @HttpCode(204)
  @Roles('system_admin')
  async delete(@Ctx() ctx: RequestContext, @Param('accountId') accountId: string, @Body(new ZodPipe(reasonInputSchema)) body: ReasonInput) {
    await this.accounts.delete(ctx, accountId, body.reason);
  }

  @Get()
  list(@Query('email') email?: string, @Query('role') role?: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    return this.accounts.list({
      email: parseQuery(emailPrefix, email, 'email'),
      role: parseQuery(z.enum(['any', ...ROLES]).optional(), role, 'role'),
      after: parseQuery(z.string().min(1).max(64).optional(), after, 'after'),
      limit: parseQuery(z.coerce.number().int().min(1).max(100).default(50), limit, 'limit'),
    });
  }
}
