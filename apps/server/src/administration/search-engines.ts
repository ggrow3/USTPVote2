import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { crawlAllowed, robotsTxt, sitemapEntries, sitemapXml } from 'ustp-domain';
import { Public } from '../auth/decorators.js';
import { requestOrigin } from '../common/request-origin.js';
import { PublicBills } from '../bills/public-bills.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { ElectionReader } from '../elections/election-reader.js';
import { MembershipService } from '../membership/membership.service.js';

/**
 * Crawlers may keep both for an hour. `private` keeps them out of Hosting's CDN, which could otherwise answer one
 * address of the site with what another was told.
 */
const CACHE = 'private, max-age=3600';

/**
 * robots.txt and sitemap.xml for the web app, which Firebase Hosting rewrites here (design §15, "Search engines"):
 * outside production, or at any other address than the site's own, search engines are asked to stay out.
 */
@Controller()
@Public()
export class SearchEnginesController {
  constructor(
    @Inject(CONFIG) private readonly config: ServerConfig,
    private readonly membership: MembershipService,
    private readonly elections: ElectionReader,
    private readonly bills: PublicBills,
  ) {}

  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', CACHE)
  robots(@Req() req: FastifyRequest): string {
    const origin = requestOrigin(req);
    return robotsTxt(origin, crawlAllowed({ environment: this.config.deploymentEnvironment, webOrigin: this.config.webOrigin }, origin));
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', CACHE)
  async sitemap(@Req() req: FastifyRequest): Promise<string> {
    const [bylaws, results, bills] = await Promise.all([this.membership.bylawsVersions(), this.elections.certifiedResults(), this.bills.sitemap()]);
    return sitemapXml(requestOrigin(req), sitemapEntries(bylaws, results, bills));
  }
}
