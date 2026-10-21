import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsController } from '../accounts/accounts.controller.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  ApprovalsController,
  AuditController,
  PublicSignInMethodsController,
  SignInMethodsController,
} from '../administration/administration.controller.js';
import { ApprovalsService } from '../administration/approvals.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { HealthController } from '../common/health.controller.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { CoreModule } from '../core.module.js';
import { MembershipAdminController, RegistrationController } from '../membership/membership.controller.js';
import { MembershipService } from '../membership/membership.service.js';
import { LocalPhotoChecker, PHOTO_CHECKER, VisionPhotoChecker } from '../photos/checker.js';
import { MyPhotoController, PhotoReviewController } from '../photos/photos.controller.js';
import { PhotosService } from '../photos/photos.service.js';

/**
 * Client-facing API (design §12). Every route requires a verified sign-in unless marked @Public().
 * M1: accounts, registration, membership administration, profile photos, roles and approvals, auth switches, ledger.
 */
@Module({
  imports: [CoreModule],
  controllers: [
    HealthController,
    AccountsController,
    RegistrationController,
    MembershipAdminController,
    MyPhotoController,
    PhotoReviewController,
    ApprovalsController,
    PublicSignInMethodsController,
    SignInMethodsController,
    AuditController,
  ],
  providers: [
    AccountsService,
    MembershipService,
    PhotosService,
    ApprovalsService,
    {
      provide: PHOTO_CHECKER,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) =>
        config.photoChecker === 'vision' ? new VisionPhotoChecker() : new LocalPhotoChecker(),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class ApiModule {}
