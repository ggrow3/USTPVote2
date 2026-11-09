import { z } from 'zod';
import { NOTICE_KINDS, REMINDER_HOURS_BEFORE_CLOSE, type NoticeKind } from './notices.js';

/**
 * What System Admins decide about the election emails (design §6.8): whether each is sent, how long before the close
 * the reminder goes, where the emails tell members to ask questions, and each email's subject and opening paragraph.
 * The election's details fill themselves in; the From address stays in the deployment's configuration, since Amazon
 * SES must have verified it. The defaults are the emails as they were before these settings.
 */

/** What a subject or opening may name, in braces: the election's title, when voting closes, how long is left. */
export const NOTICE_PLACEHOLDERS = ['title', 'closes', 'time_left'] as const;
export type NoticePlaceholder = (typeof NOTICE_PLACEHOLDERS)[number];

/** The built-in wording, which a System Admin may replace. */
export const DEFAULT_NOTICE_TEXT: Readonly<Record<NoticeKind, { readonly subject: string; readonly intro: string }>> = {
  voting_open: {
    subject: 'Voting is open: {title}',
    intro: 'Voting is open in “{title}”, an election of the US Transhumanist Party, and you are on its voter roll.',
  },
  closing_soon: {
    subject: 'Voting closes soon: {title}',
    intro: 'You have not voted yet in “{title}”, an election of the US Transhumanist Party, and voting closes in {time_left}.',
  },
  voted: {
    subject: 'Your vote was recorded: {title}',
    intro: 'Your ballot in “{title}”, an election of the US Transhumanist Party, was recorded.',
  },
};

export const MAX_NOTICE_SUBJECT = 150;
export const MAX_NOTICE_INTRO = 1000;
export const MAX_NOTICE_CONTACT = 200;
/** The reminder goes between an hour and a week before the close. */
export const MIN_REMINDER_HOURS = 1;
export const MAX_REMINDER_HOURS = 168;

export interface NoticeKindSettings {
  readonly enabled: boolean;
  /** The subject line; null for the built-in one. */
  readonly subject: string | null;
  /** The paragraph after the greeting; null for the built-in one. */
  readonly intro: string | null;
}

/**
 * The site's other emails, each on or off (design §6.8). `welcome`: to members a Membership Admin added (§5.13); off,
 * the admin's browser sends Identity Platform's sign-in link instead. `electionTests`: "Send test email" on an election's
 * email card. `memberTests`: "Send me a test email" and "Try my address again" on the Account page (§10.12).
 * `notifications`: members' in-app notifications by email, as each comes or in a digest, for those who chose it (§10.13).
 * Switching one off stops new ones; one already queued still goes.
 */
export const OTHER_EMAILS = ['welcome', 'electionTests', 'memberTests', 'notifications'] as const;
export type OtherEmail = (typeof OTHER_EMAILS)[number];
export type OtherEmailSettings = Readonly<Record<OtherEmail, boolean>>;

export interface NoticeSettings {
  /**
   * The site's email as a whole (design §10.12), off until a System Admin switches it on. Off, the worker mails nobody:
   * what is due waits, and goes if it is switched on in time. Not affected: Identity Platform's emails, the setup check's
   * messages to Amazon's simulator, and a System Admin's test email to themselves, which is how they see that it works
   * before switching it on.
   */
  readonly allEmails: boolean;
  readonly kinds: Readonly<Record<NoticeKind, NoticeKindSettings>>;
  /** The site's other emails, each on or off. */
  readonly emails: OtherEmailSettings;
  /**
   * Whether each email an admin writes to members waits for a System Admin's approval before it goes (design §10.12);
   * off until a System Admin switches it on. Any System Admin may approve, the one who wrote it included.
   */
  readonly broadcastApproval: boolean;
  /** How long before voting closes the reminder goes. */
  readonly reminderHours: number;
  /** Where members ask about an election: an email address or an https page; null for the deployment's `NOTICE_CONTACT`. */
  readonly contact: string | null;
}

export const DEFAULT_NOTICE_SETTINGS: NoticeSettings = {
  allEmails: false,
  kinds: {
    voting_open: { enabled: true, subject: null, intro: null },
    closing_soon: { enabled: true, subject: null, intro: null },
    voted: { enabled: true, subject: null, intro: null },
  },
  emails: { welcome: true, electionTests: true, memberTests: true, notifications: true },
  broadcastApproval: false,
  reminderHours: REMINDER_HOURS_BEFORE_CLOSE,
  contact: null,
};

