import {
  addMonths,
  appointmentDates,
  freeSeats,
  isAppointed,
  type ApprovalRequestRecord,
  type AppointmentInput,
  type AppointPayload,
  type MemberMatch,
  type PositionModifyPayload,
  type PositionRecord,
  type PositionTermRecord,
} from 'ustp-domain';

/** Wording for offices, terms and appointments (design §6.4), shared by the Offices tab, the profile and the public page. */

/** A date as the reader writes it, e.g. "Oct 27, 2026". */
export const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** "1 seat · 24-month terms". */
export function officeShape(office: Pick<PositionRecord, 'seats' | 'termMonths'>): string {
  return `${office.seats} ${office.seats === 1 ? 'seat' : 'seats'} · ${office.termMonths}-month terms`;
}

/** "1 free seat", "No free seat". */
export function seatsLine(office: Pick<PositionRecord, 'seats'>, terms: readonly PositionTermRecord[]): string {
  const free = freeSeats(office, terms);
  return free === 0 ? 'No free seat' : `${free} free ${free === 1 ? 'seat' : 'seats'}`;
}

/** How the holder came to hold the office. */
export const termBasis = (term: PositionTermRecord): 'Appointed' | 'Elected' => (isAppointed(term) ? 'Appointed' : 'Elected');

/** "Mar 1, 2025 – Mar 1, 2027", or when it ended early. */
export function termDates(term: PositionTermRecord): string {
  if (term.status === 'ended' && term.endedAt) return `${day(term.startsAt)} – ${day(term.endedAt)} (ended early: ${term.endReason})`;
  return `${day(term.startsAt)} – ${day(term.endsAt)}`;
}

/** Where the term comes from: the appointment's reason, or the certified results. */
export function termSource(term: PositionTermRecord): string {
  return isAppointed(term) ? `Appointed with an Auditor’s approval: ${term.reason}` : `Elected: certified results ${term.resultsHash.slice(0, 12)}…`;
}

/** The term an appointment asks for, in words: "from when an Auditor approves, for 24 months". */
export function appointmentTerm(payload: Pick<AppointPayload, 'startsAt' | 'endsAt' | 'termMonths'>): string {
  const from = payload.startsAt ? `from ${day(payload.startsAt)}` : 'from when an Auditor approves';
  if (payload.endsAt) return `${from} until ${day(payload.endsAt)}`;
  const months = payload.termMonths ?? 0;
  return `${from}, for ${months} ${months === 1 ? 'month' : 'months'}`;
}

/** The dates the term would have if it were approved at `now`, for the dialog to show before sending. */
export function appointmentPreview(payload: Pick<AppointPayload, 'startsAt' | 'endsAt' | 'termMonths'>, now: string): string {
  const { startsAt, endsAt } = appointmentDates(payload, now);
  return `${day(startsAt)} – ${day(endsAt)}`;
}

/** A request about an office, as its card lists it while it waits for an Auditor. */
export function pendingLine(request: ApprovalRequestRecord, terms: readonly PositionTermRecord[]): string {
  if (request.action === 'position.appoint') {
    const p = request.payload as unknown as AppointPayload;
    return `Appoint ${p.holderName}, ${appointmentTerm(p)}`;
  }
  const p = request.payload as unknown as PositionModifyPayload;
  if (p.change === 'end_term') {
    const holder = terms.find((t) => t.termId === p.termId)?.holderName;
    return holder ? `End the term of ${holder}` : 'End a term';
  }
  return 'Change the office';
}

/** The office a request about offices is for. */
export function requestOffice(request: ApprovalRequestRecord): string | null {
  const p = request.payload as { positionId?: unknown; position?: { positionId?: unknown } };
  const id = p.positionId ?? p.position?.positionId;
  return typeof id === 'string' ? id : null;
}

/** The line under a member in the search, so two people with one name can be told apart. */
export function memberCaption(match: MemberMatch): string {
  const known = match.preferredName && match.preferredName !== match.legalName ? `Known as ${match.preferredName}` : null;
  return [known, match.state || null].filter(Boolean).join(' · ');
}

/** The dialog's choices: when the term starts and how it ends. */
export interface AppointmentForm {
  start: 'approval' | 'date';
  /** `YYYY-MM-DD`, when `start` is `date`. */
  startDate: string;
  end: 'full' | 'months' | 'date';
  months: number | null;
  /** `YYYY-MM-DD`, when `end` is `date`. */
  endDate: string;
  reason: string;
}

export const emptyAppointmentForm = (): AppointmentForm => ({ start: 'approval', startDate: '', end: 'full', months: null, endDate: '', reason: '' });

/** The start of a calendar day in the reader's time zone, as an instant; empty input stays empty. */
export function dayStart(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const at = new Date(`${date}T00:00:00`);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** Today as a date input's value, in the reader's time zone. */
export function todayInput(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The last day an office's term allows the appointment to end, as a date input's value. */
export function latestEndInput(startsAt: string, termMonths: number): string {
  return todayInput(new Date(addMonths(startsAt, termMonths)));
}

/** The request body the form gives, for `appointmentInputSchema` to check. */
export function appointmentInput(accountId: string, form: AppointmentForm): AppointmentInput {
  return {
    accountId,
    ...(form.start === 'date' && { startsAt: dayStart(form.startDate) ?? form.startDate }),
    ...(form.end === 'date' && { endsAt: dayStart(form.endDate) ?? form.endDate }),
    ...(form.end === 'months' && { termMonths: form.months ?? Number.NaN }),
    reason: form.reason,
  };
}
