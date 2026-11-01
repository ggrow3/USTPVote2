/**
 * What the members' room's model costs on Vertex AI, and the monthly cap on it (design §5.10). Vertex AI bills the
 * model's machine by the hour while it is up, and it stays up from a wake-up (the first call after it scaled to zero)
 * until it has idled `idleMinutes`. Before each call the worker charges the meter: a call within the idle time of the
 * last one extends the wake-up it is in, any other starts a new one. Each wake-up is costed generously (its start-up,
 * its use and its whole idle tail), and a call that would take the month past the cap is refused, so the estimate
 * stays above what Google bills. Google Cloud's budget for the model checks the real bill too (`stopModel`).
 */

/** How the meter prices the model's time: from Terraform, with the machine's hourly price. */
export interface RoomModelRates {
  /** Vertex AI's price of the model's machine (g2-standard-8, one L4) an hour, in US dollars. */
  readonly hourlyUsd: number;
  /** How long the model stays up after its last call before it scales to zero. */
  readonly idleMinutes: number;
  /** The cap on a month's estimate, in US dollars; 0 stops the model. */
  readonly monthlyBudgetUsd: number;
}

/** Billed while a machine starts and copies the models, before it can answer: an allowance, on the high side. */
export const ROOM_MODEL_STARTUP_MINUTES = 10;
/** Vertex AI keeps a machine up at least this long once it starts (its minimum scale-up period). */
export const ROOM_MODEL_MIN_UP_MINUTES = 5;

/** A wake-up: when the model was first called and last called. */
export interface RoomModelSession {
  readonly startedAt: string;
  readonly lastAt: string;
}

/** `room_state/model`: the month's estimate, and the worker's deployment of the model to Vertex AI. */
export interface RoomModelMeterRecord {
  /** The month (UTC, `YYYY-MM`) the figures are for. */
  readonly month: string;
  /** The estimated cost of the month's finished wake-ups. */
  readonly spentUsd: number;
  readonly wakeUps: number;
  /** The wake-up in progress, if the model may still be up. */
  readonly session: RoomModelSession | null;
  /** When Google Cloud's budget reported the month's real bill at the cap: nothing more is sent this month. */
  readonly stoppedAt: string | null;
  /**
   * The configuration the worker last started uploading to Vertex AI or deploying there, and when: it waits an hour
   * before starting the same step again.
   */
  readonly deploy: { readonly config: string; readonly step: 'upload' | 'deploy'; readonly startedAt: string } | null;
}

export const EMPTY_METER: RoomModelMeterRecord = { month: '', spentUsd: 0, wakeUps: 0, session: null, stoppedAt: null, deploy: null };

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** The month of an ISO time, `YYYY-MM` in UTC. */
export const meterMonth = (at: string): string => at.slice(0, 7);

/** A wake-up's estimated cost: start-up, then up from its first call until it has idled after its last. */
export function sessionCostUsd(session: RoomModelSession, rates: RoomModelRates): number {
  const used = Date.parse(session.lastAt) - Date.parse(session.startedAt);
  const up = Math.max(used + rates.idleMinutes * MINUTE_MS, ROOM_MODEL_MIN_UP_MINUTES * MINUTE_MS) + ROOM_MODEL_STARTUP_MINUTES * MINUTE_MS;
  return (up / HOUR_MS) * rates.hourlyUsd;
}

/** The meter for the month of `at`: a new month starts from nothing (and is no longer stopped). */
function thisMonth(meter: RoomModelMeterRecord | null, at: string): RoomModelMeterRecord {
  const base = meter ?? EMPTY_METER;
  return base.month === meterMonth(at) ? base : { ...EMPTY_METER, month: meterMonth(at), deploy: base.deploy };
}

/** Whether the model may still be up after `session`, at `at`. */
const live = (session: RoomModelSession | null, at: string, rates: RoomModelRates): session is RoomModelSession =>
  !!session && Date.parse(at) - Date.parse(session.lastAt) <= rates.idleMinutes * MINUTE_MS;

/** The month's estimate so far, at `at`: finished wake-ups and the one in progress, idle tail included. */
export function meterEstimateUsd(meter: RoomModelMeterRecord | null, at: string, rates: RoomModelRates): number {
  const m = thisMonth(meter, at);
  return m.spentUsd + (m.session ? sessionCostUsd(m.session, rates) : 0);
}

export type MeterCharge =
  | { readonly allowed: true; readonly meter: RoomModelMeterRecord; readonly estimateUsd: number; readonly wakes: boolean }
  | { readonly allowed: false; readonly reason: 'budget' | 'stopped'; readonly estimateUsd: number };

/**
 * Charges the meter for a call to the model at `at`: refused once Google Cloud's budget stopped the month, or if the
 * call would take the month's estimate past the cap (a new wake-up costs at least its start-up and idle tail).
 */
export function chargeMeter(meter: RoomModelMeterRecord | null, at: string, rates: RoomModelRates): MeterCharge {
  const m = thisMonth(meter, at);
  if (m.stoppedAt) return { allowed: false, reason: 'stopped', estimateUsd: meterEstimateUsd(m, at, rates) };
  const wakes = !live(m.session, at, rates);
  const next: RoomModelMeterRecord = wakes
    ? { ...m, spentUsd: m.spentUsd + (m.session ? sessionCostUsd(m.session, rates) : 0), wakeUps: m.wakeUps + 1, session: { startedAt: at, lastAt: at } }
    : { ...m, session: { startedAt: m.session!.startedAt, lastAt: at } };
  const estimateUsd = meterEstimateUsd(next, at, rates);
  if (estimateUsd > rates.monthlyBudgetUsd) return { allowed: false, reason: 'budget', estimateUsd: meterEstimateUsd(m, at, rates) };
  return { allowed: true, meter: next, estimateUsd, wakes };
}

/** Google Cloud's budget reported the month's real bill at the cap: the model is stopped until the month ends. */
export function stopModel(meter: RoomModelMeterRecord | null, at: string): RoomModelMeterRecord {
  const m = thisMonth(meter, at);
  return m.stoppedAt ? m : { ...m, stoppedAt: at };
}

/** Whether the month of `at` was stopped by Google Cloud's budget. */
export const modelStopped = (meter: RoomModelMeterRecord | null, at: string): boolean => !!thisMonth(meter, at).stoppedAt;

/** The first day of the month after `at`, `YYYY-MM-DD`: when the cap starts again. */
export function nextMonthStart(at: string): string {
  const d = new Date(at);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** Admin › Members' room: this month's estimate against the cap, for a model on Vertex AI. */
export interface RoomModelCostView {
  /** The month (`YYYY-MM`, UTC). */
  readonly month: string;
  readonly estimateUsd: number;
  readonly budgetUsd: number;
  readonly hourlyUsd: number;
  readonly idleMinutes: number;
  readonly wakeUps: number;
  /** Google Cloud's budget reported the month's real bill at the cap. */
  readonly stopped: boolean;
  /** The day the cap starts again, `YYYY-MM-DD`. */
  readonly resetsOn: string;
}

export function roomModelCostView(meter: RoomModelMeterRecord | null, at: string, rates: RoomModelRates): RoomModelCostView {
  const m = thisMonth(meter, at);
  return {
    month: m.month,
    estimateUsd: Math.round(meterEstimateUsd(m, at, rates) * 100) / 100,
    budgetUsd: rates.monthlyBudgetUsd,
    hourlyUsd: rates.hourlyUsd,
    idleMinutes: rates.idleMinutes,
    wakeUps: m.wakeUps,
    stopped: !!m.stoppedAt,
    resetsOn: nextMonthStart(at),
  };
}
