import { describe, expect, it } from 'vitest';
import { chargeMeter, meterEstimateUsd, modelStopped, nextMonthStart, roomModelCostView, sessionCostUsd, stopModel, type RoomModelMeterRecord } from './model-meter.js';

const RATES = { hourlyUsd: 0.98, idleMinutes: 30, monthlyBudgetUsd: 15 };
const at = (time: string, day = '01') => `2026-11-${day}T${time}:00.000Z`;

/** Charges the meter at each time in turn, as calls to the model would. */
function calls(times: string[], meter: RoomModelMeterRecord | null = null, rates = RATES): RoomModelMeterRecord | null {
  for (const t of times) {
    const charged = chargeMeter(meter, t, rates);
    if (!charged.allowed) throw new Error(`refused at ${t}`);
    meter = charged.meter;
  }
  return meter;
}

describe('the room model meter (design §5.10)', () => {
  it('costs a wake-up as its start-up, its use and its whole idle tail', () => {
    // 10 minutes in use + 30 idle + 10 starting = 50 minutes at $0.98 an hour.
    expect(sessionCostUsd({ startedAt: at('10:00'), lastAt: at('10:10') }, RATES)).toBeCloseTo((50 / 60) * 0.98);
    // Vertex AI keeps a machine up at least 5 minutes, so a 2-minute idle time still costs 5.
    expect(sessionCostUsd({ startedAt: at('10:00'), lastAt: at('10:00') }, { ...RATES, idleMinutes: 2 })).toBeCloseTo((15 / 60) * 0.98);
  });

  it('extends the wake-up for calls within the idle time, and starts a new one after', () => {
    const meter = calls([at('10:00'), at('10:05'), at('10:30'), at('11:30')]);
    expect(meter).toMatchObject({ month: '2026-11', wakeUps: 2, session: { startedAt: at('11:30'), lastAt: at('11:30') } });
    // The first wake-up: 10:00 to 10:30 in use, then 30 idle and 10 starting.
    expect(meter!.spentUsd).toBeCloseTo((70 / 60) * 0.98);
    expect(meterEstimateUsd(meter, at('11:31'), RATES)).toBeCloseTo((70 / 60) * 0.98 + (40 / 60) * 0.98);
  });

  it('refuses a call that would take the month past the cap, before anything is spent', () => {
    const meter = calls([at('10:00')], null, { ...RATES, monthlyBudgetUsd: 1 });
    // A second wake-up would cost another 40 minutes: past $1.
    const refused = chargeMeter(meter, at('12:00'), { ...RATES, monthlyBudgetUsd: 1 });
    expect(refused).toMatchObject({ allowed: false, reason: 'budget' });
    // Within the wake-up it can still answer, as long as the longer tail fits.
    expect(chargeMeter(meter, at('10:10'), { ...RATES, monthlyBudgetUsd: 1 })).toMatchObject({ allowed: true, wakes: false });
    expect(chargeMeter(null, at('10:00'), { ...RATES, monthlyBudgetUsd: 0 })).toMatchObject({ allowed: false, reason: 'budget' });
  });

  it('starts each month from nothing', () => {
    const meter = calls([at('10:00', '30')]);
    expect(meterEstimateUsd(meter, '2026-12-01T09:00:00.000Z', RATES)).toBe(0);
    const december = chargeMeter(meter, '2026-12-01T09:00:00.000Z', RATES);
    expect(december).toMatchObject({ allowed: true, wakes: true, meter: { month: '2026-12', wakeUps: 1, spentUsd: 0 } });
  });

  it('stops the month when Google Cloud’s budget is spent, until the next one', () => {
    const stopped = stopModel(calls([at('10:00')]), at('11:00'));
    expect(modelStopped(stopped, at('12:00'))).toBe(true);
    expect(chargeMeter(stopped, at('12:00'), RATES)).toMatchObject({ allowed: false, reason: 'stopped' });
    expect(modelStopped(stopped, '2026-12-01T00:00:00.000Z')).toBe(false);
    expect(nextMonthStart(at('11:00'))).toBe('2026-12-01');
    expect(nextMonthStart('2026-12-31T23:00:00.000Z')).toBe('2027-01-01');
  });

  it('shows the month for the admins', () => {
    expect(roomModelCostView(calls([at('10:00')]), at('10:01'), RATES)).toEqual({
      month: '2026-11',
      estimateUsd: 0.65,
      budgetUsd: 15,
      hourlyUsd: 0.98,
      idleMinutes: 30,
      wakeUps: 1,
      stopped: false,
      resetsOn: '2026-12-01',
    });
  });
});
