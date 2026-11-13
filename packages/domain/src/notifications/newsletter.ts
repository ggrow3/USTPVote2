import { z } from 'zod';
import { OK, refuse, type Check } from '../check.js';

/**
 * The newsletter (design §10.15, the party's decisions of 2026-11-12): people not ready to join leave their email address
 * on a public form, confirm it from the email that follows (double opt-in), and are then a list of their own that
 * Membership, System and Site Admins can write to from Admin › Email, alone or with the members. Nobody is on the list
 * until they confirm; a sign-up never confirmed is deleted after `NEWSLETTER_PENDING_DAYS`, and an address is deleted
 * the moment its owner unsubscribes. Subscribers get nothing but those emails. Nothing here is ledgered: the ledger
 * cannot be erased, and an address must be.
 */

/** The sign-up page; its confirmation page, whose link carries the token in the query, since page visits record the path (§10.7). */
export const NEWSLETTER_PATH = '/newsletter';
export const NEWSLETTER_CONFIRM_PATH = '/newsletter/confirm';

/** A sign-up never confirmed is deleted this long after it was made (a Firestore TTL policy on `expireAt`). */
export const NEWSLETTER_PENDING_DAYS = 7;
/** Signing up again sends another confirmation only once this long has passed since the last was asked for. */
export const NEWSLETTER_RESEND_MINUTES = 60;
/** The most sign-ups taken in a UTC day from one network address (counted under a salted hash), and from everyone. */
export const NEWSLETTER_SIGNUPS_PER_SENDER_PER_DAY = 5;
export const NEWSLETTER_SIGNUPS_PER_DAY = 500;
/** A confirmation the mail service could not take is tried again this many times in all. */
export const NEWSLETTER_CONFIRM_ATTEMPTS = 3;

export const NEWSLETTER_LIMITS = { email: 254, name: 100 } as const;

/** `POST /v1/public/newsletter`: an address, an optional name to greet them by, and the trap field people leave empty. */
export const newsletterSignupSchema = z.strictObject({
  email: z.string().trim().max(NEWSLETTER_LIMITS.email).pipe(z.email('enter your email address')),
  name: z
    .string()
    .trim()
    .max(NEWSLETTER_LIMITS.name)
    .refine((s) => !/[\r\n]/.test(s), 'a name is one line')
    .default(''),
  /** Left empty by people; a form filler that fills every field fills this too, and the sign-up is dropped. */
  website: z.string().max(500).default(''),
});
export type NewsletterSignupInput = z.infer<typeof newsletterSignupSchema>;

/** `DELETE /v1/admin/newsletter/subscribers` and the lookup: one address, whole. */
export const newsletterAddressSchema = z.strictObject({ email: z.string().trim().max(NEWSLETTER_LIMITS.email).pipe(z.email('enter an email address')) });
export type NewsletterAddressInput = z.infer<typeof newsletterAddressSchema>;

export type NewsletterStatus = 'pending' | 'confirmed';

/**
 * `newsletter_subscribers/{subscriberId}` (a UUIDv7): one address on the list, or waiting to be confirmed. Clients never
 * read it. The confirmation link's token is made by the worker as it sends the email and kept only as a hash; the
 * unsubscribe link's token, which every newsletter carries, is kept as it is, as a member's is (§10.12).
 */
export interface NewsletterSubscriberRecord {
  readonly subscriberId: string;
  /** Lower case, as given. */
  readonly email: string;
  /** `mailAddressKey(email)`: one record an address. */
  readonly addressKey: string;
  /** To greet them by; null when none was given. */
  readonly name: string | null;
  readonly status: NewsletterStatus;
  readonly signedUpAt: string;
  readonly confirmedAt: string | null;
  /** When a confirmation email was last asked for, by signing up (again). */
  readonly confirmRequestedAt: string;
  /** A confirmation email waits for the worker. */
  readonly confirmDue: boolean;
  /** How many times the worker tried to send the confirmation asked for last. */
  readonly confirmAttempts: number;
  readonly confirmSentAt: string | null;
  /** SHA-256 (hex) of the token in the latest confirmation link; null before one went. */
  readonly confirmTokenHash: string | null;
  /** The unsubscribe link's token, made when they confirm; null before. */
  readonly unsubscribeToken: string | null;
}

/** What signing up does to the address's record, if anything. Signing up never says whether an address is on the list. */
export type NewsletterSignupStep =
  | { readonly kind: 'create'; readonly record: NewsletterSubscriberRecord }
  | { readonly kind: 'resend'; readonly record: NewsletterSubscriberRecord }
  | { readonly kind: 'none' };

