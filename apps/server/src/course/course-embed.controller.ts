import { Controller, Get, Inject, NotFoundException, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { courseEmbed, coursesEmbed, isCourseId, type EmbedSite } from 'ustp-domain';
import { HubService } from '../administration/hub.js';
import { Public } from '../auth/decorators.js';
import { requestOrigin } from '../common/request-origin.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { EMBED_HEADERS, embedPage } from './course-embed.js';
import { CourseService } from './course.service.js';

/**
 * The course embed (design §10.17): `/embed/courses` and `/embed/course/{courseId}`, which Firebase Hosting rewrites
 * here, for other sites to frame. A course that is not published is a page saying so, with 404.
 */
@Controller('embed')
@Public()
export class CourseEmbedController {
  constructor(
    private readonly courses: CourseService,
    private readonly hub: HubService,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  private async site(req: FastifyRequest): Promise<EmbedSite> {
    const { profile } = await this.hub.shown();
    return { origin: (this.config.webOrigin ?? requestOrigin(req)).replace(/\/$/, ''), name: profile.name };
  }

  @Get('courses')
  async list(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const [map, site] = await Promise.all([this.courses.courseMap(null), this.site(req)]);
    void reply.headers(EMBED_HEADERS);
    return embedPage(coursesEmbed(map, site));
  }

  @Get('course/:courseId')
  async course(@Param('courseId') courseId: string, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const site = await this.site(req);
    void reply.headers(EMBED_HEADERS);
    try {
      if (!isCourseId(courseId)) throw new NotFoundException();
      return embedPage(courseEmbed(await this.courses.publishedPackage(courseId), site));
    } catch (e) {
      if (!(e instanceof NotFoundException)) throw e;
      void reply.status(404).header('Cache-Control', 'no-cache');
      return embedPage(null, { siteName: site.name, coursesUrl: `${site.origin}/courses` });
    }
  }
}
