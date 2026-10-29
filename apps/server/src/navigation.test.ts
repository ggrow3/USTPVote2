import { Reflector } from '@nestjs/core';
import { ADMIN_SECTIONS, ROLES, SECTION_ROLES, type AdminSection, type Role } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { AccountsAdminController } from './accounts/accounts.controller.js';
import { ApprovalsController, AuditController, SignInMethodsController } from './administration/administration.controller.js';
import { HomeQuoteAdminController } from './administration/home-quote.js';
import { HubAdminController } from './administration/hub.js';
import { NavigationAdminController } from './administration/navigation.js';
import { ROLES_KEY } from './auth/decorators.js';
import { CandidaciesAdminController } from './candidacies/candidacies.controller.js';
import { AnthropicKeyController } from './claude-checks/anthropic-key-admin.js';
import { CourseController } from './course/course.controller.js';
import { ElectionsController } from './elections/elections.controller.js';
import { MembershipAdminController } from './membership/membership.controller.js';
import { RegistrationFormAdminController } from './membership/registration-form.js';
import { NoticeSettingsController } from './notifications/notice-settings.js';
import { PersonasController } from './personas/personas.controller.js';
import { PhotoReviewController } from './photos/photos.controller.js';
import { PositionsController } from './positions/positions.controller.js';
import { SecurityController } from './security/sign-in-log.js';
import { TeamsAdminController } from './teams/teams.controller.js';

type Route = readonly [controller: abstract new (...args: never[]) => object, method: string];

/** The route each admin console section opens with: what it lists, or (Bylaws) what it is for. */
const SECTION_ROUTES: Readonly<Record<AdminSection, Route>> = {
  applications: [MembershipAdminController, 'listApplications'],
  members: [MembershipAdminController, 'listMembers'],
  photos: [PhotoReviewController, 'list'],
  bylaws: [MembershipAdminController, 'publishBylaws'],
  registration: [RegistrationFormAdminController, 'current'],
  elections: [ElectionsController, 'list'],
  offices: [PositionsController, 'all'],
  candidacies: [CandidaciesAdminController, 'list'],
  teams: [TeamsAdminController, 'list'],
  approvals: [ApprovalsController, 'list'],
  people: [AccountsAdminController, 'list'],
  signin: [SignInMethodsController, 'current'],
  claude: [AnthropicKeyController, 'status'],
  email: [NoticeSettingsController, 'current'],
  audit: [AuditController, 'events'],
  security: [SecurityController, 'list'],
  testing: [PersonasController, 'list'],
  navigation: [NavigationAdminController, 'current'],
  hub: [HubAdminController, 'current'],
  quote: [HomeQuoteAdminController, 'current'],
  course: [CourseController, 'adminContent'],
};

function rolesOf([controller, method]: Route): readonly Role[] {
  const handler = (controller.prototype as Record<string, unknown>)[method];
  if (typeof handler !== 'function') throw new Error(`${controller.name}.${method} is not a route`);
  return new Reflector().getAllAndOverride<Role[] | undefined>(ROLES_KEY, [handler, controller]) ?? [];
}

describe('who sees which section (design §10.5)', () => {
  // The settings lock off a section for every role outside SECTION_ROLES; this keeps that list the API's own.
  it.each(ADMIN_SECTIONS)('%s: the locked-off roles are the ones the API refuses', (section) => {
    expect([...rolesOf(SECTION_ROUTES[section])].sort()).toEqual([...SECTION_ROLES[section]].sort());
  });

  it('lets every role use Approvals and read Offices', () => {
    expect(SECTION_ROLES.approvals).toEqual(ROLES);
    expect(SECTION_ROLES.offices).toEqual(ROLES);
  });
});
