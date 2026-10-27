import { describe, expect, it } from 'vitest';
import { checkCanApprove, checkCanRequest, type Actor } from './approvals.js';
import {
  appointmentDates,
  appointmentInputSchema,
  appointTerm,
  freeSeats,
  planAppointment,
  type AppointmentContext,
  type AppointPayload,
} from './appointments.js';
import { isPublicLedgerEvent } from './ledger.js';
import { isAppointed, type PositionTermRecord } from './positions.js';

const NOW = '2026-10-27T12:00:00.000Z';
const chair = { positionId: 'chair', title: 'Chair', seats: 1, termMonths: 24 };
const board = { positionId: 'board', title: 'Board', seats: 2, termMonths: 12 };
const ada = { status: 'active' as const, legalName: 'Ada Brooks' };
const context = (over: Partial<AppointmentContext> = {}): AppointmentContext => ({ office: chair, member: ada, terms: [], ...over });
const plan = (input: Parameters<typeof planAppointment>[1], over: Partial<AppointmentContext> = {}, now = NOW) =>
  planAppointment('chair', input, context(over), now);
const reasonOf = (outcome: { ok: boolean; reason?: string }) => (outcome.ok ? 'ok' : outcome.reason);

describe('appointment requests', () => {
  it('take a member, optional dates or a length, and a reason', () => {
    const minimal = { accountId: 'a1', reason: 'officers voted 4–1 under bylaws art. 4.3' };
    expect(appointmentInputSchema.safeParse(minimal).success).toBe(true);
    expect(appointmentInputSchema.safeParse({ ...minimal, startsAt: '2026-03-01T00:00:00-05:00', termMonths: 6 }).success).toBe(true);
    expect(appointmentInputSchema.safeParse({ ...minimal, endsAt: '2027-01-01T00:00:00Z' }).success).toBe(true);
    expect(appointmentInputSchema.safeParse({ ...minimal, reason: ' ' }).success).toBe(false);
    expect(appointmentInputSchema.safeParse({ ...minimal, accountId: '' }).success).toBe(false);
    expect(appointmentInputSchema.safeParse({ ...minimal, startsAt: '1 March' }).success).toBe(false);
    expect(appointmentInputSchema.safeParse({ ...minimal, termMonths: 0 }).success).toBe(false);
    const both = appointmentInputSchema.safeParse({ ...minimal, endsAt: '2027-01-01T00:00:00Z', termMonths: 6 });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]).toMatchObject({ path: ['termMonths'], message: 'give an end date or a number of months, not both' });
  });

  it('default to a full term from approval, under the member’s legal name', () => {
    expect(plan({ accountId: 'a1' })).toEqual({
      ok: true,
      value: { positionId: 'chair', accountId: 'a1', holderName: 'Ada Brooks', startsAt: null, endsAt: null, termMonths: 24 },
    });
  });

  it('keep an earlier start, and an end date or a shorter length, in UTC', () => {
    expect(plan({ accountId: 'a1', startsAt: '2026-03-01T00:00:00-05:00', termMonths: 12 })).toMatchObject({
      value: { startsAt: '2026-03-01T05:00:00.000Z', endsAt: null, termMonths: 12 },
    });
    expect(plan({ accountId: 'a1', endsAt: '2027-06-30T00:00:00+02:00' })).toMatchObject({
      value: { startsAt: null, endsAt: '2027-06-29T22:00:00.000Z', termMonths: null },
    });
  });

  it('are refused for an office that does not exist, as not found', () => {
    expect(plan({ accountId: 'a1' }, { office: null })).toEqual({ ok: false, reason: 'there is no office chair', refusal: 'not_found' });
  });

  it('need an Active member', () => {
    for (const member of [null, { ...ada, status: 'lapsed' as const }, { ...ada, status: 'suspended' as const }, { ...ada, status: 'applicant' as const }]) {
      expect(reasonOf(plan({ accountId: 'a1' }, { member }))).toMatch(/^only an Active member can be appointed/);
    }
  });

  it('only fill a free seat, and never displace a sitting holder', () => {
    const sitting = { accountId: 'b2', status: 'active' as const };
    expect(reasonOf(plan({ accountId: 'a1' }, { terms: [sitting] }))).toBe('Chair has no free seat (its one seat is held): end a term first, then appoint');
    expect(plan({ accountId: 'a1' }, { terms: [{ ...sitting, status: 'ended' }] }).ok).toBe(true);
    // An elected holder who never had an account still holds their seat.
    expect(plan({ accountId: 'a1' }, { terms: [{ accountId: null, status: 'active' }] }).ok).toBe(false);

    const onBoard = (terms: AppointmentContext['terms']) => planAppointment('board', { accountId: 'a1' }, context({ office: board, terms }), NOW);
    expect(onBoard([sitting]).ok).toBe(true);
    expect(reasonOf(onBoard([sitting, { accountId: 'c3', status: 'active' }]))).toBe(
      'Board has no free seat (all 2 of its seats are held): end a term first, then appoint',
    );
    expect(reasonOf(onBoard([{ accountId: 'a1', status: 'active' }]))).toBe('Ada Brooks already holds the office of Board');
    expect(freeSeats(board, [sitting, { accountId: 'c3', status: 'ended' }])).toBe(1);
    expect(freeSeats(chair, [sitting, sitting])).toBe(0);
  });

  it('start no later than they are approved', () => {
    expect(reasonOf(plan({ accountId: 'a1', startsAt: '2026-10-28T00:00:00Z' }))).toMatch(/^an appointment takes effect when it is approved/);
    expect(plan({ accountId: 'a1', startsAt: NOW }).ok).toBe(true);
  });

  it('last no longer than the office’s term, and are not over before they begin', () => {
    expect(reasonOf(plan({ accountId: 'a1', termMonths: 25 }))).toBe('a term of Chair lasts at most 24 months');
    expect(reasonOf(plan({ accountId: 'a1', endsAt: '2028-10-28T00:00:00Z' }))).toBe('a term of Chair lasts at most 24 months, so this one must end by 2028-10-27');
    expect(plan({ accountId: 'a1', endsAt: '2028-10-27T12:00:00Z' }).ok).toBe(true);
    expect(reasonOf(plan({ accountId: 'a1', startsAt: '2026-01-01T00:00:00Z', endsAt: '2025-12-01T00:00:00Z' }))).toBe('the term must end after it starts');
    // Backdated: someone serving since 2025 whose term would have ended already.
    expect(reasonOf(plan({ accountId: 'a1', startsAt: '2025-03-01T00:00:00Z', termMonths: 12 }))).toBe('the term would already be over');
    expect(reasonOf(plan({ accountId: 'a1', startsAt: '2024-10-01T00:00:00Z' }))).toBe('the term would already be over');
    expect(plan({ accountId: 'a1', startsAt: '2025-03-01T00:00:00Z' }).ok).toBe(true);
  });
});

