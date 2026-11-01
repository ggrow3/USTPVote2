import { Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, Post, Put, Query, Req, Res, type PipeTransform } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  courseBoardSchema,
  courseMapSchema,
  courseMessagingSchema,
  courseMetadataSchema,
  isCourseId,
  isUuidV7,
  saveCourseLessonSchema,
  saveFuturistProfileSchema,
  sendCourseMessageSchema,
  submitCourseQuizSchema,
  type CourseBoardInput,
  type CourseMapInput,
  type CourseMessagingInput,
  type CourseMetadataInput,
  type SaveCourseLessonInput,
  type SaveFuturistProfileInput,
  type SendCourseMessageInput,
  type SubmitCourseQuizInput,
} from 'ustp-domain';
import { z } from 'zod';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { parseQuery, ZodPipe } from '../common/validation.js';
import { CourseLearnersService } from './course-learners.service.js';
import { CourseService } from './course.service.js';

const revokeSchema = z.strictObject({ reason: z.string().trim().min(1).max(2000) });
const packageVersionSchema = z.union([z.literal('draft'), z.coerce.number().int().min(1)]).default('draft');

/** A course ID from the address; anything else names no course, and never reaches the database as a path. */
export class CourseIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isCourseId(value)) throw new NotFoundException('course not found');
    return value;
  }
}

/** A learner's account ID from the address, which is always a UUIDv7. */
class LearnerIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUuidV7(value)) throw new NotFoundException('no such learner');
    return value;
  }
}

@Controller('v1')
export class CourseController {
  constructor(
    private readonly courses: CourseService,
    private readonly learners: CourseLearnersService,
  ) {}

  /** The course map and list: published courses, and drafts placed on the map as coming soon (design §10.8). */
  @Public()
  @Get('public/courses')
  courseMap() {
    return this.courses.courseMap(null);
  }

  @Public()
  @Get('public/courses/:courseId')
  catalog(@Param('courseId', CourseIdPipe) courseId: string) {
    return this.courses.catalog(courseId);
  }

  /** An uploaded portrait's ID is the hash of its bytes, so it never changes and browsers may keep it. */
  @Public()
  @Get('public/course-images/:id')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  image(@Param('id') id: string): Promise<Buffer> {
    return this.courses.image(id);
  }

  /** Intentionally returns only validity and course metadata: certificate recipients stay private. */
  @Public()
  @Get('public/certificates/:certificateId')
  verify(@Param('certificateId') certificateId: string) {
    return this.courses.verifyCertificate(certificateId);
  }

  /** The course map with how the signed-in learner stands in each course. */
  @Get('courses')
  learnerMap(@Ctx() ctx: RequestContext) {
    return this.courses.courseMap(requireAccount(ctx));
  }

  @Get('courses/:courseId')
  learner(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string) {
    return this.courses.learner(courseId, requireAccount(ctx));
  }

