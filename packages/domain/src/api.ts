import { z } from 'zod';
import { SIGN_IN_PROVIDERS } from './identity.js';
import { MEMBER_STATUSES } from './member-status.js';
import { ROLES } from './roles.js';

/** Request bodies (design §12), shared by the API (validation) and the web app (forms, types). */

const reason = z.string().trim().min(1, 'a written reason is required').max(2000);
const hex32 = z.string().regex(/^[0-9a-f]{64}$/, 'expected 64 lowercase hex digits');
const uuidV7 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'expected a UUIDv7');
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createApplicationSchema = z.strictObject({
  bylawsVersion: z.string().min(1).max(64),
  /** Hash of the bylaws text the applicant was shown and agreed to. */
  bylawsHash: hex32,
  legalName: z.string().trim().min(1).max(200),
  preferredName: optionalText(200),
  state: z.string().regex(/^[A-Z]{2}$/, 'expected a two-letter state code'),
  statement: optionalText(5000),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const decisionSchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  reason,
});
export type DecisionInput = z.infer<typeof decisionSchema>;

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

export const publishBylawsSchema = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  title: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(500_000),
});
export type PublishBylawsInput = z.infer<typeof publishBylawsSchema>;

export const roleChangeSchema = z.strictObject({
  accountId: uuidV7,
  role: z.enum(ROLES),
  change: z.enum(['grant', 'revoke']),
  reason,
});
export type RoleChangeInput = z.infer<typeof roleChangeSchema>;

export const signInMethodsSchema = z
  .strictObject(Object.fromEntries(SIGN_IN_PROVIDERS.map((p) => [p, z.boolean().optional()])) as Record<
    (typeof SIGN_IN_PROVIDERS)[number],
    z.ZodOptional<z.ZodBoolean>
  >)
  .refine((v) => Object.keys(v).length > 0, 'change at least one sign-in method');
export type SignInMethodsInput = z.infer<typeof signInMethodsSchema>;