describe('approving an appointment', () => {
  const payload: AppointPayload = { positionId: 'chair', accountId: 'a1', holderName: 'Ada Brooks', startsAt: null, endsAt: null, termMonths: 24 };
  const approval = { termId: 't9', approvalId: 'r1', reason: 'vacancy: officers voted under art. 4.3', approvedBy: 'aud1' };
  const approvedAt = '2026-10-30T09:00:00.000Z';

  it('starts the term when approved, for the length requested, marked as an appointment', () => {
    const outcome = appointTerm(payload, context(), approval, approvedAt);
    expect(outcome).toEqual({
      ok: true,
      value: {
        term: {
          termId: 't9',
          basis: 'appointment',
          positionId: 'chair',
          holderName: 'Ada Brooks',
          accountId: 'a1',
          startsAt: approvedAt,
          endsAt: '2028-10-30T09:00:00.000Z',
          status: 'active',
          endedAt: null,
          endReason: null,
          approvalId: 'r1',
          reason: approval.reason,
        },
        event: {
          type: 'position_term.appointed',
          actor: 'aud1',
          subject: 'chair',
          payload: {
            termId: 't9',
            positionId: 'chair',
            holderName: 'Ada Brooks',
            accountId: 'a1',
            startsAt: approvedAt,
            endsAt: '2028-10-30T09:00:00.000Z',
            reason: approval.reason,
            approvalId: 'r1',
          },
        },
      },
    });
    expect(outcome.ok && isAppointed(outcome.value.term)).toBe(true);
    expect(isPublicLedgerEvent('position_term.appointed')).toBe(true);
  });

  it('keeps an earlier start or a given end', () => {
    expect(appointmentDates({ startsAt: '2025-03-01T00:00:00.000Z', endsAt: null, termMonths: 24 }, approvedAt)).toEqual({
      startsAt: '2025-03-01T00:00:00.000Z',
      endsAt: '2027-03-01T00:00:00.000Z',
    });
    expect(appointmentDates({ startsAt: null, endsAt: '2027-01-01T00:00:00.000Z', termMonths: null }, approvedAt)).toEqual({
      startsAt: approvedAt,
      endsAt: '2027-01-01T00:00:00.000Z',
    });
  });

  it('checks everything again: the seat, the member, the office and the dates may have changed since the request', () => {
    expect(reasonOf(appointTerm(payload, context({ terms: [{ accountId: 'b2', status: 'active' }] }), approval, approvedAt))).toMatch(/no free seat/);
    expect(reasonOf(appointTerm(payload, context({ member: { ...ada, status: 'suspended' } }), approval, approvedAt))).toMatch(/Active member/);
    expect(appointTerm(payload, context({ office: null }), approval, approvedAt)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(reasonOf(appointTerm(payload, context({ office: { ...chair, termMonths: 12 } }), approval, approvedAt))).toBe('a term of Chair lasts at most 12 months');
    const ending = { ...payload, termMonths: null, endsAt: '2026-10-29T00:00:00.000Z' };
    expect(appointTerm(ending, context(), approval, '2026-10-28T00:00:00.000Z').ok).toBe(true);
    expect(reasonOf(appointTerm(ending, context(), approval, approvedAt))).toBe('the term would already be over');
  });
});

describe('who asks and who approves', () => {
  const actor = (accountId: string, roles: Actor['roles']): Actor => ({ accountId, roles, mfa: true, authAgeSeconds: 60 });
  const request = { action: 'position.appoint' as const, requestedBy: 'ma1', status: 'pending' as const, expiresAt: new Date('2026-11-03T00:00:00Z'), subject: 'a1' };
  const at = new Date(NOW);

  it('a Membership or Election Admin asks, never for themselves', () => {
    expect(checkCanRequest('position.appoint', actor('ma1', ['membership_admin']), 'a1').ok).toBe(true);
    expect(checkCanRequest('position.appoint', actor('ea1', ['election_admin']), 'a1').ok).toBe(true);
    expect(checkCanRequest('position.appoint', actor('aud1', ['auditor']), 'a1')).toMatchObject({ ok: false });
    expect(checkCanRequest('position.appoint', actor('sa1', ['system_admin']), 'a1')).toMatchObject({ ok: false });
    expect(checkCanRequest('position.appoint', actor('a1', ['membership_admin']), 'a1')).toEqual({ ok: false, reason: 'you cannot request this for your own account' });
  });

  it('an Auditor approves, but not the requester or the appointee', () => {
    expect(checkCanApprove(request, actor('aud1', ['auditor']), at).ok).toBe(true);
    expect(checkCanApprove(request, actor('ea1', ['election_admin']), at)).toMatchObject({ ok: false });
    expect(checkCanApprove({ ...request, requestedBy: 'aud1' }, actor('aud1', ['auditor']), at)).toMatchObject({ ok: false });
    expect(checkCanApprove(request, actor('a1', ['auditor']), at)).toEqual({ ok: false, reason: 'you cannot approve an action on your own account' });
  });
});

describe('terms', () => {
  it('say whether they come from an appointment; older elected terms have no basis', () => {
    const elected = { termId: 't1', positionId: 'chair', electionId: 'e1', contestId: 'c', candidateId: 'k', resultsHash: 'h' } as PositionTermRecord;
    expect(isAppointed(elected)).toBe(false);
    expect(isAppointed({ ...elected, basis: 'election' } as PositionTermRecord)).toBe(false);
    expect(isAppointed({ termId: 't2', basis: 'appointment' } as PositionTermRecord)).toBe(true);
  });
});
