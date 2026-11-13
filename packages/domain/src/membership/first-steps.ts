import { z } from 'zod';
import { deny, OK, refuse, type Check } from '../check.js';
import { MENU_LINKS, type MenuLink } from '../governance/navigation.js';
import { FIRST_STEPS, type FirstStep } from './join-funnel.js';

/**
 * A new member's first steps (design §5.16): a short list on the voting home of things to do. Membership Admins choose
 * the steps, their words and links and their order. A step is ticked either from a record that says the member did it,
 * the same records the join funnel counts (§5.15), or by the member themselves, for a step the site cannot check. The
 * list is there until every step shown is done or the member hides it.
 */

/** How a step is ticked: by one of the site's own records, or by the member (`self`). */
export const FIRST_STEP_CHECKS = [...FIRST_STEPS, 'self'] as const;
export type FirstStepCheck = (typeof FIRST_STEP_CHECKS)[number];

/** Each way of ticking a step, as the settings offer it. */
export const FIRST_STEP_CHECK_LABELS: Readonly<Record<FirstStepCheck, string>> = {
  course: 'When they start a course',
  team: 'When they join a team',
  room: 'When they enter the members’ room',
  posted: 'When they post or comment in the forum',
  voted: 'When they cast a ballot',
  self: 'When they tick it themselves',
};

/** The most the list and each step may hold, once tidied. */
export const FIRST_STEPS_LIMITS = {
  steps: 10,
  label: 80,
  why: 240,
  link: 300,
} as const;

/** A step's id: kept while its words change, so a member's own ticks stay with it. */
export const FIRST_STEP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface FirstStepSetting {
  readonly id: string;
  /** What to do, as the line's link text: "Take a first course". */
  readonly label: string;
  /** A sentence on what it is for; may be empty. */
  readonly why: string;
  /** A page on this site (`/courses`) or an `https://` address, opened in a new tab. */
  readonly link: string;
  readonly check: FirstStepCheck;
}

export interface FirstStepsSettings {
  /** In the order the list shows them; none at all means members see no list. */
  readonly steps: readonly FirstStepSetting[];
}

/** `first_steps/current`; version 0 is the default, which nobody has saved. */
export interface FirstStepsRecord extends FirstStepsSettings {
  /** Counts saves: an edit made from an older copy is refused. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** The list as it was built: what can be done today first, voting last, since a vote may not be open. */
export const DEFAULT_FIRST_STEPS: FirstStepsSettings = {
  steps: [
    { id: 'course', label: 'Take a first course', why: 'Short lessons on what the party stands for, with a quiz after each.', link: '/courses', check: 'course' },
    { id: 'team', label: 'Join a team', why: 'Teams are where the party’s work is done: pick one that fits what you want to do.', link: '/teams', check: 'team' },
    { id: 'room', label: 'Say hello in the members’ room', why: 'A chat room for members, with an assistant you can ask about the party.', link: '/room', check: 'room' },
    { id: 'posted', label: 'Post or comment in the forum', why: 'Where members raise ideas and discuss them at more length.', link: '/forum', check: 'posted' },
    { id: 'voted', label: 'Cast your first ballot', why: 'Your ballots are listed there whenever a vote is open to you.', link: '/ballot', check: 'voted' },
  ],
};

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A step with its words on one line and its link trimmed. */
export function tidyFirstStep(step: FirstStepSetting): FirstStepSetting {
  return { id: step.id.trim(), label: oneLine(step.label), why: oneLine(step.why), link: step.link.trim(), check: step.check };
}

const isCheck = (value: unknown): value is FirstStepCheck => typeof value === 'string' && (FIRST_STEP_CHECKS as readonly string[]).includes(value);

function storedStep(value: unknown): FirstStepSetting | null {
  if (!value || typeof value !== 'object') return null;
  const { id, label, why, link, check } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof label !== 'string' || typeof link !== 'string' || !isCheck(check)) return null;
  return tidyFirstStep({ id, label, why: typeof why === 'string' ? why : '', link, check });
}

