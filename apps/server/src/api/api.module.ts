import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsAdminController, AccountsController } from '../accounts/accounts.controller.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { EmailVerifiedSync } from '../accounts/email-verified-sync.js';
import {
  ApprovalsController,
  AuditController,
  PublicSignInMethodsController,
  SignInMethodsController,
} from '../administration/administration.controller.js';
import { ApprovalsService } from '../administration/approvals.service.js';
import { HomeQuoteAdminController, HomeQuoteService, PublicHomeQuoteController } from '../administration/home-quote.js';
import { DiscordLiveService, HubAdminController, HubService, PublicHubController } from '../administration/hub.js';
import { NavigationAdminController, NavigationService, PublicNavigationController } from '../administration/navigation.js';
import { RoleChanges } from '../administration/role-changes.js';
import { SearchEnginesController } from '../administration/search-engines.js';
import { PageVisitsAdminController, PageVisitsController, PageVisitsService, PublicPageVisitsController } from '../security/page-visits.js';
import { SecurityController, SignInLogService } from '../security/sign-in-log.js';
import { PublicSiteAnalyticsController, SiteAnalyticsAdminController, SiteAnalyticsService } from '../security/site-analytics.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { MfaPolicyController } from '../auth/mfa-policy.js';
import { BylawsChecksController } from '../bylaws-check/bylaws-checks.controller.js';
import {
  AreaContactsAdminController,
  CandidaciesAdminController,
  CandidaciesController,
  EmailTemplatesAdminController,
  PublicAreaCandidatesController,
  PublicCandidaciesController,
  PublicDistrictsController,
} from '../candidacies/candidacies.controller.js';
import { CANDIDACIES_PROVIDERS } from '../candidacies/providers.js';
import { BylawsChecksService } from '../bylaws-check/bylaws-checks.service.js';
import { AnthropicKey } from '../claude-checks/anthropic-key.js';
import { AnthropicKeyAdminService, AnthropicKeyController } from '../claude-checks/anthropic-key-admin.js';
import { ANTHROPIC_KEY_TESTER, ClaudeKeyTester, UntriedKeyTester } from '../claude-checks/key-tester.js';
import { ApiKeys } from '../api-keys/api-keys.js';
import { ApiKeysAdminService, ApiKeysController } from '../api-keys/api-keys-admin.js';
import { API_KEY_TESTER, PublicApiKeyTester, UntriedApiKeyTester } from '../api-keys/key-tester.js';
import { HealthController } from '../common/health.controller.js';
import { CourseController } from '../course/course.controller.js';
import { CourseService } from '../course/course.service.js';
import { CourseLearnersService } from '../course/course-learners.service.js';
import { VideosController, VideosService } from '../videos/videos.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { AdminConsistencyChecksController, ConsistencyChecksController } from '../consistency-check/consistency-checks.controller.js';
import { ConsistencyChecksService } from '../consistency-check/consistency-checks.service.js';
import { CoreModule } from '../core.module.js';
import { ElectionCheckMaterials } from '../election-check/election-check-material.js';
import { ElectionChecksController, PublicElectionChecksController } from '../election-check/election-checks.controller.js';
import { ElectionChecksService } from '../election-check/election-checks.service.js';
import { ElectionApprovals } from '../elections/election-approvals.js';
import { ElectionReader } from '../elections/election-reader.js';
import { ElectionsController, MemberSearchController, ProposalsController } from '../elections/elections.controller.js';
import { ElectionsService } from '../elections/elections.service.js';
import { PublicElectionsController } from '../elections/public-elections.controller.js';
import { PublicElectionsService } from '../elections/public-elections.service.js';
import { VotingController } from '../elections/voting.controller.js';
import { VotingService } from '../elections/voting.service.js';
import { ballotPoolKeysProvider } from '../infra/ballot-pool.js';
import { secretStoreProvider } from '../infra/secret-store.js';
import { PublicLedgerController } from '../ledger/ledger.controller.js';
import { MembershipAdminController, RegistrationController } from '../membership/membership.controller.js';
import { MEMBERSHIP_PROVIDERS } from '../membership/providers.js';
import { PublicRegistrationFormController, RegistrationFormAdminController } from '../membership/registration-form.js';
import { NoticeSettingsController } from '../notifications/notice-settings.js';
import { NoticesController } from '../notifications/notices.controller.js';
import { NOTIFICATION_API_PROVIDERS } from '../notifications/providers.js';
import { LocalPhotoChecker, PHOTO_CHECKER, VisionPhotoChecker } from '../photos/checker.js';
import { MyPhotoController, PhotoReviewController } from '../photos/photos.controller.js';
import { PhotosService } from '../photos/photos.service.js';
import { DemoElectionsController, DemoElectionsService } from '../personas/demo-elections.js';
import { PersonasController } from '../personas/personas.controller.js';
import { PersonasService } from '../personas/personas.service.js';
import { PositionApprovals } from '../positions/position-approvals.js';
import { PositionsController, PublicPositionsController } from '../positions/positions.controller.js';
import { PositionsService } from '../positions/positions.service.js';
import { ForumAdminController, ForumController } from '../forum/forum.controller.js';
import { FORUM_PROVIDERS } from '../forum/providers.js';
import { ROOM_PROVIDERS } from '../room/providers.js';
import { RoomAdminController, RoomController } from '../room/room.controller.js';
import { COMMUNICATIONS_PROVIDERS } from '../communications/providers.js';
import {
  CommunicationsAdminController,
  PublicNewsController,
  PublicPressController,
  PublicSuggestionsController,
  ShareController,
} from '../communications/communications.controller.js';
import { TEAMS_PROVIDERS } from '../teams/providers.js';
import { TeamsAdminController, TeamsController } from '../teams/teams.controller.js';

