import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_NAVIGATION, SECTION_ROLES } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import {
  atPlace,
  electionOfPath,
  endTour,
  goToStep,
  guide,
  noteElection,
  parseProgress,
  routePattern,
  startTour,
  stepAddress,
  stepDone,
  stepPlace,
  TOUR_IDS,
  type TourStep,
} from './tour.js';
import { TOURS } from './tours.js';

const SRC = join(import.meta.dirname, '..');
const steps = TOUR_IDS.flatMap((id) => TOURS[id].steps.map((step) => ({ tour: TOURS[id], step })));

/** A route with its parameters unnamed, so `/ballot/:election` and `/ballot/:id` compare equal. */
const unnamed = (page: string) => page.replace(/:\w+/g, ':');

describe('the walkthroughs', () => {
  it('cover a Voter, an Election Admin and an Auditor, each step named once in its tour', () => {
    expect(TOUR_IDS.map((id) => TOURS[id].id)).toEqual(['voter', 'election_admin', 'auditor']);
    for (const id of TOUR_IDS) {
      const ids = TOURS[id].steps.map((s) => s.id);
      expect(ids.length, id).toBeGreaterThan(5);
      expect(new Set(ids).size, id).toBe(ids.length);
      for (const s of TOURS[id].steps) expect(s.todo.length, `${id} ${s.id}`).toBeGreaterThan(0);
    }
  });

  // Every page in router.ts, as a full route: its children are written without the leading slash.
  const router = readFileSync(join(SRC, 'router.ts'), 'utf8');
  const routes = [...router.slice(router.indexOf('routes: ['), router.indexOf('router.beforeEach')).matchAll(/path: '([^']*)'(?!, redirect)/g)]
    .map((m) => m[1]!)
    .filter((path) => path !== '/' && !path.startsWith('/:pathMatch'))
    .map((path) => unnamed(`/${path}`));

  it('are on pages the router has, the Guide among them', () => {
    expect(routes).toContain('/guide');
    for (const { tour, step } of steps) {
      expect(routes, `${tour.id} ${step.id}`).toContain(unnamed(step.page));
      if (step.pick) expect(routes, `${tour.id} ${step.id} pick`).toContain(unnamed(step.pick.page));
    }
  });

  it('say where to pick the election for every step on an election’s page', () => {
    for (const { tour, step } of steps) {
      if (!step.page.includes(':election')) continue;
      expect(step.pick, `${tour.id} ${step.id}`).toBeDefined();
      expect(step.pick!.page).not.toContain(':');
    }
  });

  it('use only admin tabs their role is shown by default', () => {
    for (const { tour, step } of steps) {
      for (const tab of [step.tab, step.pick?.tab]) {
        if (!tab) continue;
        expect(tour.role, `${tour.id} ${step.id}`).not.toBeNull();
        expect(SECTION_ROLES[tab], `${tour.id} ${step.id}`).toContain(tour.role);
        expect(DEFAULT_NAVIGATION.sections[tour.role!][tab], `${tour.id} ${step.id}`).toBe(true);
      }
    }
  });

  /** The web app's own source, but the Guide and the tests, with its spacing and `&amp;` as a page shows them. */
  const appText = (function read(dir: string): string {
    return readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'guide' ? '' : read(path);
        return /\.(vue|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? readFileSync(path, 'utf8') : '';
      })
      .join('\n');
  })(SRC)
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

  it('quote labels the pages still show', () => {
    const texts = steps.flatMap(({ step }) => [step.title, step.about, ...step.todo, ...(step.notes ?? []), step.pick?.how ?? '']);
    const quoted = [...new Set(texts.flatMap((text) => [...text.matchAll(/“([^”]+)”/g)].map((m) => m[1]!)))];
    expect(quoted.length).toBeGreaterThan(40);
    for (const label of quoted) expect(appText.includes(label), label).toBe(true);
  });
});

const step = (page: string, extra: Partial<TourStep> = {}): TourStep => ({ id: 's', title: 'A step', page, about: '', todo: ['x'], ...extra });

