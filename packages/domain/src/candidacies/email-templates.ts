import { hashCanonical } from 'ustp-audit';
import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import type { LedgerEvent } from '../ledger-events.js';
import { PUBLIC_OFFICES, type PublicOffice } from './candidacy.js';
import type { AreaContact } from './contacts.js';

/**
 * The emails members send from the Your area page (design §5.12): a list of templates that Membership Admins and
 * Communications Admins keep, each with a name, the people it suits (every office or some, in office, running or
 * either), a subject and a body with placeholders the page fills in for each person. In the Write dialog the member
 * picks one of those that suit the person from a list, edits it if they like and sends it from their own email app, so
 * the app sends nothing and keeps no copy. The same list holds the call scripts of the Representatives page (design
 * §5.19): a template whose channel is `call` has no subject, and is what a member reads out on the phone.
 */

/** What a template is for: an email the member sends, or a script they read out on a phone call. */
export const TEMPLATE_CHANNELS = ['email', 'call'] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

/** `{name}` the person written to, `{office}` their office's title, `{district}` where, `{asRole}` "as my …" or "as a candidate for …", `{myName}` the member. */
export const EMAIL_PLACEHOLDERS = ['name', 'office', 'district', 'asRole', 'myName'] as const;
export type EmailPlaceholder = (typeof EMAIL_PLACEHOLDERS)[number];

/** `templates`: how many the list holds at most. */
export const EMAIL_TEMPLATE_LIMITS = { name: 80, subject: 200, body: 5000, templates: 50 } as const;

/** Who a template is for: anyone listed, only people in office, or only people running. */
export const TEMPLATE_AUDIENCES = ['anyone', 'holder', 'candidate'] as const;
export type TemplateAudience = (typeof TEMPLATE_AUDIENCES)[number];

/** Why a template's text cannot be saved, if it cannot: a `{word}` that is not one of the placeholders. */
export function templateProblem(text: string): string | null {
  for (const [, word] of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!(EMAIL_PLACEHOLDERS as readonly string[]).includes(word!)) {
      return `{${word}} is not a placeholder; use ${EMAIL_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`;
    }
  }
  return null;
}

const oneLine = (v: string) => !/[\r\n]/.test(v);

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

/** `POST /v1/admin/email-templates`, and the template of a change. No offices is every office; they are kept in the offices' order. */
export const emailTemplateInputSchema = z
  .strictObject({
    channel: z.enum(TEMPLATE_CHANNELS).default('email'),
    name: z.string().trim().min(1, 'name the template').max(EMAIL_TEMPLATE_LIMITS.name).refine(oneLine, 'a name is one line'),
    offices: z
      .array(z.enum(PUBLIC_OFFICES))
      .max(PUBLIC_OFFICES.length)
      .default([])
      .transform((chosen) => PUBLIC_OFFICES.filter((o) => chosen.includes(o))),
    audience: z.enum(TEMPLATE_AUDIENCES).default('anyone'),
    /** An email's subject; a call script has none. */
    subject: z
      .string()
      .trim()
      .max(EMAIL_TEMPLATE_LIMITS.subject, `at most ${EMAIL_TEMPLATE_LIMITS.subject} characters`)
      .refine(oneLine, 'a subject is one line')
      .superRefine((v, ctx) => {
        const problem = templateProblem(v);
        if (problem) ctx.addIssue({ code: 'custom', message: problem });
      })
      .default(''),
    body: templateText(EMAIL_TEMPLATE_LIMITS.body, 'enter the text'),
  })
  .superRefine((v, ctx) => {
    if (v.channel === 'email' && !v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'enter a subject' });
    if (v.channel === 'call' && v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'a call script has no subject' });
  });
export type EmailTemplateInput = z.infer<typeof emailTemplateInputSchema>;

/** `PUT /v1/admin/email-templates/{templateId}`: the whole template again, and its version it was edited from (0 for a starting one). */
export const emailTemplateChangeSchema = z.strictObject({ template: emailTemplateInputSchema, basedOn: z.number().int().min(0) });
export type EmailTemplateChangeInput = z.infer<typeof emailTemplateChangeSchema>;

/** One template, as the admins keep it and the page uses it. */
export interface EmailTemplate extends EmailTemplateInput {
  readonly templateId: string;
  /** Counts this template's saves, so an edit made from an older copy is refused; 0 for a starting one never changed. */
  readonly version: number;
}