/**
 * Client-facing API (design §12). Every route requires a verified sign-in unless marked @Public().
 * M1: accounts, registration, membership administration, profile photos, roles and approvals, auth switches, ledger.
 * M2: election setup, rolls, scheduling and cancellation; the published ledger (blocks, keys, proofs, anchors).
 * M3: voting. M4: results, certification, offices and terms; teams (design §5.7), the forum (§5.9), the members' room (§5.10). Testing mode: test personas and demo elections (design
 * §10.4). M5: who sees which link (design §10.5), the home page hub (§10.6), communications (§10.9), robots.txt and
 * the sitemap (§15); the
 * platform consistency check (design §5.5), the election setup check (§6.9) and the Anthropic API key (design §5.6);
 * candidacies for public office and their districts' map (design §5.8).
 */
@Module({
  imports: [CoreModule],
  controllers: [
    HealthController,
    AccountsController,
    RegistrationController,
    MembershipAdminController,
    PublicRegistrationFormController,
    RegistrationFormAdminController,
    BylawsChecksController,
    MyPhotoController,
    PhotoReviewController,
    ElectionsController,
    ProposalsController,
    MemberSearchController,
    NoticesController,
    NoticeSettingsController,
    VotingController,
    ConsistencyChecksController,
    AdminConsistencyChecksController,
    ElectionChecksController,
    PublicElectionChecksController,
    PublicElectionsController,
    PositionsController,
    PublicPositionsController,
    CandidaciesController,
    CandidaciesAdminController,
    PublicCandidaciesController,
    PublicAreaCandidatesController,
    PublicDistrictsController,
    AreaContactsAdminController,
    EmailTemplatesAdminController,
    TeamsController,
    TeamsAdminController,
    ForumController,
    ForumAdminController,
    RoomController,
    RoomAdminController,
    ApprovalsController,
    AccountsAdminController,
    PublicSignInMethodsController,
    SignInMethodsController,
    MfaPolicyController,
    AnthropicKeyController,
    ApiKeysController,
    PublicNavigationController,
    NavigationAdminController,
    PublicHomeQuoteController,
    HomeQuoteAdminController,
    PublicHubController,
    HubAdminController,
    PublicNewsController,
    PublicPressController,
    PublicSuggestionsController,
    ShareController,
    CommunicationsAdminController,
    SearchEnginesController,
    SecurityController,
    PublicSiteAnalyticsController,
    SiteAnalyticsAdminController,
    PageVisitsController,
    PublicPageVisitsController,
    PageVisitsAdminController,
    AuditController,
    PublicLedgerController,
    PersonasController,
    DemoElectionsController,
    CourseController,
    VideosController,
  ],
  providers: [
    AccountsService,
    EmailVerifiedSync,
    ...MEMBERSHIP_PROVIDERS,
    ...NOTIFICATION_API_PROVIDERS,
    BylawsChecksService,
    PhotosService,
    ElectionsService,
    ElectionReader,
    ElectionApprovals,
    VotingService,
    ConsistencyChecksService,
    ElectionChecksService,
    ElectionCheckMaterials,
    AnthropicKey,
    AnthropicKeyAdminService,
    ApiKeys,
    ApiKeysAdminService,
    PublicElectionsService,
    ballotPoolKeysProvider,
    RoleChanges,
    PositionApprovals,
    PositionsService,
    ...CANDIDACIES_PROVIDERS,
    ...TEAMS_PROVIDERS,
    ...FORUM_PROVIDERS,
    ...ROOM_PROVIDERS,
    ...COMMUNICATIONS_PROVIDERS,
    ApprovalsService,
    NavigationService,
    HomeQuoteService,
    HubService,
    DiscordLiveService,
    SignInLogService,
    SiteAnalyticsService,
    PageVisitsService,
    PersonasService,
    DemoElectionsService,
    CourseService,
    VideosService,
    CourseLearnersService,
    secretStoreProvider,
    {
      provide: PHOTO_CHECKER,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) =>
        config.photoChecker === 'vision' ? new VisionPhotoChecker() : new LocalPhotoChecker(),
    },
    {
      provide: ANTHROPIC_KEY_TESTER,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) => (config.usingEmulators ? new UntriedKeyTester() : new ClaudeKeyTester()),
    },
    {
      provide: API_KEY_TESTER,
      inject: [CONFIG],
      useFactory: (config: ServerConfig) => (config.usingEmulators ? new UntriedApiKeyTester() : new PublicApiKeyTester()),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class ApiModule {}
