import { Controller, Get } from '@nestjs/common';
import { TALLY_VERSION } from 'ustp-tally';

@Controller()
export class HealthController {
  @Get('healthz')
  health() {
    return { status: 'ok', tally: TALLY_VERSION };
  }
}
