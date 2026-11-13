import { z } from 'zod';
import type { CourseCertificateRecord } from './course.js';

/**
 * Course certificates people share (design §10.8, "Sharing a certificate"): the name a holder puts on theirs, whether
 * its public page shows it, and LinkedIn's Add to profile link.
 */

/** Who issues the certificates, as LinkedIn names the issuer when no organization ID is set. */
export const CERTIFICATE_ISSUER = 'U.S. Transhumanist Party';

/** A certificate's name is at most this long, printed on one line of the PDF. */
export const CERTIFICATE_NAME_MAX = 100;

/**
 * What is wrong with a name for a certificate, in words, or null. It is a person's name as they want it printed and,
 * if they choose, shown on the public page: never an email address, which a login without a name was given at first.
 */
export function certificateNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'give the name to put on the certificate';
  if ([...trimmed].length > CERTIFICATE_NAME_MAX) return `a name of at most ${CERTIFICATE_NAME_MAX} characters`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return 'a name on one line';
  if (trimmed.includes('@')) return 'a name, not an email address';
  return null;
}

/** The holder's name as the public page shows it: only while they show it, and never an email address. */
export function shownHolderName(certificate: Pick<CourseCertificateRecord, 'recipientName' | 'nameShown'>): string | null {
  return certificate.nameShown === true && certificateNameProblem(certificate.recipientName) === null ? certificate.recipientName.trim() : null;
}

/** `PUT /v1/courses/{courseId}/certificate`: the holder's name on it, whether the public page shows it, or both. */
export const certificateHolderSchema = z
  .strictObject({
    recipientName: z
      .string()
      .max(CERTIFICATE_NAME_MAX * 4)
      .superRefine((name, ctx) => {
        const problem = certificateNameProblem(name);
        if (problem) ctx.addIssue({ code: 'custom', message: problem });
      })
      .transform((name) => name.trim())
      .optional(),
    nameShown: z.boolean().optional(),
  })
  .refine((input) => input.recipientName !== undefined || input.nameShown !== undefined, 'change the name, whether it is shown, or both');
export type CertificateHolderInput = z.infer<typeof certificateHolderSchema>;

/** A LinkedIn organization ID, as its page's admin view shows it: digits only. */
const LINKEDIN_ORGANIZATION_ID = /^\d{1,20}$/;

/** What System Admins set about certificates (`certificate_settings/current`); absent fields read as unset. */
export interface CertificateSettings {
  /** The party's LinkedIn organization, so Add to profile names it with its page and logo; null names it in words. */
  readonly linkedInOrganizationId: string | null;
}

export interface CertificateSettingsRecord extends CertificateSettings {
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** `PUT /v1/admin/certificate-settings`. */
export const certificateSettingsSchema = z.strictObject({
  linkedInOrganizationId: z.string().trim().regex(LINKEDIN_ORGANIZATION_ID, 'the digits of a LinkedIn organization ID').nullable(),
});
export type CertificateSettingsInput = z.infer<typeof certificateSettingsSchema>;

/** Where a certificate's public page is. */
export function certificatePagePath(certificateId: string): string {
  return `/course/certificates/${encodeURIComponent(certificateId)}`;
}

export interface AddToProfile {
  readonly courseTitle: string;
  readonly certificateId: string;
  readonly issuedAt: string;
  /** The certificate's public page, which LinkedIn links as the credential. */
  readonly certificateUrl: string;
  readonly organizationId: string | null;
}

/**
 * LinkedIn's Add to profile link for a certification: the course as its name, the party as the issuer (by its
 * organization ID when set, else by name), the month it was issued, and the public page and number as the credential.
 */
export function linkedInAddToProfileUrl(input: AddToProfile): string {
  const issued = new Date(input.issuedAt);
  const params = new URLSearchParams({ startTask: 'CERTIFICATION_NAME', name: input.courseTitle });
  if (input.organizationId && LINKEDIN_ORGANIZATION_ID.test(input.organizationId)) params.set('organizationId', input.organizationId);
  else params.set('organizationName', CERTIFICATE_ISSUER);
  if (!Number.isNaN(issued.getTime())) {
    params.set('issueYear', String(issued.getUTCFullYear()));
    params.set('issueMonth', String(issued.getUTCMonth() + 1));
  }
  params.set('certUrl', input.certificateUrl);
  params.set('certId', input.certificateId);
  return `https://www.linkedin.com/profile/add?${params}`;
}

/** The day a certificate was issued, as its page and card write it ("November 12, 2026"). */
export function certificateDate(issuedAt: string): string {
  return new Date(issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
