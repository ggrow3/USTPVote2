import { Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { photoDecisionSchema, type PhotoDecisionInput } from 'ustp-domain';
import { z } from 'zod';
import { Ctx, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { PhotosService } from './photos.service.js';

/** The caller's own profile photo. Upload is the raw image as the body (Content-Type image/jpeg, png or webp). */
@Controller('v1/me/photo')
export class MyPhotoController {
  constructor(private readonly photos: PhotosService) {}

  @Put()
  upload(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.photos.upload(ctx, body);
  }

  @Get()
  async mine(@Ctx() ctx: RequestContext) {
    const photo = await this.photos.mine(ctx);
    if (!photo) throw new NotFoundException('no photo');
    return photo;
  }

  @Get('image')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'private, no-store')
  image(@Ctx() ctx: RequestContext) {
    return this.photos.imageForOwner(ctx);
  }

  /** The caller's Gravatar, fetched now and normalized, for them to review and upload; nothing is stored. */
  @Get('gravatar')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'private, no-store')
  gravatar(@Ctx() ctx: RequestContext) {
    return this.photos.gravatar(ctx);
  }

  @Delete()
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext) {
    await this.photos.removeMine(ctx);
  }
}

/** Membership Admin review of flagged photos (design §5.3). */
@Controller('v1/admin/photos')
@Roles('membership_admin')
export class PhotoReviewController {
  constructor(private readonly photos: PhotosService) {}

  @Get()
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.photos.list(
      parseQuery(z.enum(['needs_review', 'accepted', 'rejected']).default('needs_review'), status, 'status'),
      parseQuery(z.coerce.number().int().min(1).max(200).default(50), limit, 'limit'),
    );
  }

  @Get(':id/image')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'private, no-store')
  image(@Param('id') id: string) {
    return this.photos.imageForAdmin(id);
  }

  @Post(':id/decision')
  decide(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body(new ZodPipe(photoDecisionSchema)) body: PhotoDecisionInput) {
    return this.photos.decide(ctx, id, body);
  }
}