/** `email_templates/current`: the list, in the order the Write dialog offers it; absent until an admin first changes it. */
export interface EmailTemplateListRecord {
  readonly templates: readonly EmailTemplate[];
  /** Whether the saved list holds the call scripts too: absent on a list saved before they existed (design §5.19). */
  readonly callScripts?: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

const introduction = 'Dear {name},\n\nI live in {district}, and I am writing to you {asRole}.';

/** The list until an admin first changes it: a question for anyone, a meeting for people in office, questions for people running. */
export const STARTING_EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  {
    templateId: 'starting-stance',
    channel: 'email',
    name: 'Where they stand on longevity and science',
    offices: [],
    audience: 'anyone',
    subject: 'Where you stand on longevity research and science',
    body: `${introduction}

I am a member of the United States Transhumanist Party. I care about using science and technology to extend healthy human life and to widen what people can do: funding for research on aging and age-related disease, open access to publicly funded science, and the freedom to choose new medical and technological options for ourselves.

Where do you stand on these issues, and what would you do about them in office?

Thank you for your time.

{myName}`,
    version: 0,
  },
  {
    templateId: 'starting-meeting',
    channel: 'email',
    name: 'Ask for a meeting',
    offices: [],
    audience: 'holder',
    subject: 'A request to meet about research on aging',
    body: `${introduction}

I am a member of the United States Transhumanist Party, and I would like to meet you or a member of your staff, in person or by video call, to talk about research on aging and age-related disease and about open access to publicly funded science.

Could your office let me know when that might be possible?

Thank you for your time.

{myName}`,
    version: 0,
  },
  {
    templateId: 'starting-questions',
    channel: 'email',
    name: 'Questions for a candidate',
    offices: [],
    audience: 'candidate',
    subject: 'Questions from a voter in {district}',
    body: `${introduction}

I am a member of the United States Transhumanist Party, and before I decide how to vote I would like to know where you stand:

1. Would you support more public funding for research on aging and age-related disease?
2. Should the results of publicly funded science be free for everyone to read?
3. Should people be free to choose new medical and technological options for themselves?

Thank you, and good luck with your campaign.

{myName}`,
    version: 0,
  },
];

/**
 * The call scripts until an admin first saves the list with them in it: what to say to a representative's office, in
 * under a minute. Offices' staff tally calls by subject and by whether the caller lives in the district.
 */
export const STARTING_CALL_SCRIPTS: readonly EmailTemplate[] = [
  {
    templateId: 'starting-call-research',
    channel: 'call',
    name: 'Call to support research on aging',
    offices: [],
    audience: 'holder',
    subject: '',
    body: `Hello, my name is {myName}. I live in {district}, and I am calling {name} {asRole}.

I support the United States Transhumanist Party, and I am calling to ask {name} to support more public funding for research on aging and age-related disease, and open access to publicly funded science.

Could you tell me where {name} stands on this?

Thank you for your time.`,
    version: 0,
  },
  {
    templateId: 'starting-call-meeting',
    channel: 'call',
    name: 'Call to ask for a meeting',
    offices: [],
    audience: 'holder',
    subject: '',
    body: `Hello, my name is {myName}. I live in {district}, and I am calling {name} {asRole}.

I support the United States Transhumanist Party, and I would like to meet {name} or a member of staff, in person or by video call, to talk about research on aging and open access to publicly funded science.

Who should I ask, and when might that be possible?

Thank you for your time.`,
    version: 0,
  },
];

/**
 * The list: the saved one, else the starting templates. A list saved before call scripts existed (its templates have
 * no channel, so they are emails) gains the starting call scripts, until an admin's next change saves it with them.
 */
export function emailTemplateList(saved: EmailTemplateListRecord | null): readonly EmailTemplate[] {
  if (!saved) return [...STARTING_EMAIL_TEMPLATES, ...STARTING_CALL_SCRIPTS];
  const templates = saved.templates.map((t) => ({ ...t, channel: t.channel ?? 'email' }));
  return saved.callScripts ? templates : [...templates, ...STARTING_CALL_SCRIPTS];
}

