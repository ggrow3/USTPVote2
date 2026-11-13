import type {
  ApplicationQueueSummary,
  AddMemberInput,
  ApplicationRecord,
  ApplicationStatus,
  BylawsRecord,
  BylawsVersionSummary,
  CreateApplicationInput,
  DecisionInput,
  FirstStepsRecord,
  FirstStepsSettingsInput,
  FirstStepsView,
  JoinFunnelReport,
  MemberCorrectionInput,
  MemberDetail,
  MemberDetailsInput,
  MemberImportInput,
  MemberImportPlan,
  MemberImportPreviewInput,
  MemberImportResult,
  MemberRecord,
  MemberStatus,
  MemberStatusInput,
  PublicRegistrationForm,
  PublishBylawsInput,
  RegistrationFormInput,
  RegistrationFormRecord,
  StatusHistoryRecord,
  WelcomeAgain,
} from 'ustp-domain';
import { api, ApiError } from '../api.js';

/**
 * The membership context's API (design §5.1, §5.2, §12): applications to join and members' status. The only place its
 * routes are written; pages and panels call these.
 */

/** The signed-in person's own applications, newest first. */
export function myApplications(): Promise<ApplicationRecord[]> {
  return api<ApplicationRecord[]>('GET', '/v1/registration/applications/me');
}

export function submitApplication(input: CreateApplicationInput): Promise<ApplicationRecord> {
  return api<ApplicationRecord>('POST', '/v1/registration/applications', input);
}

/** The registration form's wording as the Register page shows it: intro, questions, Core Ideals; no sign-in needed. */
export function registrationForm(): Promise<PublicRegistrationForm> {
  return api<PublicRegistrationForm>('GET', '/v1/registration/form');
}

/** The signed-in member resigns, with a reason if they give one. */
export function resign(reason?: string): Promise<MemberRecord> {
  return api<MemberRecord>('POST', '/v1/me/resign', reason ? { reason } : {});
}

/** The signed-in member's own details and email opt-ins. */
export function updateMyDetails(input: MemberDetailsInput): Promise<MemberRecord> {
  return api<MemberRecord>('POST', '/v1/me/details', input);
}

// --- Membership Admin ---------------------------------------------------------------------------------------------

/** Applications in a status, oldest first. */
export function applications(status: ApplicationStatus): Promise<ApplicationRecord[]> {
  return api<ApplicationRecord[]>('GET', `/v1/admin/applications?status=${status}`);
}

/** The signed-in member's first steps and which they have done (design §5.16). */
export function myFirstSteps(): Promise<FirstStepsView> {
  return api<FirstStepsView>('GET', '/v1/me/first-steps');
}

/** Ticks or unticks a step the member ticks themselves, and gives back their list (design §5.16). */
export function tickFirstStep(id: string, done: boolean): Promise<FirstStepsView> {
  return api<FirstStepsView>('PUT', `/v1/me/first-steps/${encodeURIComponent(id)}`, { done });
}

/** The getting started list as Membership Admins set it (design §5.16). */
export function firstStepsSettings(): Promise<FirstStepsRecord> {
  return api<FirstStepsRecord>('GET', '/v1/admin/first-steps');
}

export function saveFirstSteps(input: FirstStepsSettingsInput): Promise<FirstStepsRecord> {
  return api<FirstStepsRecord>('PUT', '/v1/admin/first-steps', input);
}

/** The join funnel over the last `days` days (design §5.15). */
export function joinFunnel(days: number): Promise<JoinFunnelReport> {
  return api<JoinFunnelReport>('GET', `/v1/admin/join-funnel?days=${days}`);
}

/** How many applications wait for a decision, and since when the oldest (design §5.2). */
export function applicationQueueSummary(): Promise<ApplicationQueueSummary> {
  return api<ApplicationQueueSummary>('GET', '/v1/admin/applications/summary');
}