/** The steps in force from what was saved, tidied: the default list while nothing has been saved. */
export function resolveFirstSteps(stored: { readonly steps?: unknown } | null | undefined): FirstStepsSettings {
  if (!Array.isArray(stored?.steps)) return DEFAULT_FIRST_STEPS;
  return { steps: stored.steps.map(storedStep).filter((s): s is FirstStepSetting => s !== null) };
}

/** A page on this site: a path from its root, never `//host` (another site) or a backslash. */
const SITE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;
const LINK_HINT = 'use a page on this site, starting with /, or an https:// address';

/** Whether a link is a page on this site, rather than an address elsewhere. */
export function isSiteLink(link: string): boolean {
  return link.startsWith('/');
}

/** Why a step's link cannot be used, if it cannot: it must be a page on this site or an `https://` address. */
export function firstStepLinkProblem(link: string): string | null {
  if (!link) return 'a step needs a link';
  if (link.length > FIRST_STEPS_LIMITS.link) return `a link can be at most ${FIRST_STEPS_LIMITS.link} characters`;
  if (/\s/.test(link)) return 'a link cannot contain spaces';
  if (isSiteLink(link)) return SITE_PATH.test(link) ? null : LINK_HINT;
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return LINK_HINT;
  }
  if (parsed.protocol === 'http:') return 'use the https:// address';
  return parsed.protocol === 'https:' && parsed.hostname ? null : LINK_HINT;
}

