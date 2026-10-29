import { z } from 'zod';
import { refuse, type Outcome } from '../check.js';
import { SOCIAL_NETWORKS } from '../governance/hub.js';
import type { LedgerEvent } from '../ledger-events.js';
import { addressSchema, basedOnSchema, changedFields, communicationsEvent, oneLine, stale, text } from './common.js';

/**
 * The bot registry (design §10.9): every automated account the party runs, on any site, so the team knows what speaks
 * for the party automatically, who looks after it, and when someone last checked it still behaves. Those marked public
 * are listed on the Press page, so anyone can tell the party's bots from impostors. No bot's token or password is kept
 * here. Changes are ledgered.
 */

export const BOT_SITES = [...SOCIAL_NETWORKS, 'other'] as const;
export type BotSite = (typeof BOT_SITES)[number];

export const BOT_STATUSES = ['active', 'paused', 'retired'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export const BOT_LIMITS = { name: 80, handle: 100, purpose: 500, operator: 100, runsOn: 100, notes: 1000 } as const;

const contentShape = {
  name: oneLine(BOT_LIMITS.name).pipe(z.string().min(1, 'enter a name')),
  site: z.enum(BOT_SITES),
  /** Its name on the site ("@USTPNewsBot"). */
  handle: oneLine(BOT_LIMITS.handle).default(''),
  /** Its profile or invite: an `https://` address, or empty. */
  url: addressSchema(false),
  /** What it does, in a sentence or two (shown in public when the bot is). */
  purpose: text(BOT_LIMITS.purpose).pipe(z.string().min(1, 'say what it does')),
  /** Who looks after it: a person or a team. */
  operator: oneLine(BOT_LIMITS.operator).default(''),
  /** What it runs on ("IFTTT", "a volunteer's server", "the news feed"). */
  runsOn: oneLine(BOT_LIMITS.runsOn).default(''),
  status: z.enum(BOT_STATUSES),
  /** Listed on the Press page. */
  public: z.boolean().default(false),
  /** For the team only. */
  notes: text(BOT_LIMITS.notes),
};

export const botContentSchema = z.strictObject(contentShape);
export type BotContent = Readonly<z.output<typeof botContentSchema>>;

export const createBotSchema = botContentSchema;
export type CreateBotInput = z.infer<typeof createBotSchema>;

export const updateBotSchema = z.strictObject({ ...contentShape, basedOn: basedOnSchema });
export type UpdateBotInput = z.infer<typeof updateBotSchema>;

/** `POST …/bots/{botId}/checked` */
export const botVersionSchema = z.strictObject({ basedOn: basedOnSchema });
export type BotVersionInput = z.infer<typeof botVersionSchema>;

/** `bots/{botId}` */
export interface BotRecord extends BotContent {
  readonly botId: string;
  /** When someone on the team last checked it still does what it says (and nothing else). */
  readonly checkedAt: string | null;
  readonly checkedBy: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** After this many days without a check, an active bot is flagged as due one. */
export const BOT_CHECK_DAYS = 30;

const FIELDS = Object.keys(contentShape) as (keyof BotContent)[];

/** `bot.changed` */
export interface BotChangedPayload {
  readonly botId: string;
  readonly change: 'added' | 'updated' | 'checked' | 'removed';
  readonly name: string;
  readonly site: BotSite;
  readonly version: number;
  readonly fields?: readonly (keyof BotContent)[];
}

const botEvent = (actor: string, bot: BotRecord, change: BotChangedPayload['change'], fields?: (keyof BotContent)[]) =>
  communicationsEvent('bot.changed', actor, bot.botId, {
    botId: bot.botId,
    change,
    name: bot.name,
    site: bot.site,
    version: bot.version,
    ...(fields && { fields }),
  } satisfies BotChangedPayload);

export function addBot(input: CreateBotInput, botId: string, actor: string, at: string): { bot: BotRecord; event: LedgerEvent } {
  const bot: BotRecord = { botId, ...input, checkedAt: null, checkedBy: null, version: 1, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor };
  return { bot, event: botEvent(actor, bot, 'added') };
}

export function updateBot(
  bot: BotRecord | null,
  input: BotContent,
  basedOn: number,
  actor: string,
  at: string,
): Outcome<{ bot: BotRecord; event: LedgerEvent | null }> {
  if (!bot) return refuse('not_found', 'no such bot');
  if (basedOn !== bot.version) return refuse('conflict', stale('bot'));
  const next = { ...bot, ...input };
  const fields = changedFields(FIELDS, bot, next);
  if (!fields.length) return { ok: true, value: { bot, event: null } };
  const updated: BotRecord = { ...next, version: bot.version + 1, updatedAt: at, updatedBy: actor };
  return { ok: true, value: { bot: updated, event: botEvent(actor, updated, 'updated', fields) } };
}

/** Someone on the team checked it is behaving. */
export function checkBot(bot: BotRecord | null, basedOn: number, actor: string, at: string): Outcome<{ bot: BotRecord; event: LedgerEvent }> {
  if (!bot) return refuse('not_found', 'no such bot');
  if (basedOn !== bot.version) return refuse('conflict', stale('bot'));
  const checked: BotRecord = { ...bot, checkedAt: at, checkedBy: actor, version: bot.version + 1, updatedAt: at, updatedBy: actor };
  return { ok: true, value: { bot: checked, event: botEvent(actor, checked, 'checked') } };
}

export function removeBot(bot: BotRecord | null, actor: string): Outcome<LedgerEvent> {
  if (!bot) return refuse('not_found', 'no such bot');
  return { ok: true, value: botEvent(actor, bot, 'removed') };
}

/** An active bot not checked in `BOT_CHECK_DAYS`. */
export function botCheckDue(bot: Pick<BotRecord, 'status' | 'checkedAt' | 'createdAt'>, now: Date): boolean {
  if (bot.status !== 'active') return false;
  const last = Date.parse(bot.checkedAt ?? bot.createdAt);
  return now.getTime() - last > BOT_CHECK_DAYS * 86_400_000;
}

/** A bot as the Press page lists it. */
export type PublicBot = Pick<BotRecord, 'botId' | 'name' | 'site' | 'handle' | 'url' | 'purpose' | 'status'>;

/** The bots marked public and not retired, by site then name. */
export function publicBots(bots: readonly BotRecord[]): PublicBot[] {
  return bots
    .filter((b) => b.public && b.status !== 'retired')
    .sort((a, b) => BOT_SITES.indexOf(a.site) - BOT_SITES.indexOf(b.site) || a.name.localeCompare(b.name))
    .map(({ botId, name, site, handle, url, purpose, status }) => ({ botId, name, site, handle, url, purpose, status }));
}
