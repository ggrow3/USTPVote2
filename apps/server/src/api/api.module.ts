import { Module } from '@nestjs/common';
import { HealthController } from '../common/health.controller.js';

/**
 * Client-facing API (design §12). Feature modules arrive by milestone:
 * M1 accounts/registration, M2 elections/approvals/ledger, M3 casting/verification, M4 results.
 */
@Module({
  controllers: [HealthController],
})
export class ApiModule {}
