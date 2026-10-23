import { Body, Controller, Get, Post } from '@nestjs/common';
import { createPersonasSchema, type CreatePersonasInput } from 'ustp-domain';
import { Ctx, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { PersonasService } from './personas.service.js';

/**
 * Test personas (design §10.4), System Admins only and only in testing mode (404 otherwise). The personas themselves
 * hold no System Admin role, so these routes cannot be used while acting as one.
 */
@Controller('v1/testing/personas')
@Roles('system_admin')
export class PersonasController {
  constructor(private readonly personas: PersonasService) {}

  @Get()
  list() {
    return this.personas.list();
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(createPersonasSchema)) body: CreatePersonasInput) {
    return this.personas.create(ctx, body);
  }
}
