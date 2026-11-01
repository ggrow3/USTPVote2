import { hashCanonical } from 'ustp-audit';
import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { PUBLIC_OFFICES, type PublicOffice } from './candidacy.js';
import type { AreaContact } from './contacts.js';

/**
 * The emails members send from the Your area page (design §5.12): one template per kind of office, written by
 * Communications Admins, with placeholders the page fills in for each person. The member edits it if they like and
 * sends it from their own email app, so the app sends nothing and keeps no copy.
 */

/** `{name}` the person written to, `{office}` their office's title, `{district}` where, `{asRole}` "as my …" or "as a candidate for …", `{myName}` the member. */
export const EMAIL_PLACEHOLDERS = ['name', 'office', 'district', 'asRole', 'myName'] as const;
export type EmailPlaceholder = (typeof EMAIL_PLACEHOLDERS)[number];

export const EMAIL_TEMPLATE_LIMITS = { subject: 200, body: 5000 } as const;

/** Why a template's text cannot be saved, if it cannot: a `{word}` that is not one of the placeholders. */
export function templateProblem(text: string): string | null {
  for (const [, word] of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!(EMAIL_PLACEHOLDERS as readonly string[]).includes(word!)) {
      return `{${word}} is not a placeholder; use ${EMAIL_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`;
    }
  }
  return null;
}

const templateText = (max: number, missing: string) =>
  z
    .string()
    .trim()
    .min(1, missing)
    .max(max, `at most ${max} characters`)
    .superRefine((v, ctx) => {
      const problem = templateProblem(v);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    });

/** `PUT /v1/admin/email-templates/{office}`: the template, and the version it was edited from (0 for the starting text). */
export const emailTemplateSchema = z.strictObject({
  subject: templateText(EMAIL_TEMPLATE_LIMITS.subject, 'enter a subject'),
  body: templateText(EMAIL_TEMPLATE_LIMITS.body, 'enter the email'),
  basedOn: z.number().int().min(0),
});
export type EmailTemplateInput = z.infer<typeof emailTemplateSchema>;

/** `email_templates/{office}` */
export interface EmailTemplateRecord {
  readonly office: PublicOffice;
  readonly subject: string;
  readonly body: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** A template as the page uses it; version 0 is the starting text, never saved. */
export interface EmailTemplate {
  readonly office: PublicOffice;
  readonly subject: string;
  readonly body: string;
  readonly version: number;
}

/** What each office's email asks about at its end: what they would do about it, and where. */
const WHERE: Readonly<Record<PublicOffice, string>> = {
  us_president: 'as President',
  us_senate: 'in Congress',
  us_house: 'in Congress',
  statewide: 'in state government',
  state_upper: 'in the legislature',
  state_lower: 'in the legislature',
  county: 'for our county',
  local: 'for our city or town',
};

const startingBody = (office: PublicOffice) => `Dear {name},

I live in {district}, and I am writing to you {asRole}.

I am a member of the United States Transhumanist Party. I care about using science and technology to extend healthy human life and to widen what people can do: funding for research on aging and age-related disease, open access to publicly funded science, and the freedom to choose new medical and technological options for ourselves.

Where do you stand on these issues, and what would you do about them ${WHERE[office]}?

Thank you for your time.

{myName}`;

/** The starting text of every template, until a Communications Admin saves their own. */
export const DEFAULT_EMAIL_TEMPLATES: Readonly<Record<PublicOffice, EmailTemplate>> = Object.fromEntries(
  PUBLIC_OFFICES.map((office) => [office, { office, subject: 'Where you stand on longevity research and science', body: startingBody(office), version: 0 }]),
) as Record<PublicOffice, EmailTemplate>;

/** Every office's template: the saved one, else the starting text. */
export function emailTemplates(saved: readonly EmailTemplateRecord[]): Record<PublicOffice, EmailTemplate> {
  return Object.fromEntries(
    PUBLIC_OFFICES.map((office) => {
      const record = saved.find((t) => t.office === office);
      return [office, record ? { office, subject: record.subject, body: record.body, version: record.version } : DEFAULT_EMAIL_TEMPLATES[office]];
    }),
  ) as Record<PublicOffice, EmailTemplate>;
}

/** `email_template.changed`, for Auditors: which template, its new version, and H(JCS({v: 1, subject, body})). */
export interface EmailTemplateChangedPayload {
  readonly office: PublicOffice;
  readonly version: number;
  readonly contentHash: string;
}

/** Saves a template from the version the admin edited; one that changes nothing is refused. */
export function saveEmailTemplate(
  current: EmailTemplateRecord | null,
  office: PublicOffice,
  input: EmailTemplateInput,
  actor: string,
  at: string,
): Outcome<{ record: EmailTemplateRecord; event: LedgerEvent }> {
  const shown = current ?? DEFAULT_EMAIL_TEMPLATES[office];
  if (input.basedOn !== shown.version) return refuse('conflict', 'someone changed this template since you opened it; reload to see their change');
  if (input.subject === shown.subject && input.body === shown.body) return refuse('conflict', 'nothing changed');
  const record: EmailTemplateRecord = { office, subject: input.subject, body: input.body, version: shown.version + 1, updatedAt: at, updatedBy: actor };
  const payload: EmailTemplateChangedPayload = { office, version: record.version, contentHash: hashCanonical({ v: 1, subject: record.subject, body: record.body }) };
  return { ok: true, value: { record, event: { type: 'email_template.changed', actor, subject: office, payload: { ...payload } } } };
}

/** The text with each placeholder filled in; anything else in braces is left as it is. */
export function fillTemplate(text: string, values: Readonly<Record<EmailPlaceholder, string>>): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (match, word: string) => ((EMAIL_PLACEHOLDERS as readonly string[]).includes(word) ? values[word as EmailPlaceholder] : match));
}

/** The placeholders' values for writing to a person: `where` is their district as the page names it. */
export function placeholderValues(contact: Pick<AreaContact, 'name' | 'officeTitle' | 'role'>, where: string, myName: string): Record<EmailPlaceholder, string> {
  return {
    name: contact.name,
    office: contact.officeTitle,
    district: where,
    asRole: contact.role === 'holder' ? `as my ${contact.officeTitle}` : `as a candidate for ${contact.officeTitle}`,
    myName,
  };
}