/** Whether a template suits a person: one of its offices (or every office), and their role (or anyone). */
export function suitsContact(template: Pick<EmailTemplate, 'offices' | 'audience'>, contact: Pick<AreaContact, 'office' | 'role'>): boolean {
  return (!template.offices.length || template.offices.includes(contact.office)) && (template.audience === 'anyone' || template.audience === contact.role);
}

/** The templates the Write dialog (or, for `call`, the Call dialog) offers for a person, in the list's order. */
export function templatesFor(templates: readonly EmailTemplate[], contact: Pick<AreaContact, 'office' | 'role'>, channel: TemplateChannel = 'email'): EmailTemplate[] {
  return templates.filter((t) => t.channel === channel && suitsContact(t, contact));
}

/** `email_template.changed`, for Auditors: which template, what happened to it, and H(JCS({v: 1, ...template})) of what was saved. */
export interface EmailTemplateChangedPayload {
  readonly templateId: string;
  readonly change: 'added' | 'changed' | 'removed';
  readonly name: string;
  readonly version: number;
  /** Null for a removal. */
  readonly contentHash: string | null;
}

/**
 * H(JCS({v: 1, name, offices, audience, subject, body})): which text was saved, as the ledger records it. A call
 * script's has `channel: 'call'` too; an email's is as it was before call scripts existed.
 */
export function emailTemplateHash(template: EmailTemplateInput): string {
  const { channel, name, offices, audience, subject, body } = template;
  return hashCanonical({ v: 1, ...(channel === 'call' ? { channel } : {}), name, offices, audience, subject, body });
}

type Saved = { record: EmailTemplateListRecord; template: EmailTemplate; event: LedgerEvent };

const sameName = (a: string, b: string) => a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US');

function saved(
  templates: readonly EmailTemplate[],
  template: EmailTemplate,
  change: EmailTemplateChangedPayload['change'],
  actor: string,
  at: string,
): Saved {
  const payload: EmailTemplateChangedPayload = {
    templateId: template.templateId,
    change,
    name: template.name,
    version: template.version,
    contentHash: change === 'removed' ? null : emailTemplateHash(template),
  };
  return {
    record: { templates, callScripts: true, updatedAt: at, updatedBy: actor },
    template,
    event: { type: 'email_template.changed', actor, subject: template.templateId, payload: { ...payload } },
  };
}

/** A new template, at the end of the list. Names are unique, so the list can tell them apart. */
export function addEmailTemplate(list: readonly EmailTemplate[], input: EmailTemplateInput, templateId: string, actor: string, at: string): Outcome<Saved> {
  if (list.length >= EMAIL_TEMPLATE_LIMITS.templates) {
    return refuse('conflict', `there can be at most ${EMAIL_TEMPLATE_LIMITS.templates} templates; remove one first`);
  }
  if (list.some((t) => sameName(t.name, input.name))) return refuse('conflict', 'a template already has that name');
  const template: EmailTemplate = { ...input, templateId, version: 1 };
  return { ok: true, value: saved([...list, template], template, 'added', actor, at) };
}

/** Changes a template from the version the admin edited; one that changes nothing is refused. */
export function changeEmailTemplate(
  list: readonly EmailTemplate[],
  templateId: string,
  input: EmailTemplateInput,
  basedOn: number,
  actor: string,
  at: string,
): Outcome<Saved> {
  const current = list.find((t) => t.templateId === templateId);
  if (!current) return refuse('not_found', 'no such template');
  if (basedOn !== current.version) return refuse('conflict', 'someone changed this template since you opened it; reload to see their change');
  if (emailTemplateHash(input) === emailTemplateHash(current)) return refuse('conflict', 'nothing changed');
  if (list.some((t) => t.templateId !== templateId && sameName(t.name, input.name))) return refuse('conflict', 'a template already has that name');
  const template: EmailTemplate = { ...input, templateId, version: current.version + 1 };
  return { ok: true, value: saved(list.map((t) => (t.templateId === templateId ? template : t)), template, 'changed', actor, at) };
}

/** Takes a template off the list; members are no longer offered it. */
export function removeEmailTemplate(list: readonly EmailTemplate[], templateId: string, actor: string, at: string): Outcome<Saved> {
  const current = list.find((t) => t.templateId === templateId);
  if (!current) return refuse('not_found', 'no such template');
  return { ok: true, value: saved(list.filter((t) => t.templateId !== templateId), current, 'removed', actor, at) };
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
