import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsAdminController, AccountsController } from '../accounts/accounts.controller.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  ApprovalsController,
  AuditController,
  PublicSignInMethodsController,
  SignInMethodsController,
} from '../administration/administration.controller.js';
import { ApprovalsService } from '../administration/approvals.service.js';
import { RoleChanges } from '../administration/role-changes.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { BylawsChecksController } from '../bylaws-check/bylaws-checks.controller.js';
import { BylawsChecksService } from '../bylaws-check/bylaws-checks.service.js';
import { HealthController } from '../common/health.controller.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { CoreModule } from '../core.module.js';
import { ElectionApprovals } from '../elections/election-approvals.js';
import { ElectionReader } from '../elections/election-reader.js';
import { ElectionsController, ProposalsController } from '../elections/elections.controller.js';
import { ElectionsService } from '../elections/elections.service.js';
import { PublicElectionsController } from '../elections/public-elections.controller.js';
import { PublicElectionsService } from '../elections/public-elections.service.js';
import { VotingController } from '../elections/voting.controller.js';
import { VotingService } from '../elections/voting.service.js';
import { ballotPoolKeysProvider } from '../infra/ballot-pool.js';
import { secretStoreProvider } from '../infra/secret-store.js';
import { PublicLedgerController } from '../ledger/ledger.controller.js';
import { MembershipAdminController, RegistrationController } from '../membership/membership.controller.js';
import { MembershipService } from '../membership/membership.service.js';
import { LocalPhotoChecker, PHOTO_CHECKER, VisionPhotoChecker } from '../photos/checker.js';
import { MyPhotoController, PhotoReviewController } from '../photos/photos.controller.js';
import { PhotosService } from '../photos/photos.service.js';
import { PersonasController } from '../personas/personas.controller.js';
import { PersonasService } from '../personas/personas.service.js';
import { PositionApprovals } from '../positions/position-approvals.js';
import { PositionsController, PublicPositionsController } from '../positions/positions.controller.js';
import { PositionsService } from '../positions/positions.service.js';

/**
 * Client-facing API (design §12). Every route requires a verified sign-in unless marked @Public().
 * M1: accounts, registration, membership administration, profile photos, roles and approvals, auth switches, ledger.
 * M2: election setup, rolls, scheduling and cancellation; the published ledger (blocks, keys, proofs, anchors).
 * M3: voting. M4: results, certification, offices and terms. Testing mode: test personas (design §10.4).
 */
@Module({
  imports: [CoreModule],
  controllers: [
    HealthController,
    AccountsController,
    RegistrationController,
    MembershipAdminController,
    BylawsChecksController,
    MyPhotoController,
    PhotoReviewController,
    ElectionsController,
    ProposalsController,
    VotingController,
    PublicElectionsController,
    PositionsController,
    PublicPositionsController,
    ApprovalsController,
    AccountsAdminController,
    PublicSignInMethodsController,
    SignInMethodsController,
    AuditController,
    PublicLedgerController,
    PersonasController,
  ],
  providers: [
    AccountsService,
    MembershipService,
    BylawsChecksService,
    PhotosService,
    ElectionsService,
    ElectionReader,
    ElectionApprovals,
    VotingService,
    PublicElectionsService,
    ballotPoolKeysProvider,
    RoleChanges,
    PositionApprovals,
    PositionsService,
    ApprovalsService,
    PersonasService,
    secretStoreProvider,
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
