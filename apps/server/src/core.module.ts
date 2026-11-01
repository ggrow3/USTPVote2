import { Global, Module } from '@nestjs/common';
import { DirectoryService } from './auth/directory.service.js';
import { MfaPolicyService } from './auth/mfa-policy.js';
import { SignInMethodsService } from './auth/sign-in-methods.service.js';
import { CONFIG, loadConfig } from './config.js';
import { Firebase } from './infra/firebase.js';
import { LedgerService } from './ledger/ledger.service.js';

/** Infrastructure shared by every feature module. */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    Firebase,
    LedgerService,
    SignInMethodsService,
    MfaPolicyService,
    DirectoryService,
  ],
  exports: [CONFIG, Firebase, LedgerService, SignInMethodsService, MfaPolicyService, DirectoryService],
})
export class CoreModule {}
