import type { Provider } from '@nestjs/common';
import { ApplicationRepository } from './application.repository.js';
import { MembershipApplications } from './applications.service.js';
import { FirstStepsReader } from './first-steps.js';
import { FirstStepsRepository } from './first-steps.repository.js';
import { FirstStepsSettingsService } from './first-steps-settings.js';
import { JoinFunnelService } from './join-funnel.js';
import { MemberAdditions } from './member-additions.service.js';
import { MemberDirectory } from './member-directory.js';
import { MemberRepository } from './member.repository.js';
import { Members } from './members.service.js';
import { MembershipService } from './membership.service.js';
import { RegistrationFormService } from './registration-form.js';

/**
 * Everything the membership context provides, for the API module to register (design §3.3). Other contexts inject
 * `MemberDirectory` (reads) and `Members` (a test persona's admission); the repositories are the context's own.
 */
export const MEMBERSHIP_PROVIDERS: Provider[] = [
  MemberRepository,
  ApplicationRepository,
  MemberDirectory,
  Members,
  MemberAdditions,
  MembershipApplications,
  MembershipService,
  RegistrationFormService,
  JoinFunnelService,
  FirstStepsReader,
  FirstStepsRepository,
  FirstStepsSettingsService,
];

/** For a module that only reads members, as the worker does for election notices (design §6.8). */
export const MEMBER_DIRECTORY_PROVIDERS: Provider[] = [MemberRepository, ApplicationRepository, MemberDirectory];
