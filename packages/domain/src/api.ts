import { z } from 'zod';
import { SIGN_IN_PROVIDERS } from './identity.js';
import { MEMBER_STATUSES } from './member-status.js';
import { checkApplicantAge, isCalendarDate, MINIMUM_MEMBER_AGE, normalizePhone, US_POSTAL_CODE } from './registration.js';
import { ROLES } from './roles.js';
import { MAX_TEST_VOTERS } from './testing.js';

/** Request bodies (design §12), shared by the API (validation) and the web app (forms, types). */

/** Every API error body (RFC 9457). */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  /** Field-level validation problems; `path` is the dotted field path. */
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
}

const reason = z.string().trim().min(1, 'a written reason is required').max(2000);
const hex32 = z.string().regex(/^[0-9a-f]{64}$/, 'expected 64 lowercase hex digits');
const uuidV7 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'expected a UUIDv7');
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createApplicationSchema = z
  .strictObject({
    bylawsVersion: z.string().min(1).max(64),
    /** Hash of the bylaws text the applicant was shown and agreed to. */
    bylawsHash: hex32,
    legalName: z.string().trim().min(1, 'enter your legal name').max(200),
    preferredName: optionalText(200),
    /** `YYYY-MM-DD`; checked against MINIMUM_MEMBER_AGE and kept on the application only (design §5.2). */
    dateOfBirth: z.string().trim().refine(isCalendarDate, 'enter your date of birth'),
    attestsAge: z.literal(true, { error: `confirm that you are at least ${MINIMUM_MEMBER_AGE}` }),
    supportsPlatform: z.literal(true, { error: 'confirm that you support the USTP platform' }),
    state: z.string().regex(/^[A-Z]{2}$/, 'choose your state or territory (two-letter code)'),
    city: z.string().trim().min(1, 'enter your city').max(100),
    postalCode: z.string().trim().regex(US_POSTAL_CODE, 'enter a 5-digit ZIP code'),
    phone: optionalText(32).refine(
      (v) => !v || normalizePhone(v) !== null,
      'enter a phone number with its area code, or with +country code outside the US',
    ),
    statement: optionalText(5000),
    interests: optionalText(1000),
    skills: optionalText(1000),
    volunteer: z.boolean().optional(),
    runForOffice: z.boolean().optional(),
    referral: optionalText(200),
    /** Opt-ins to party email; recorded with the time of consent. */
    newsletter: z.boolean().optional(),
    announcements: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (!isCalendarDate(input.dateOfBirth)) return;
    const age = checkApplicantAge(input.dateOfBirth, new Date());
    if (!age.ok) ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: age.reason });
  });
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const decisionSchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  reason,
});
export type DecisionInput = z.infer<typeof decisionSchema>;

export const photoDecisionSchema = z.strictObject({
  decision: z.enum(['accept', 'reject']),
  reason,
});
export type PhotoDecisionInput = z.infer<typeof photoDecisionSchema>;

export const memberStatusSchema = z.strictObject({
  to: z.enum(MEMBER_STATUSES),
  reason,
});
export type MemberStatusInput = z.infer<typeof memberStatusSchema>;

export const resignSchema = z.strictObject({ reason: optionalText(2000) });
export type ResignInput = z.infer<typeof resignSchema>;

/** A second ID token proving control of the login method being linked. */
export const linkIdentitySchema = z.strictObject({ idToken: z.string().min(1).max(8192) });
export type LinkIdentityInput = z.infer<typeof linkIdentitySchema>;

const bylawsVersion = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, 'letters, digits, ".", "_" and "-" only');

export const publishBylawsSchema = z.strictObject({
  version: bylawsVersion,
  title: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(500_000),
  /** The current version this draft started from; must still be current when publishing (design §5.2). */
  amends: bylawsVersion.nullable().optional(),
  changeNote: optionalText(2000),
});
export type PublishBylawsInput = z.infer<typeof publishBylawsSchema>;

export const roleChangeSchema = z.strictObject({
  accountId: uuidV7,
  role: z.enum(ROLES),
  change: z.enum(['grant', 'revoke']),
  reason,
});
export type RoleChangeInput = z.infer<typeof roleChangeSchema>;

/** `POST /v1/testing/personas`: creates any missing admin persona, then adds `voters` voter personas (design §10.4). */
export const createPersonasSchema = z.strictObject({
  voters: z.number().int().min(0).max(MAX_TEST_VOTERS).default(0),
});
export type CreatePersonasInput = z.infer<typeof createPersonasSchema>;

export const signInMethodsSchema = z
  .strictObject(Object.fromEntries(SIGN_IN_PROVIDERS.map((p) => [p, z.boolean().optional()])) as Record<
    (typeof SIGN_IN_PROVIDERS)[number],
    z.ZodOptional<z.ZodBoolean>
  >)
  .refine((v) => Object.keys(v).length > 0, 'change at least one sign-in method');
export type SignInMethodsInput = z.infer<typeof signInMethodsSchema>;