/** `notice_settings/current`; version 0 (never saved) is the defaults. */
export interface NoticeSettingsRecord extends NoticeSettings {
  /** Counts saves, so an edit made from an older copy is refused instead of undoing someone else's. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** The stored settings with anything missing taken from the defaults. */
export function resolveNoticeSettings(
  stored:
    | (Omit<Partial<NoticeSettings>, 'kinds' | 'emails'> & {
        readonly kinds?: Partial<NoticeSettings['kinds']>;
        readonly emails?: Partial<OtherEmailSettings>;
      })
    | undefined
    | null,
): NoticeSettings {
  const kinds = Object.fromEntries(
    NOTICE_KINDS.map((kind) => [kind, { ...DEFAULT_NOTICE_SETTINGS.kinds[kind], ...stored?.kinds?.[kind] }]),
  ) as Record<NoticeKind, NoticeKindSettings>;
  return {
    allEmails: stored?.allEmails ?? DEFAULT_NOTICE_SETTINGS.allEmails,
    kinds,
    emails: { ...DEFAULT_NOTICE_SETTINGS.emails, ...stored?.emails },
    broadcastApproval: stored?.broadcastApproval ?? DEFAULT_NOTICE_SETTINGS.broadcastApproval,
    reminderHours: stored?.reminderHours ?? DEFAULT_NOTICE_SETTINGS.reminderHours,
    contact: stored?.contact ?? DEFAULT_NOTICE_SETTINGS.contact,
  };
}

/** Placeholders that are not ones the emails fill in, and braces that open nothing; empty when the text is fine. */
export function noticeTemplateProblems(text: string): string[] {
  const problems: string[] = [];
  for (const [, name] of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!(NOTICE_PLACEHOLDERS as readonly string[]).includes(name!)) {
      problems.push(`{${name}} is not something the email fills in; use ${NOTICE_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`);
    }
  }
  if (/[{}]/.test(text.replace(/\{[^{}]*\}/g, ''))) problems.push('a brace has no partner');
  return problems;
}

/** The text with each placeholder replaced by its value. */
export function fillNoticeText(template: string, values: Readonly<Record<NoticePlaceholder, string>>): string {
  return template.replace(/\{(title|closes|time_left)\}/g, (_, name: NoticePlaceholder) => values[name]);
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const HTTPS_PAGE = /^https:\/\/[^\s<>"]+$/;

const template = (max: number, oneLine: boolean) =>
  z
    .string()
    .trim()
    .min(1, 'write something, or use the built-in wording')
    .max(max)
    .refine((t) => !oneLine || !/[\r\n]/.test(t), 'a subject is one line')
    .superRefine((t, ctx) => {
      for (const message of noticeTemplateProblems(t)) ctx.addIssue({ code: 'custom', message });
    });

const kindSettings = z.strictObject({
  enabled: z.boolean(),
  subject: template(MAX_NOTICE_SUBJECT, true).nullable(),
  intro: template(MAX_NOTICE_INTRO, false).nullable(),
});

/** `PUT /v1/admin/notice-settings`: the whole settings, and the version they were edited from. */
export const noticeSettingsSchema = z.strictObject({
  basedOn: z.number().int().min(0),
  // The whole site's switch came later too: a page opened before it keeps what was set.
  allEmails: z.boolean().optional(),
  // Vote confirmations came later: a page opened before them saves without them, and keeps what was set.
  kinds: z.strictObject({ voting_open: kindSettings, closing_soon: kindSettings, voted: kindSettings.optional() }),
  // Likewise the other emails' switches: a page opened before them keeps what was set.
  emails: z.strictObject({ welcome: z.boolean(), electionTests: z.boolean(), memberTests: z.boolean(), notifications: z.boolean().optional() }).optional(),
  // Approval of emails to members came later too: a page opened before it keeps what was set.
  broadcastApproval: z.boolean().optional(),
  reminderHours: z.number().int().min(MIN_REMINDER_HOURS).max(MAX_REMINDER_HOURS),
  contact: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NOTICE_CONTACT)
    .refine((c) => EMAIL.test(c) || HTTPS_PAGE.test(c), 'an email address, or a page starting with https://')
    .nullable(),
});
export type NoticeSettingsInput = z.infer<typeof noticeSettingsSchema>;

/** One setting that changed: its path (`allEmails`, `closing_soon.enabled`, `emails.welcome`, `reminderHours`, `contact`) and its old and new value. */
export interface NoticeSettingsChange {
  readonly field: string;
  readonly from: string | number | boolean | null;
  readonly to: string | number | boolean | null;
}

/** `notice.settings_changed`: the settings' new version and every setting that changed in it. */
export interface NoticeSettingsChangedPayload {
  readonly version: number;
  readonly changes: readonly NoticeSettingsChange[];
}

export function noticeSettingsChanges(before: NoticeSettings, after: NoticeSettings): NoticeSettingsChange[] {
  const changes: NoticeSettingsChange[] = [];
  if (before.allEmails !== after.allEmails) changes.push({ field: 'allEmails', from: before.allEmails, to: after.allEmails });
  for (const kind of NOTICE_KINDS) {
    for (const key of ['enabled', 'subject', 'intro'] as const) {
      const from = before.kinds[kind][key];
      const to = after.kinds[kind][key];
      if (from !== to) changes.push({ field: `${kind}.${key}`, from, to });
    }
  }
  for (const key of OTHER_EMAILS) {
    if (before.emails[key] !== after.emails[key]) changes.push({ field: `emails.${key}`, from: before.emails[key], to: after.emails[key] });
  }
  if (before.broadcastApproval !== after.broadcastApproval) {
    changes.push({ field: 'broadcastApproval', from: before.broadcastApproval, to: after.broadcastApproval });
  }
  if (before.reminderHours !== after.reminderHours) changes.push({ field: 'reminderHours', from: before.reminderHours, to: after.reminderHours });
  if (before.contact !== after.contact) changes.push({ field: 'contact', from: before.contact, to: after.contact });
  return changes;
}