/**
 * Signing up `email`: a new record waiting for confirmation, with a confirmation email due; for one already waiting, another
 * email once `NEWSLETTER_RESEND_MINUTES` have passed (and the 7 days start again); for a confirmed address, nothing, so
 * the form cannot be used to send someone email they did not ask for, nor to learn who is on the list.
 */
export function newsletterSignup(args: {
  readonly current: NewsletterSubscriberRecord | null;
  readonly input: NewsletterSignupInput;
  readonly subscriberId: string;
  readonly addressKey: string;
  readonly at: Date;
}): NewsletterSignupStep {
  const { current, input, at } = args;
  const now = at.toISOString();
  const name = input.name || null;
  if (!current) {
    return {
      kind: 'create',
      record: {
        subscriberId: args.subscriberId,
        email: input.email.toLowerCase(),
        addressKey: args.addressKey,
        name,
        status: 'pending',
        signedUpAt: now,
        confirmedAt: null,
        confirmRequestedAt: now,
        confirmDue: true,
        confirmAttempts: 0,
        confirmSentAt: null,
        confirmTokenHash: null,
        unsubscribeToken: null,
      },
    };
  }
  if (current.status === 'confirmed') return { kind: 'none' };
  if (at.getTime() - Date.parse(current.confirmRequestedAt) < NEWSLETTER_RESEND_MINUTES * 60_000) return { kind: 'none' };
  return { kind: 'resend', record: { ...current, name: name ?? current.name, confirmRequestedAt: now, confirmDue: true, confirmAttempts: 0 } };
}

/** When a record waiting for confirmation is deleted, from when it was (last) asked for. */
export function newsletterExpiry(record: Pick<NewsletterSubscriberRecord, 'confirmRequestedAt'>): Date {
  return new Date(Date.parse(record.confirmRequestedAt) + NEWSLETTER_PENDING_DAYS * 86_400_000);
}

/** Whether what was sent is a person's (the trap field is empty) or a form filler's, which is dropped without a word. */
export const isNewsletterTrapped = (input: Pick<NewsletterSignupInput, 'website'>) => input.website.trim() !== '';

/** `newsletter_limits/{YYYY-MM-DD}`: that day's salt and counts, deleted the day after next, as the suggestions form's. */
export interface NewsletterLimitsRecord {
  readonly day: string;
  /** Random, hex: senders' network addresses are counted under SHA-256(salt + address), and the salt goes with the day. */
  readonly salt: string;
  readonly total: number;
  readonly senders: Readonly<Record<string, number>>;
}

/** Whether one more sign-up from this sender fits today's limits. */
export function checkNewsletterLimits(day: Pick<NewsletterLimitsRecord, 'total' | 'senders'> | null, sender: string): Check {
  if (!day) return OK;
  if (day.total >= NEWSLETTER_SIGNUPS_PER_DAY) return refuse('rate_limited', 'we have had a great many sign-ups today; please try again tomorrow');
  if ((day.senders[sender] ?? 0) >= NEWSLETTER_SIGNUPS_PER_SENDER_PER_DAY) {
    return refuse('rate_limited', 'that is as many sign-ups as we take from you in a day; please try again tomorrow');
  }
  return OK;
}

/** Links to the confirmation page and to a newsletter's unsubscribe page and one-click address. */
export function newsletterConfirmLink(origin: string, token: string): string {
  return `${origin}${NEWSLETTER_CONFIRM_PATH}?token=${encodeURIComponent(token)}`;
}

/** `GET /v1/public/newsletter`: whether the form takes sign-ups now (the site sends email, all of it is on, a contact is set). */
export interface NewsletterOpen {
  readonly open: boolean;
}

/** `GET /v1/public/newsletter/confirm/{token}` and its POST: all a confirmation link's holder learns. */
export interface NewsletterConfirmStatus {
  readonly confirmed: boolean;
}

/** `GET /v1/admin/newsletter`: how many are on the list, for Membership, System and Site Admins. */
export interface NewsletterSummary {
  readonly confirmed: number;
  /** Signed up and not confirmed yet; deleted after `NEWSLETTER_PENDING_DAYS`. */
  readonly pending: number;
  /** Confirmed in the last 30 days. */
  readonly confirmedLast30Days: number;
}

/** `POST /v1/admin/newsletter/lookup`: one address, if it is on the list or waiting. Never a list. */
export interface NewsletterLookup {
  readonly found: boolean;
  readonly status: NewsletterStatus | null;
  readonly signedUpAt: string | null;
  readonly confirmedAt: string | null;
}
