import { describe, expect, it } from 'vitest';
import type { ApprovalRequestRecord, PositionTermRecord } from 'ustp-domain';
import { describeRequest, reviewLink } from '../approval-text.js';
import {
  appointmentInput,
  appointmentTerm,
  day,
  dayStart,
  emptyAppointmentForm,
  memberCaption,
  pendingLine,
  requestOffice,
  seatsLine,
  termBasis,
  termDates,
  termSource,
  todayInput,
} from './office-text.js';

const elected = {
  termId: 't1',
  positionId: 'chair',
  electionId: 'e1',
  contestId: 'c1',
  candidateId: 'k1',
  holderName: 'Blair Chen',
  accountId: null,
  startsAt: '2026-01-10T12:00:00.000Z',
  endsAt: '2028-01-10T12:00:00.000Z',
  resultsHash: 'abcdef0123456789abcdef',
  status: 'active',
  endedAt: null,
  endReason: null,
} satisfies PositionTermRecord;
const appointed = {
  termId: 't2',
  basis: 'appointment',
  positionId: 'board',
  holderName: 'Ada Brooks',
  accountId: 'a1',
  startsAt: '2026-10-27T12:00:00.000Z',
  endsAt: '2027-10-27T12:00:00.000Z',
  status: 'active',
  endedAt: null,
  endReason: null,
  approvalId: 'r1',
  reason: 'Officers’ vote under art. 4.3',
} satisfies PositionTermRecord;

const request = (action: ApprovalRequestRecord['action'], payload: Record<string, unknown>, subject = 'a1') =>
  ({ id: 'r1', action, subject, payload, requestedAt: '2026-10-27T12:00:00.000Z' }) as unknown as ApprovalRequestRecord;

describe('office wording', () => {
  it('says how each holder came to hold the office, and from what', () => {
    expect(termBasis(elected)).toBe('Elected');
    expect(termBasis(appointed)).toBe('Appointed');
    expect(termSource(elected)).toBe('Elected: certified results abcdef012345…');
    expect(termSource(appointed)).toBe('Appointed with an Auditor’s approval: Officers’ vote under art. 4.3');
    expect(termDates(appointed)).toBe(`${day(appointed.startsAt)} – ${day(appointed.endsAt)}`);
    expect(termDates({ ...appointed, status: 'ended', endedAt: '2027-01-01T12:00:00.000Z', endReason: 'resigned' })).toBe(
      `${day(appointed.startsAt)} – ${day('2027-01-01T12:00:00.000Z')} (ended early: resigned)`,
    );
  });

  it('counts free seats', () => {
    expect(seatsLine({ seats: 1 }, [elected])).toBe('No free seat');
    expect(seatsLine({ seats: 3 }, [elected, { ...appointed, status: 'ended' }])).toBe('2 free seats');
    expect(seatsLine({ seats: 2 }, [elected])).toBe('1 free seat');
  });

  it('describes the term an appointment asks for', () => {
    expect(appointmentTerm({ startsAt: null, endsAt: null, termMonths: 24 })).toBe('from when an Auditor approves, for 24 months');
    expect(appointmentTerm({ startsAt: null, endsAt: null, termMonths: 1 })).toBe('from when an Auditor approves, for 1 month');
    expect(appointmentTerm({ startsAt: '2025-03-01T00:00:00.000Z', endsAt: '2027-03-01T00:00:00.000Z', termMonths: null })).toBe(
      `from ${day('2025-03-01T00:00:00.000Z')} until ${day('2027-03-01T00:00:00.000Z')}`,
    );
  });

  it('lists what waits for an Auditor, office by office', () => {
    const appoint = request('position.appoint', { positionId: 'board', accountId: 'a1', holderName: 'Ada Brooks', startsAt: null, endsAt: null, termMonths: 12 });
    const end = request('position.modify', { change: 'end_term', termId: 't1', positionId: 'chair' }, 't1');
    expect(pendingLine(appoint, [])).toBe('Appoint Ada Brooks, from when an Auditor approves, for 12 months');
    expect(pendingLine(end, [elected])).toBe('End the term of Blair Chen');
    expect(pendingLine(end, [])).toBe('End a term');
    expect([requestOffice(appoint), requestOffice(end)]).toEqual(['board', 'chair']);
    expect(requestOffice(request('position.modify', { change: 'define', position: { positionId: 'treasurer' } }))).toBe('treasurer');

    expect(describeRequest(appoint)).toBe('appoint Ada Brooks to the office board, from when an Auditor approves, for 12 months');
    expect(reviewLink(appoint)).toBe('/admin?tab=offices');
  });

  it('tells members with one name apart', () => {
    expect(memberCaption({ accountId: 'a', legalName: 'Robert Adams', preferredName: 'Bob Adams', state: 'NY' })).toBe('Known as Bob Adams · NY');
    expect(memberCaption({ accountId: 'a', legalName: 'Ada Brooks', preferredName: null, state: '' })).toBe('');
  });
});

describe('the appointment form', () => {
  it('sends only what was chosen: an earlier start, an end date or a number of months', () => {
    const form = { ...emptyAppointmentForm(), reason: 'vacancy' };
    expect(appointmentInput('a1', form)).toEqual({ accountId: 'a1', reason: 'vacancy' });
    expect(appointmentInput('a1', { ...form, start: 'date', startDate: '2025-03-01', end: 'months', months: 6 })).toEqual({
      accountId: 'a1',
      startsAt: new Date('2025-03-01T00:00:00').toISOString(),
      termMonths: 6,
      reason: 'vacancy',
    });
    expect(appointmentInput('a1', { ...form, end: 'date', endDate: '2027-06-30' })).toMatchObject({ endsAt: new Date('2027-06-30T00:00:00').toISOString() });
    // A date the browser could not read is sent as typed, for the schema to refuse.
    expect(appointmentInput('a1', { ...form, start: 'date', startDate: 'soon' }).startsAt).toBe('soon');
  });

  it('reads calendar dates in the reader’s time zone', () => {
    expect(dayStart('2026-10-27')).toBe(new Date(2026, 9, 27).toISOString());
    expect(dayStart('')).toBeUndefined();
    expect(dayStart('2026-13-45')).toBeUndefined();
    expect(todayInput(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
