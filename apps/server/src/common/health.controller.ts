import { Controller, Get, Header } from '@nestjs/common';
import { buildCommit, type HealthStatus } from 'ustp-domain';
import { TALLY_VERSION } from 'ustp-tally';
import { Public } from '../auth/decorators.js';

@Controller()
export class HealthController {
  // /healthz for startup probes inside the container. Cloud Run's front end reserves some paths ending in "z", so
  // /healthz is unreachable from outside: callers use /v1/health, which also passes Hosting's /v1/** rewrite. The
  // commit is the image's (design §15); open pages compare it with their own, so it must never come from a cache.
  @Public()
  @Get(['healthz', 'v1/health'])
  @Header('Cache-Control', 'no-store')
  health(): HealthStatus {
    return { status: 'ok', tally: TALLY_VERSION, commit: buildCommit(process.env.BUILD_COMMIT) };
  }
}
