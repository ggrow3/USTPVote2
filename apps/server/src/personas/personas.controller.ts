import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { createPersonasSchema, deleteTestVotersSchema, type CreatePersonasInput, type DeleteTestVotersInput } from 'ustp-domain';
import { Ctx, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { PersonasService } from './personas.service.js';
import { requireTestingAccess } from './testing-access.js';

/**
 * Test personas (design §10.4), for System and Site Admins as themselves with a second factor (`requireTestingAccess`),
 * and only in testing mode (404 otherwise). Deleting test voters stays with System Admins (403 for a Site Admin).
 */
@Controller('v1/testing/personas')
@Roles('system_admin', 'site_admin')
export class PersonasController {
  constructor(private readonly personas: PersonasService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    requireTestingAccess(ctx);
    return this.personas.list();
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createPersonasSchema)) body: CreatePersonasInput) {
    requireTestingAccess(ctx);
    return this.personas.create(ctx, body);
  }

  /** Deletes test voters at once, whatever elections hold them; answers the personas that remain. */
  @Post('delete')
  @HttpCode(200)
  delete(@Ctx() ctx: RequestContext, @Body(new ZodPipe(deleteTestVotersSchema)) body: DeleteTestVotersInput) {
    requireTestingAccess(ctx);
    return this.personas.deleteVoters(ctx, body);
  }
}