/** The menu link a step's page needs, when its page is one the navigation settings can hide (design §10.5). */
export function firstStepMenu(link: string): MenuLink | null {
  if (!isSiteLink(link)) return null;
  const page = link.slice(1).split(/[/?#]/, 1)[0] ?? '';
  if (page === 'courses' || page === 'course') return 'course';
  return (MENU_LINKS as readonly string[]).includes(page) ? (page as MenuLink) : null;
}

/**
 * Whether tidied steps can be saved: at most ten; each with an id of its own, words, an explanation within its limit,
 * a link to a page on this site or an `https://` address, and a way to be ticked. Each of the site's own checks ticks
 * at most one step, or a member doing one thing would tick two lines. No steps at all is allowed: no list is shown.
 */
export function checkFirstSteps(settings: FirstStepsSettings): Check {
  const L = FIRST_STEPS_LIMITS;
  if (settings.steps.length > L.steps) return deny(`list at most ${L.steps} steps`);
  const ids = new Map<string, number>();
  const checks = new Map<FirstStepCheck, number>();
  for (const [i, step] of settings.steps.entries()) {
    const n = i + 1;
    if (!FIRST_STEP_ID.test(step.id)) return deny(`Step ${n} has no usable id`);
    const twin = ids.get(step.id);
    if (twin) return deny(`Steps ${twin} and ${n} have the same id`);
    ids.set(step.id, n);
    if (!step.label) return deny(`Step ${n} needs its words`);
    if (step.label.length > L.label) return deny(`Step ${n}'s words can be at most ${L.label} characters`);
    if (step.why.length > L.why) return deny(`Step ${n}'s explanation can be at most ${L.why} characters`);
    const link = firstStepLinkProblem(step.link);
    if (link) return deny(`Step ${n}: ${link}`);
    if (!isCheck(step.check)) return deny(`Step ${n} needs a way to be ticked`);
    if (step.check !== 'self') {
      const other = checks.get(step.check);
      if (other) {
        return deny(`Steps ${other} and ${n} are both ticked ${FIRST_STEP_CHECK_LABELS[step.check].toLowerCase()}: each check can tick one step`);
      }
      checks.set(step.check, n);
    }
  }
  return OK;
}

const sameStep = (a: FirstStepSetting, b: FirstStepSetting) =>
  a.id === b.id && a.label === b.label && a.why === b.why && a.link === b.link && a.check === b.check;

/** Whether two lists differ in any step, its words, link, check or place. */
export function firstStepsDiffer(before: FirstStepsSettings, after: FirstStepsSettings): boolean {
  return before.steps.length !== after.steps.length || before.steps.some((s, i) => !sameStep(s, after.steps[i]!));
}

/** `first_steps.changed`: the list's new version and the whole list, which is short. */
export interface FirstStepsChangedPayload {
  readonly version: number;
  readonly steps: readonly FirstStepSetting[];
}

/** `first_step_ticks/{accountId}`: the steps a member ticked themselves, by id. */
export interface FirstStepTicksRecord {
  readonly ticked: readonly string[];
  readonly updatedAt: string;
}

/** Whether a member may tick or untick a step: only one on the list that the member ticks themselves. */
export function checkFirstStepTick(settings: FirstStepsSettings, id: string): Check {
  const step = settings.steps.find((s) => s.id === id);
  if (!step) return refuse('not_found', 'that step is not on the getting started list');
  if (step.check !== 'self') return deny('the site ticks this step once you have done it');
  return OK;
}

/** The ids of the steps a member ticks themselves that are on the list and ticked: anything else is dropped. */
export function ownTicks(settings: FirstStepsSettings, ticked: readonly string[]): string[] {
  const own = new Set(settings.steps.filter((s) => s.check === 'self').map((s) => s.id));
  return [...new Set(ticked)].filter((id) => own.has(id));
}

/** A member's ticks once they tick (`done`) or untick a step. */
export function nextFirstStepTicks(settings: FirstStepsSettings, ticked: readonly string[], id: string, done: boolean): string[] {
  const kept = ownTicks(settings, ticked).filter((t) => t !== id);
  return done ? [...kept, id] : kept;
}

/** `GET /v1/me/first-steps` */
export interface FirstStepsView {
  /** When they first became a member; null for someone who is not an Active member, who has no list. */
  readonly memberSince: string | null;
  /** Which of the site's own checks they have passed. */
  readonly done: readonly FirstStep[];
  /** The list as Membership Admins set it, in order; empty for someone with no list. */
  readonly steps: readonly FirstStepSetting[];
  /** The steps on it they ticked themselves. */
  readonly ticked: readonly string[];
}

export interface FirstStepItem extends FirstStepSetting {
  readonly done: boolean;
  /** An address on another site, opened in a new tab. */
  readonly external: boolean;
}

/** The member's list: the steps whose pages their menu has, in order, each done or not. Empty for a non-member. */
export function firstStepsList(view: FirstStepsView, menu: readonly MenuLink[]): FirstStepItem[] {
  if (!view.memberSince) return [];
  return (view.steps ?? [])
    .filter((step) => {
      const needs = firstStepMenu(step.link);
      return !needs || menu.includes(needs);
    })
    .map((step) => ({
      ...step,
      external: !isSiteLink(step.link),
      done: step.check === 'self' ? (view.ticked ?? []).includes(step.id) : view.done.includes(step.check),
    }));
}

/** "2 of 5 done". */
export function firstStepsProgress(items: readonly FirstStepItem[]): string {
  return `${items.filter((i) => i.done).length} of ${items.length} done`;
}

/** The list is worth showing while something on it is left to do. */
export function firstStepsLeft(items: readonly FirstStepItem[]): boolean {
  return items.some((i) => !i.done);
}

/** Raw parts are capped well above the limits, which apply once the whitespace is tidied. */
const raw = (max: number) => z.string().max(max);

const firstStepSchema = z.strictObject({
  id: raw(100),
  label: raw(500),
  why: raw(1000),
  link: raw(1000),
  check: z.enum(FIRST_STEP_CHECKS),
});

/** `PUT /v1/admin/first-steps`: the whole list, and the version it was edited from. */
export const firstStepsSettingsSchema = z.strictObject({
  basedOn: z.number().int().min(0),
  steps: z.array(firstStepSchema).max(20),
});
export type FirstStepsSettingsInput = z.infer<typeof firstStepsSettingsSchema>;

/** `PUT /v1/me/first-steps/{id}`: tick or untick a step the member ticks themselves. */
export const firstStepTickSchema = z.strictObject({ done: z.boolean() });
export type FirstStepTickInput = z.infer<typeof firstStepTickSchema>;
