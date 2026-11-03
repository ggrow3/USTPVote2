import type {
  AddMemberInput,
  ApplicationRecord,
  ApplicationStatus,
  CreateApplicationInput,
  DecisionInput,
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
  RegistrationFormInput,
  RegistrationFormRecord,
  StatusHistoryRecord,
  WelcomeAgain,
} from 'ustp-domain';
import { api } from '../api.js';

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

/** The registration form's wording with who changed it last. */
export function registrationFormSettings(): Promise<RegistrationFormRecord> {
  return api<RegistrationFormRecord>('GET', '/v1/admin/registration-form');
}

/** Saves the wording; refused (409) if someone saved since version `basedOn`. */
export function saveRegistrationForm(input: RegistrationFormInput): Promise<RegistrationFormRecord> {
  return api<RegistrationFormRecord>('PUT', '/v1/admin/registration-form', input);
}