  @Post('courses/:courseId/lessons/:lessonId/attempts')
  attempt(
    @Ctx() ctx: RequestContext,
    @Param('courseId', CourseIdPipe) courseId: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodPipe(submitCourseQuizSchema)) input: SubmitCourseQuizInput,
  ) {
    return this.courses.submitQuiz(courseId, lessonId, input, requireAccount(ctx));
  }

  @Get('courses/:courseId/certificate.pdf')
  async certificate(
    @Ctx() ctx: RequestContext,
    @Param('courseId', CourseIdPipe) courseId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const origin = requestOrigin(request);
    const pdf = await this.courses.certificatePdf(courseId, requireAccount(ctx), origin);
    reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${courseId}-certificate.pdf"`);
    return pdf;
  }

  /** The learner's own conversation with the course's instructors; reading it marks their replies read. */
  @Get('courses/:courseId/messages')
  conversation(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string) {
    return this.learners.conversation(courseId, requireAccount(ctx), 'learner');
  }

  /** Writes to the instructors: 403 unless a Course Administrator has turned messaging on for this learner. */
  @Post('courses/:courseId/messages')
  write(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Body(new ZodPipe(sendCourseMessageSchema)) input: SendCourseMessageInput) {
    const accountId = requireAccount(ctx);
    return this.learners.send(courseId, accountId, 'learner', accountId, input.body);
  }

  /** Every course, drafts included, for the Course tab's course picker and map editor. */
  @Get('admin/courses')
  @Roles('course_admin')
  adminCourses() {
    return this.courses.adminCourses();
  }

  /** A new draft course, off the map; its ID is made from its title. */
  @Post('admin/courses')
  @Roles('course_admin')
  createCourse(@Ctx() ctx: RequestContext, @Body(new ZodPipe(courseMetadataSchema)) input: CourseMetadataInput) {
    return this.courses.createCourse(input, requireAccount(ctx));
  }

  @Get('admin/courses/:courseId')
  @Roles('course_admin')
  adminContent(@Param('courseId', CourseIdPipe) courseId: string) {
    return this.courses.adminContent(courseId);
  }

  /** Deletes a course that was never published (409 for one that was, or one another course comes after). */
  @Delete('admin/courses/:courseId')
  @Roles('course_admin')
  @HttpCode(204)
  async deleteCourse(@Param('courseId', CourseIdPipe) courseId: string) {
    await this.courses.deleteCourse(courseId);
  }

  /** Where the course sits on the map and which courses come before it; applies at once (409 for a loop or a taken square). */
  @Put('admin/courses/:courseId/map')
  @Roles('course_admin')
  place(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Body(new ZodPipe(courseMapSchema)) input: CourseMapInput) {
    return this.courses.placeCourse(courseId, input, requireAccount(ctx));
  }

  /**
   * The Course tab's board saved at once: where each listed course now sits and which courses come before it (409 for
   * a loop or a shared square). Not under `admin/courses/`, where a course could be called `map`.
   */
  @Put('admin/course-map')
  @Roles('course_admin')
  placeAll(@Ctx() ctx: RequestContext, @Body(new ZodPipe(courseBoardSchema)) input: CourseBoardInput) {
    return this.courses.placeCourses(input, requireAccount(ctx));
  }

  /** The course as one `ustp.course` JSON file: `version` is `draft` (the default) or a published version's number. */
  @Get('admin/courses/:courseId/package')
  @Roles('course_admin')
  package(@Param('courseId', CourseIdPipe) courseId: string, @Query('version') version?: string) {
    return this.courses.package(courseId, parseQuery(packageVersionSchema, version, 'version'));
  }

  @Put('admin/courses/:courseId')
  @Roles('course_admin')
  metadata(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Body(new ZodPipe(courseMetadataSchema)) input: CourseMetadataInput) {
    return this.courses.updateMetadata(courseId, input, requireAccount(ctx));
  }

  @Post('admin/courses/:courseId/lessons')
  @Roles('course_admin')
  lesson(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Body(new ZodPipe(saveCourseLessonSchema)) input: SaveCourseLessonInput) {
    return this.courses.saveLesson(courseId, input, requireAccount(ctx));
  }

  @Delete('admin/courses/:courseId/lessons/:lessonId')
  @Roles('course_admin')
  @HttpCode(204)
  async deleteLesson(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Param('lessonId') lessonId: string) {
    await this.courses.deleteLesson(courseId, lessonId, requireAccount(ctx));
  }

  @Post('admin/courses/:courseId/profiles')
  @Roles('course_admin')
  profile(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Body(new ZodPipe(saveFuturistProfileSchema)) input: SaveFuturistProfileInput) {
    return this.courses.saveProfile(courseId, input, requireAccount(ctx));
  }

  /** The raw image as the body (Content-Type image/jpeg, image/png or image/webp), for a profile's portrait. */
  @Put('admin/courses/:courseId/images')
  @Roles('course_admin')
  uploadImage(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Body() body: unknown) {
    return this.courses.uploadImage(courseId, body, requireAccount(ctx));
  }

  @Delete('admin/courses/:courseId/profiles/:profileId')
  @Roles('course_admin')
  @HttpCode(204)
  async deleteProfile(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string, @Param('profileId') profileId: string) {
    await this.courses.deleteProfile(courseId, profileId, requireAccount(ctx));
  }

  @Post('admin/courses/:courseId/publish')
  @Roles('course_admin')
  publish(@Ctx() ctx: RequestContext, @Param('courseId', CourseIdPipe) courseId: string) {
    return this.courses.publish(courseId, requireAccount(ctx));
  }

  /** How each learner stands in the course: name (never email), lessons and scores, attempts, certificate, messaging. */
  @Get('admin/courses/:courseId/learners')
  @Roles('course_admin')
  courseLearners(@Param('courseId', CourseIdPipe) courseId: string) {
    return this.learners.learners(courseId);
  }

  /** Turns the learner's messaging with the instructors on or off in this course. */
  @Put('admin/courses/:courseId/learners/:accountId/messaging')
  @Roles('course_admin')
  messaging(
    @Ctx() ctx: RequestContext,
    @Param('courseId', CourseIdPipe) courseId: string,
    @Param('accountId', LearnerIdPipe) accountId: string,
    @Body(new ZodPipe(courseMessagingSchema)) input: CourseMessagingInput,
  ) {
    return this.learners.switchMessaging(courseId, accountId, input.messaging, requireAccount(ctx));
  }

  /** A learner's conversation, as the instructors read it; reading it marks the learner's messages read. */
  @Get('admin/courses/:courseId/learners/:accountId/messages')
  @Roles('course_admin')
  learnerConversation(@Param('courseId', CourseIdPipe) courseId: string, @Param('accountId', LearnerIdPipe) accountId: string) {
    return this.learners.conversation(courseId, accountId, 'instructor');
  }

  /** Answers the learner as an instructor (409 while their messaging is off). */
  @Post('admin/courses/:courseId/learners/:accountId/messages')
  @Roles('course_admin')
  answer(
    @Ctx() ctx: RequestContext,
    @Param('courseId', CourseIdPipe) courseId: string,
    @Param('accountId', LearnerIdPipe) accountId: string,
    @Body(new ZodPipe(sendCourseMessageSchema)) input: SendCourseMessageInput,
  ) {
    return this.learners.send(courseId, accountId, 'instructor', requireAccount(ctx), input.body);
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
