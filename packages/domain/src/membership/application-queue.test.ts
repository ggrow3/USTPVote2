import { describe, expect, it } from 'vitest';
import { queueBadge, queueSummaryText, waitingDays, waitsLong, waitText } from './application-queue.js';

const now = new Date('2026-11-10T12:00:00.000Z');

describe('the applications queue', () => {
  it('counts whole days waited, never negative', () => {
    expect(waitingDays('2026-11-10T11:00:00.000Z', now)).toBe(0);
    expect(waitingDays('2026-11-09T11:00:00.000Z', now)).toBe(1);
    expect(waitingDays('2026-11-05T12:00:00.000Z', now)).toBe(5);
    expect(waitingDays('2026-11-11T12:00:00.000Z', now)).toBe(0);
    expect([waitText(0), waitText(1), waitText(5)]).toEqual(['less than a day', '1 day', '5 days']);
  });

  it('marks three days or more as long', () => {
    expect(waitsLong('2026-11-08T12:00:00.000Z', now)).toBe(false);
    expect(waitsLong('2026-11-07T12:00:00.000Z', now)).toBe(true);
  });

  it('says how many wait and for how long', () => {
    expect(queueSummaryText({ pending: 0, oldestSubmittedAt: null }, now)).toBe('No applications are waiting.');
    expect(queueSummaryText({ pending: 1, oldestSubmittedAt: '2026-11-10T09:00:00.000Z' }, now)).toBe('1 application waiting, for less than a day.');
    expect(queueSummaryText({ pending: 3, oldestSubmittedAt: '2026-11-05T09:00:00.000Z' }, now)).toBe('3 applications waiting, the oldest for 5 days.');
    expect([queueBadge(7), queueBadge(120)]).toEqual(['7', '99+']);
  });
});
