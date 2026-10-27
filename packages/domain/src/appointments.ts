import { z } from 'zod';
import { deny, OK, refuse, type Check, type Outcome } from './check.js';
import type { LedgerEvent } from './ledger-events.js';
import type { MemberRecord } from './membership/records.js';
import { addMonths, type AppointedTermRecord, type PositionRecord, type PositionTermRecord } from './positions.js';

/**
 * Appointing a member to an office without an election (design §6.4): for an office no election has filled yet, or
 * between elections. It is the two-person `position.appoint` action: a Membership or Election Admin asks, an Auditor
 * approves, and the same rules run at the request (`planAppointment`) and again at the approval (`appointTerm`).
 */

const isoDateTime = z.iso.datetime({ offset: true, message: 'expected an ISO 8601 date-time' });

/** `POST /v1/admin/positions/{id}/appointments`. */
export const appointmentInputSchema = z
  .strictObject({
    accountId: z.string().trim().min(1, 'choose a member').max(128),
    /** Omitted: the term starts when the appointment is approved. Otherwise an earlier date, for someone serving. */
    startsAt: isoDateTime.optional(),
    /** At most one of `endsAt` and `termMonths`; neither is the office's full term. */
    endsAt: isoDateTime.optional(),
    termMonths: z.number().int().min(1, 'at least one month').max(120).optional(),
    reason: z.string().trim().min(1, 'a written reason is required').max(2000),
  })
  .refine((input) => input.endsAt === undefined || input.termMonths === undefined, {
    message: 'give an end date or a number of months, not both',
    path: ['termMonths'],
  });
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;

/** What an Auditor approves (`position.appoint`); the request's subject is `accountId`. */
export interface AppointPayload {
  readonly positionId: string;
  readonly accountId: string;
  /** The member's legal name when the appointment was requested; the term carries it. */
  readonly holderName: string;
  /** Null: the term starts when the appointment is approved. */
  readonly startsAt: string | null;
  /** Exactly one of `endsAt` and `termMonths` is set. */
  readonly endsAt: string | null;
  readonly termMonths: number | null;
}

/** What the rules read, in the request's or the decision's transaction. */
export interface AppointmentContext {
  readonly office: Pick<PositionRecord, 'positionId' | 'title' | 'seats' | 'termMonths'> | null;
  /** The appointee's member record, if they have one. */
  readonly member: Pick<MemberRecord, 'status' | 'legalName'> | null;
  /** The office's terms; only active ones hold a seat. */
  readonly terms: readonly Pick<PositionTermRecord, 'accountId' | 'status'>[];
}

/** The term's dates once the time it takes effect is known: from approval (or the earlier date), for its length. */
export function appointmentDates(
  payload: Pick<AppointPayload, 'startsAt' | 'endsAt' | 'termMonths'>,
  approvedAt: string,
): { readonly startsAt: string; readonly endsAt: string } {
  const startsAt = payload.startsAt ?? approvedAt;
  return { startsAt, endsAt: payload.endsAt ?? addMonths(startsAt, payload.termMonths ?? 0) };
}

/** How many of the office's seats nobody holds. A term holds its seat until it is ended, whatever its end date. */
export function freeSeats(office: Pick<PositionRecord, 'seats'>, terms: AppointmentContext['terms']): number {
  return Math.max(0, office.seats - terms.filter((t) => t.status === 'active').length);
}

/**
 * Whether this appointment can take effect at `now` (design §6.4): the office exists, the member is Active and does not
 * hold it already, a seat is free (a sitting holder is never displaced), and the term starts no later than now, ends
 * after now, and lasts no longer than the office's term.
 */
export function checkAppointment(payload: AppointPayload, context: AppointmentContext, now: string): Check {
  const { office, member, terms } = context;
  if (!office) return refuse('not_found', `there is no office ${payload.positionId}`);
  if (member?.status !== 'active') return deny(`only an Active member can be appointed, and ${payload.holderName} is not one`);
  if (terms.some((t) => t.status === 'active' && t.accountId === payload.accountId)) {
    return deny(`${payload.holderName} already holds the office of ${office.title}`);
  }
  if (freeSeats(office, terms) === 0) {
    const seats = office.seats === 1 ? 'its one seat is' : `all ${office.seats} of its seats are`;
    return deny(`${office.title} has no free seat (${seats} held): end a term first, then appoint`);
  }
  if (payload.termMonths !== null && payload.termMonths > office.termMonths) {
    return deny(`a term of ${office.title} lasts at most ${office.termMonths} months`);
  }
  const at = Date.parse(now);
  if (payload.startsAt !== null && Date.parse(payload.startsAt) > at) {
    return deny('an appointment takes effect when it is approved, so it cannot start later; leave the start date out');
  }
  const { startsAt, endsAt } = appointmentDates(payload, now);
  if (payload.startsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) return deny('the term must end after it starts');
  if (Date.parse(endsAt) <= at) return deny('the term would already be over');
  const longest = addMonths(startsAt, office.termMonths);
  if (Date.parse(endsAt) > Date.parse(longest)) {
    return deny(`a term of ${office.title} lasts at most ${office.termMonths} months, so this one must end by ${longest.slice(0, 10)}`);
  }
  return OK;
}

/** At the request: the payload to approve, with the member's name, or why it cannot be asked for. */
export function planAppointment(
  positionId: string,
  input: Omit<AppointmentInput, 'reason'>,
  context: AppointmentContext,
  now: string,
): Outcome<AppointPayload> {
  const endsAt = input.endsAt === undefined ? null : new Date(input.endsAt).toISOString();
  const payload: AppointPayload = {
    positionId,
    accountId: input.accountId,
    holderName: context.member?.legalName ?? input.accountId,
    startsAt: input.startsAt === undefined ? null : new Date(input.startsAt).toISOString(),
    endsAt,
    termMonths: endsAt === null ? (input.termMonths ?? context.office?.termMonths ?? 0) : null,
  };
  const check = checkAppointment(payload, context, now);
  return check.ok ? { ok: true, value: payload } : check;
}

/** At the approval: the new term and its public ledger entry, or why the appointment can no longer take effect. */
export function appointTerm(
  payload: AppointPayload,
  context: AppointmentContext,
  approval: { readonly termId: string; readonly approvalId: string; readonly reason: string; readonly approvedBy: string },
  now: string,
): Outcome<{ readonly term: AppointedTermRecord; readonly event: LedgerEvent }> {
  const check = checkAppointment(payload, context, now);
  if (!check.ok) return check;
  const { startsAt, endsAt } = appointmentDates(payload, now);
  const term: AppointedTermRecord = {
    termId: approval.termId,
    basis: 'appointment',
    positionId: payload.positionId,
    holderName: payload.holderName,
    accountId: payload.accountId,
    startsAt,
    endsAt,
    status: 'active',
    endedAt: null,
    endReason: null,
    approvalId: approval.approvalId,
    reason: approval.reason,
  };
  const event: LedgerEvent = {
    type: 'position_term.appointed',
    actor: approval.approvedBy,
    subject: payload.positionId,
    payload: {
      termId: term.termId,
      positionId: term.positionId,
      holderName: term.holderName,
      accountId: term.accountId,
      startsAt,
      endsAt,
      reason: term.reason,
      approvalId: term.approvalId,
    },
  };
  return { ok: true, value: { term, event } };
}
