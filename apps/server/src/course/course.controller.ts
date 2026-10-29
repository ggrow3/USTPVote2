import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  courseMetadataSchema,
  saveCourseLessonSchema,
  saveFuturistProfileSchema,
  submitCourseQuizSchema,
  type CourseMetadataInput,
  type SaveCourseLessonInput,
  type SaveFuturistProfileInput,
  type SubmitCourseQuizInput,
} from 'ustp-domain';
import { z } from 'zod';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { CourseService } from './course.service.js';

const revokeSchema = z.strictObject({ reason: z.string().trim().min(1).max(2000) });
const packageVersionSchema = z.union([z.literal('draft'), z.coerce.number().int().min(1)]).default('draft');

@Controller('v1')
export class CourseController {
  constructor(private readonly courses: CourseService) {}

  @Public()
  @Get('public/courses/:courseId')
  catalog(@Param('courseId') courseId: string) {
    return this.courses.catalog(courseId);
  }

  /** Intentionally returns only validity and course metadata: certificate recipients stay private. */
  @Public()
  @Get('public/certificates/:certificateId')
  verify(@Param('certificateId') certificateId: string) {
    return this.courses.verifyCertificate(certificateId);
  }

  @Get('courses/:courseId')
  learner(@Ctx() ctx: RequestContext, @Param('courseId') courseId: string) {
    return this.courses.learner(courseId, requireAccount(ctx));
  }

  @Post('courses/:courseId/lessons/:lessonId/attempts')
  attempt(
    @Ctx() ctx: RequestContext,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodPipe(submitCourseQuizSchema)) input: SubmitCourseQuizInput,
  ) {
    return this.courses.submitQuiz(courseId, lessonId, input, requireAccount(ctx));
  }

  @Get('courses/:courseId/certificate.pdf')
  async certificate(
    @Ctx() ctx: RequestContext,
    @Param('courseId') courseId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const origin = requestOrigin(request);
    const pdf = await this.courses.certificatePdf(courseId, requireAccount(ctx), origin);
    reply.header('content-type', 'application/pdf').header('content-disposition', 'attachment; filename="transhumanism-certificate.pdf"');
    return pdf;
  }

  @Get('admin/courses/:courseId')
  @Roles('course_admin')
  adminContent(@Param('courseId') courseId: string) {
    return this.courses.adminContent(courseId);
  }

  /** The course as one `ustp.course` JSON file: `version` is `draft` (the default) or a published version's number. */
  @Get('admin/courses/:courseId/package')
  @Roles('course_admin')
  package(@Param('courseId') courseId: string, @Query('version') version?: string) {
    return this.courses.package(courseId, parseQuery(packageVersionSchema, version, 'version'));
  }

  @Put('admin/courses/:courseId')
  @Roles('course_admin')
  metadata(@Ctx() ctx: RequestContext, @Param('courseId') courseId: string, @Body(new ZodPipe(courseMetadataSchema)) input: CourseMetadataInput) {
    return this.courses.updateMetadata(courseId, input, requireAccount(ctx));
  }

  @Post('admin/courses/:courseId/lessons')
  @Roles('course_admin')
  lesson(@Ctx() ctx: RequestContext, @Param('courseId') courseId: string, @Body(new ZodPipe(saveCourseLessonSchema)) input: SaveCourseLessonInput) {
    return this.courses.saveLesson(courseId, input, requireAccount(ctx));
  }

  @Delete('admin/courses/:courseId/lessons/:lessonId')
  @Roles('course_admin')
  @HttpCode(204)
  async deleteLesson(@Ctx() ctx: RequestContext, @Param('courseId') courseId: string, @Param('lessonId') lessonId: string) {
    await this.courses.deleteLesson(courseId, lessonId, requireAccount(ctx));
  }

  @Post('admin/courses/:courseId/profiles')
  @Roles('course_admin')
  profile(@Ctx() ctx: RequestContext, @Param('courseId') courseId: string, @Body(new ZodPipe(saveFuturistProfileSchema)) input: SaveFuturistProfileInput) {
    return this.courses.saveProfile(courseId, input, requireAccount(ctx));
  }

  @Delete('admin/courses/:courseId/profiles/:profileId')
  @Roles('course_admin')
  @HttpCode(204)
  async deleteProfile(@Ctx() ctx: RequestContext, @Param('courseId') courseId: string, @Param('profileId') profileId: string) {
    await this.courses.deleteProfile(courseId, profileId, requireAccount(ctx));
  }

  @Post('admin/courses/:courseId/publish')
  @Roles('course_admin')
  publish(@Ctx() ctx: RequestContext, @Param('courseId') courseId: string) {
    return this.courses.publish(courseId, requireAccount(ctx));
  }

  @Post('admin/certificates/:certificateId/revoke')
  @Roles('course_admin')
  @HttpCode(204)
  async revoke(
    @Ctx() ctx: RequestContext,
    @Param('certificateId') certificateId: string,
    @Body(new ZodPipe(revokeSchema)) input: { readonly reason: string },
  ) {
    await this.courses.revokeCertificate(certificateId, input.reason, requireAccount(ctx));
  }
}

function requestOrigin(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-proto'];
  const protocol = typeof forwarded === 'string' && forwarded ? forwarded.split(',')[0]!.trim() : request.protocol;
  const host = request.headers.host ?? 'localhost';
  return `${protocol}://${host}`;
}

