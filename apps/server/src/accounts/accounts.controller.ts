import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { linkIdentitySchema, type LinkIdentityInput } from 'ustp-domain';
import { Ctx } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { AccountsService } from './accounts.service.js';

@Controller('v1')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.accounts.me(ctx);
  }

  @Post('accounts')
  async create(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.accounts.create(ctx);
    void reply.status(result.created ? 201 : 200);
    return result;
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