describe('stepAddress', () => {
  const cast = step('/ballot/:election', { pick: { page: '/ballot', title: 'Your ballots', how: 'Pick it.' } });

  it('opens the election the walkthrough follows, or the list to pick it from', () => {
    expect(stepAddress(cast, 'e 1')).toEqual({ path: '/ballot/e%201' });
    expect(stepAddress(cast, null)).toEqual({ path: '/ballot' });
    expect(stepPlace(cast, null)).toBe(cast.pick);
    expect(stepPlace(cast, 'e1')).toBe(cast);
  });

  it('opens an admin tab by the query the console reads', () => {
    expect(stepAddress(step('/admin', { tab: 'approvals' }), null)).toEqual({ path: '/admin', query: { tab: 'approvals' } });
    const editor = step('/admin/elections/:election', { pick: { page: '/admin', tab: 'elections', title: 'Admin › Elections', how: '' } });
    expect(stepAddress(editor, null)).toEqual({ path: '/admin', query: { tab: 'elections' } });
    expect(stepAddress(editor, 'e1')).toEqual({ path: '/admin/elections/e1' });
  });
});

describe('stepDone', () => {
  it('is signing in, for someone signed in', () => {
    expect(stepDone(TOURS.voter.steps[0]!, true)).toBe(true);
    expect(stepDone(TOURS.voter.steps[0]!, false)).toBe(false);
    expect(stepDone(TOURS.voter.steps[1]!, true)).toBe(false);
  });
});

describe('atPlace', () => {
  it('matches the page, any election, and the tab when the step has one', () => {
    expect(atPlace(step('/ballot/:election'), '/ballot/abc', null)).toBe(true);
    expect(atPlace(step('/ballot/:election'), '/ballot', null)).toBe(false);
    expect(atPlace(step('/ballot'), '/ballot/', null)).toBe(true);
    expect(atPlace(step('/admin', { tab: 'audit' }), '/admin', 'audit')).toBe(true);
    expect(atPlace(step('/admin', { tab: 'audit' }), '/admin', 'approvals')).toBe(false);
    expect(atPlace(step('/admin', { tab: 'audit' }), '/admin', null)).toBe(false);
    expect(atPlace(step('/admin/elections/:election'), '/admin/elections/e1/preview', null)).toBe(false);
  });

  it('reads optional parameters as the router does', () => {
    expect(routePattern('/bylaws/:version?').test('/bylaws')).toBe(true);
    expect(routePattern('/bylaws/:version?').test('/bylaws/3')).toBe(true);
    expect(routePattern('/').test('/')).toBe(true);
  });
});

describe('electionOfPath', () => {
  it('finds the election of its ballot, results, editor and preview', () => {
    expect(electionOfPath('/ballot/e1')).toBe('e1');
    expect(electionOfPath('/results/e%201')).toBe('e 1');
    expect(electionOfPath('/admin/elections/e1')).toBe('e1');
    expect(electionOfPath('/admin/elections/e1/preview/')).toBe('e1');
  });

  it('finds none elsewhere, or in a path the router could not have made', () => {
    expect(electionOfPath('/ballot')).toBeNull();
    expect(electionOfPath('/admin')).toBeNull();
    expect(electionOfPath('/results/%E0')).toBeNull();
  });
});

describe('the walkthrough under way', () => {
  it('is read back only as a known tour, at a step it has', () => {
    expect(parseProgress({ tour: 'auditor', step: 2, election: 'e1', folded: true })).toEqual({
      tour: 'auditor',
      step: 2,
      election: 'e1',
      folded: true,
    });
    expect(parseProgress({ tour: 'system_admin', step: 0 })).toBeNull();
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress({ tour: 'voter', step: 99, election: 5 })).toEqual({ tour: 'voter', step: 0, election: null, folded: false });
  });

  it('starts, moves, remembers the election opened and ends', () => {
    startTour('election_admin', 3);
    expect(guide.progress).toEqual({ tour: 'election_admin', step: 3, election: null, folded: false });
    noteElection('/admin');
    expect(guide.progress?.election).toBeNull();
    noteElection('/admin/elections/e1');
    expect(guide.progress?.election).toBe('e1');
    goToStep(4);
    goToStep(TOURS.election_admin.steps.length);
    expect(guide.progress?.step).toBe(4);
    // Another walkthrough in the same tab keeps following the same election.
    startTour('auditor');
    expect(guide.progress).toEqual({ tour: 'auditor', step: 0, election: 'e1', folded: false });
    endTour();
    expect(guide.progress).toBeNull();
  });
});
