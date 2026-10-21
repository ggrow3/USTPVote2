import { Controller, Get } from '@nestjs/common';
import { TALLY_VERSION } from 'ustp-tally';
import { Public } from '../auth/decorators.js';

@Controller()
export class HealthController {
  @Public()
  @Get('healthz')
  health() {
    return { status: 'ok', tally: TALLY_VERSION };
  }
}