export function decideApplication(applicationId: string, input: DecisionInput): Promise<ApplicationRecord> {
  return api<ApplicationRecord>('POST', `/v1/admin/applications/${applicationId}/decision`, input);
}

/** A page of members by account ID, optionally in one status, after the account ID `after`. */
export function members(query: {
  readonly status: MemberStatus | null;
  readonly after: string | undefined;
  readonly limit: number;
}): Promise<MemberRecord[]> {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.status) params.set('status', query.status);
  if (query.after) params.set('after', query.after);
  return api<MemberRecord[]>('GET', `/v1/admin/members?${params}`);
}

export function changeMemberStatus(accountId: string, input: MemberStatusInput): Promise<MemberRecord> {
  return api<MemberRecord>('POST', `/v1/admin/members/${accountId}/status`, input);
}

/** A member's status history, newest first. */
export function memberHistory(accountId: string): Promise<StatusHistoryRecord[]> {
  return api<StatusHistoryRecord[]>('GET', `/v1/admin/members/${accountId}/history`);
}

/** One member's profile: their record, every application with its answers, and their status history. */
export function member(accountId: string): Promise<MemberDetail> {
  return api<MemberDetail>('GET', `/v1/admin/members/${accountId}`);
}

/** Corrects someone else's names, state or contact details, with a reason. */
export function correctMemberDetails(accountId: string, input: MemberCorrectionInput): Promise<MemberRecord> {
  return api<MemberRecord>('POST', `/v1/admin/members/${accountId}/details`, input);
}

/** Adds one member, Active at once; they set their own password when they first come (design §5.13). */
export function addMember(input: AddMemberInput): Promise<MemberImportResult> {
  return api<MemberImportResult>('POST', '/v1/admin/members', input);
}

/** What importing a file's rows would do now: each row added or skipped, with the reasons. */
export function previewMemberImport(input: MemberImportPreviewInput): Promise<MemberImportPlan> {
  return api<MemberImportPlan>('POST', '/v1/admin/member-imports/preview', input);
}

export function importMembers(input: MemberImportInput): Promise<MemberImportResult> {
  return api<MemberImportResult>('POST', '/v1/admin/member-imports', input);
}

/** Sends an added member's welcome email again, or gives the address for the browser to send Identity Platform's. */
export function welcomeAgain(accountId: string): Promise<WelcomeAgain> {
  return api<WelcomeAgain>('POST', `/v1/admin/members/${accountId}/welcome`);
}

/**
 * Says Identity Platform took the welcome sign-in link this browser just asked it for, so the site records it in the
 * email log as this admin's and on the member's page (design §5.13).
 */
export function welcomeLinkSent(accountId: string): Promise<void> {
  return api<void>('POST', `/v1/admin/members/${accountId}/welcome-link`);
}

/** The registration form's wording with who changed it last. */
export function registrationFormSettings(): Promise<RegistrationFormRecord> {
  return api<RegistrationFormRecord>('GET', '/v1/admin/registration-form');
}

/** Saves the wording; refused (409) if someone saved since version `basedOn`. */
export function saveRegistrationForm(input: RegistrationFormInput): Promise<RegistrationFormRecord> {
  return api<RegistrationFormRecord>('PUT', '/v1/admin/registration-form', input);
}

/** The newest published bylaws version, blank or not; null before any is published (design §5.2). */
export function currentBylaws(): Promise<BylawsRecord | null> {
  return api<BylawsRecord>('GET', '/v1/bylaws/current').catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
}

/** Every published bylaws version without its text, newest first. */
export function bylawsVersions(): Promise<BylawsVersionSummary[]> {
  return api<BylawsVersionSummary[]>('GET', '/v1/bylaws');
}

/** Publishes the next bylaws version (Membership Admins): permanent and ledgered; blank text clears the bylaws. */
export function publishBylaws(input: PublishBylawsInput): Promise<BylawsRecord> {
  return api<BylawsRecord>('POST', '/v1/admin/bylaws', input);
}
