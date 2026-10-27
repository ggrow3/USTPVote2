import { Module } from '@nestjs/common';
import { BylawsCheckRunner } from '../bylaws-check/bylaws-check-runner.js';
import { BYLAWS_CHECKER } from '../bylaws-check/checker.js';
import { ClaudeBylawsChecker } from '../bylaws-check/claude-checker.js';
import { ReferenceLibrary } from '../bylaws-check/references.js';
import { StubBylawsChecker } from '../bylaws-check/stub-checker.js';
import { HealthController } from '../common/health.controller.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { CONSISTENCY_CHECKER } from '../consistency-check/checker.js';
import { ClaudeConsistencyChecker } from '../consistency-check/claude-consistency-checker.js';
import { ConsistencyCheckRunner } from '../consistency-check/consistency-check-runner.js';
import { StubConsistencyChecker } from '../consistency-check/stub-consistency-checker.js';
import { CoreModule } from '../core.module.js';
import { ElectionReader } from '../elections/election-reader.js';
import { AUDIT_SIGNER, EmulatorAuditSigner, KmsAuditSigner } from '../infra/audit-signer.js';
import { ballotPoolKeysProvider } from '../infra/ballot-pool.js';
import { Firebase } from '../infra/firebase.js';
import { secretStoreProvider } from '../infra/secret-store.js';
import { MEMBER_DIRECTORY_PROVIDERS } from '../membership/providers.js';
import { NOTIFICATION_WORKER_PROVIDERS } from '../notifications/providers.js';
import { BallotSealer } from './ballot-sealer.js';
import { ElectionClock } from './election-clock.js';
import { LedgerSealer } from './ledger-sealer.js';
import { Tallier } from './tallier.js';
import { TasksController } from './tasks.controller.js';

/** Background worker (design §13). Same image as the API, separate service account and Cloud Run service. */
@Module({
  imports: [CoreModule],
  controllers: [HealthController, TasksController],
  providers: [
    ElectionReader,
    ElectionClock,
    BallotSealer,
    LedgerSealer,
    Tallier,
    BylawsCheckRunner,
    ConsistencyCheckRunner,
    ballotPoolKeysProvider,
    secretStoreProvider,
    // Election notices greet roll members by name (design §6.8).
    ...MEMBER_DIRECTORY_PROVIDERS,
    ...NOTIFICATION_WORKER_PROVIDERS,
    {
      provide: AUDIT_SIGNER,
      inject: [CONFIG, Firebase],
      useFactory: (config: ServerConfig, firebase: Firebase) =>
        config.auditSigner === 'emulator'
          ? new EmulatorAuditSigner(firebase.db)
          : new KmsAuditSigner(config.auditSigningKeyVersion),
    },
    {
      provide: BYLAWS_CHECKER,
      inject: [CONFIG, Firebase],
      useFactory: (config: ServerConfig, firebase: Firebase) =>
        config.bylawsChecker === 'claude'
          ? new ClaudeBylawsChecker(config.anthropicApiKey, config.bylawsCheckModel, new ReferenceLibrary(firebase.db))
          : config.bylawsChecker === 'stub'
            ? new StubBylawsChecker()
            : null,
    },
    {
      provide: CONSISTENCY_CHECKER,
      inject: [CONFIG, Firebase],
      useFactory: (config: ServerConfig, firebase: Firebase) =>
        config.consistencyChecker === 'claude'
          ? new ClaudeConsistencyChecker(config.anthropicApiKey, config.consistencyCheckModel, new ReferenceLibrary(firebase.db))
          : config.consistencyChecker === 'stub'
            ? new StubConsistencyChecker()
            : null,
    },
  ],
})
export class WorkerModule {}
