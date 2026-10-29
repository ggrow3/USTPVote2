import { Controller, Get, Header, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators.js';
import { requestOrigin } from '../common/request-origin.js';
import { PublicElectionsService } from './public-elections.service.js';

/** The published election record (design §12): anyone may read it, so voters and outsiders can verify. */
@Controller('v1/public/elections')
@Public()
export class PublicElectionsController {
  constructor(private readonly elections: PublicElectionsService) {}

  @Get(':id')
  record(@Param('id') id: string) {
    return this.elections.record(id);
  }

  @Get(':id/sealed-blocks')
  sealedBlocks(@Param('id') id: string) {
    return this.elections.sealedBlocks(id);
  }

  @Get(':id/results')
  results(@Param('id') id: string) {
    return this.elections.results(id);
  }

  /** The bylaws as the election's passed amendments give them, once certified (design §6.6). */
  @Get(':id/amended-bylaws')
  amendedBylaws(@Param('id') id: string) {
    return this.elections.amendedBylaws(id);
  }

  /** The results for spreadsheets, e.g. Google Sheets' IMPORTDATA; no Google account or API involved. */
  @Get(':id/results.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async resultsCsv(@Param('id') id: string, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const csv = await this.elections.resultsCsv(id, requestOrigin(req));
    void reply.header('Content-Disposition', `attachment; filename="results-${id.replace(/[^A-Za-z0-9-]/g, '')}.csv"`);
    return csv;
  }

  /**
   * The voting window as an iCalendar event (design §6.1). Opened as a link, not fetched, so it needs no credentials;
   * `inline` lets iOS offer to add it to Calendar, and other browsers download it, as they cannot show text/calendar.
   */
  @Get(':id/calendar.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async calendar(@Param('id') id: string, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const ics = await this.elections.calendar(id, requestOrigin(req));
    void reply.header('Content-Disposition', `inline; filename="ustp-vote-${id.replace(/[^A-Za-z0-9-]/g, '')}.ics"`);
    return ics;
  }

  @Get(':id/proofs/:commitment')
  proof(@Param('id') id: string, @Param('commitment') commitment: string) {
    return this.elections.proof(id, commitment);
  }
}
