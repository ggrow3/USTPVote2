import { Controller, Get } from '@nestjs/common';
import { TALLY_VERSION } from 'ustp-tally';
import { Public } from '../auth/decorators.js';

@Controller()
export class HealthController {
  // /healthz for startup probes inside the container. Cloud Run's front end reserves some paths ending in "z", so
  // /healthz is unreachable from outside: callers use /v1/health, which also passes Hosting's /v1/** rewrite.
  @Public()
  @Get(['healthz', 'v1/health'])
  health() {
    return { status: 'ok', tally: TALLY_VERSION };
  }
}
