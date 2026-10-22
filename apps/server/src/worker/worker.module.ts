import { Module } from '@nestjs/common';
import { HealthController } from '../common/health.controller.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { CoreModule } from '../core.module.js';
import { ElectionReader } from '../elections/election-reader.js';
import { AUDIT_SIGNER, EmulatorAuditSigner, KmsAuditSigner } from '../infra/audit-signer.js';
import { ballotPoolKeysProvider } from '../infra/ballot-pool.js';
import { Firebase } from '../infra/firebase.js';
import { ElectionClock } from './election-clock.js';
import { LedgerSealer } from './ledger-sealer.js';
import { TasksController } from './tasks.controller.js';

/** Background worker (design §13). Same image as the API, separate service account and Cloud Run service. */
@Module({
  imports: [CoreModule],
  controllers: [HealthController, TasksController],
  providers: [
    ElectionReader,
    ElectionClock,
    LedgerSealer,
    ballotPoolKeysProvider,
    {
      provide: AUDIT_SIGNER,
      inject: [CONFIG, Firebase],
      useFactory: (config: ServerConfig, firebase: Firebase) =>
        config.auditSigner === 'emulator'
          ? new EmulatorAuditSigner(firebase.db)
          : new KmsAuditSigner(config.auditSigningKeyVersion),
    },
  ],
})
export class WorkerModule {}
