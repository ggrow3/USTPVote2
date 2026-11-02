import { reactive } from 'vue';
import type { AdminSection, Role } from 'ustp-domain';
import { TOURS } from './tours.js';

/**
 * The Guide's walkthroughs (design §10.11): page by page, what a Voter, an Election Admin and an Auditor do on the
 * site, from signing in to a certified election. Starting one keeps a panel at the foot of every page with the step
 * the person is on; Next opens the next step's page. The content is in `tours.ts`; this is the bookkeeping.
 */

export const TOUR_IDS = ['voter', 'election_admin', 'auditor'] as const;
export type TourId = (typeof TOUR_IDS)[number];

/** A page, or an admin console tab, as a walkthrough step names it. */
export interface StepPlace {
  /** A route of router.ts; `:election` stands for the election the walkthrough is following. */
  readonly page: string;
  /** On the admin console (`/admin`), the tab. */
  readonly tab?: AdminSection;
}

export interface TourStep extends StepPlace {
  /** Unique in its tour. */
  readonly id: string;
  /** The page or tab, as the walkthrough calls it. */
  readonly title: string;
  /**
   * Where a step on an election's own page (`:election`) is reached from while the walkthrough knows no election yet,
   * and how.
   */
  readonly pick?: StepPlace & { readonly title: string; readonly how: string };
  /** What the page is for. */
  readonly about: string;
  /** What to do there, in order. */
  readonly todo: readonly string[];
  /** When it goes differently, and who acts next. */
  readonly notes?: readonly string[];
}

export interface Tour {
  readonly id: TourId;
  /** The person it is for, as its card's heading names them. */
  readonly title: string;
  /** One line on who that is. */
  readonly who: string;
  /** The staff role whose tools the steps use; voters need none. */
  readonly role: Role | null;
  readonly steps: readonly TourStep[];
}

/** Where a step is: its page, or the page it is reached from while no election is known. */
export interface StepAddress {
  readonly path: string;
  readonly query?: { readonly tab: AdminSection };
}

const ELECTION = ':election';

/** The step's place, or where it is picked from while the walkthrough follows no election. */
export function stepPlace(step: TourStep, election: string | null): StepPlace {
  return step.page.includes(ELECTION) && !election && step.pick ? step.pick : step;
}

export function stepAddress(step: TourStep, election: string | null): StepAddress {
  const place = stepPlace(step, election);
  const path = place.page.replace(ELECTION, encodeURIComponent(election ?? ''));
  return place.tab ? { path, query: { tab: place.tab } } : { path };
}

/** Signing in, for someone already signed in: the step is done, so the walkthrough stays on the page shown. */
export function stepDone(step: TourStep, signedIn: boolean): boolean {
  return step.page === '/signin' && signedIn;
}

/** A route as a regular expression for the paths it matches: `:name` is one segment, `:name?` an optional last one. */
export function routePattern(page: string): RegExp {
  const parts = page
    .split('/')
    .slice(1)
    .map((segment) => (segment.startsWith(':') ? (segment.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+') : `/${segment}`));
  return new RegExp(`^${parts.join('') || '/'}$`);
}

/** Whether the person is at a place: on its page, and on its tab when it has one. */
export function atPlace(place: StepPlace, path: string, openTab: string | null): boolean {
  const tidy = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return routePattern(place.page).test(tidy) && (!place.tab || openTab === place.tab);
}

/** The pages of one election: its ballot, its results, and its editor and preview in the admin console. */
const ELECTION_PAGES = [/^\/ballot\/([^/]+)$/, /^\/results\/([^/]+)$/, /^\/admin\/elections\/([^/]+)(?:\/preview)?$/];

/** The election a path is a page of, if any. */
export function electionOfPath(path: string): string | null {
  for (const pattern of ELECTION_PAGES) {
    const match = pattern.exec(path.replace(/\/+$/, ''));
    if (match) {
      try {
        return decodeURIComponent(match[1]!);
      } catch {
        return null; // not a path the router could have made
      }
    }
  }
  return null;
}

/** A walkthrough under way in this browser tab. */
export interface TourProgress {
  readonly tour: TourId;
  /** The step's index. */
  readonly step: number;
  /** The last election whose page was opened during it, so later steps can open that election's pages. */
  readonly election: string | null;
  /** The panel shows only the step's name and the buttons. */
  readonly folded: boolean;
}

/**
 * Kept in sessionStorage, as the test persona is (acting.ts): a reload keeps the walkthrough, each tab can follow its
 * own, and closing the tab ends it. Nothing of it is sent anywhere.
 */
const KEY = 'ustp-guide';

const stepCount = (tour: TourId) => TOURS[tour].steps.length;

export function parseProgress(value: unknown): TourProgress | null {
  const p = value as Partial<TourProgress> | null;
  if (!p || typeof p !== 'object' || !TOUR_IDS.includes(p.tour as TourId)) return null;
  const tour = p.tour as TourId;
  const step = Number.isInteger(p.step) && p.step! >= 0 && p.step! < stepCount(tour) ? p.step! : 0;
  return { tour, step, election: typeof p.election === 'string' ? p.election : null, folded: p.folded === true };
}

function stored(): TourProgress | null {
  try {
    return parseProgress(JSON.parse(sessionStorage.getItem(KEY) ?? 'null'));
  } catch {
    return null; // storage blocked or unreadable
  }
}

/** The walkthrough this tab is following, if any. */
export const guide = reactive<{ progress: TourProgress | null; openTab: string | null }>({
  progress: stored(),
  /** The admin console's open tab, which the console sets while it is shown: tab steps are on the page only then. */
  openTab: null,
});

function save(progress: TourProgress | null): void {
  guide.progress = progress;
  try {
    if (progress) sessionStorage.setItem(KEY, JSON.stringify(progress));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: the walkthrough lasts until the page is reloaded
  }
}

export function startTour(tour: TourId, step = 0): void {
  save({ tour, step: Math.min(Math.max(step, 0), stepCount(tour) - 1), election: guide.progress?.election ?? null, folded: false });
}

export function goToStep(step: number): void {
  const p = guide.progress;
  if (p && step >= 0 && step < stepCount(p.tour)) save({ ...p, step });
}

export function foldPanel(folded: boolean): void {
  if (guide.progress) save({ ...guide.progress, folded });
}

/** Remembers the election whose page was just opened. */
export function noteElection(path: string): void {
  const election = electionOfPath(path);
  if (guide.progress && election && election !== guide.progress.election) save({ ...guide.progress, election });
}

export function endTour(): void {
  save(null);
}
