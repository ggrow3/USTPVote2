import { describe, expect, it } from 'vitest';
import {
  checkFirstSteps,
  checkFirstStepTick,
  DEFAULT_FIRST_STEPS,
  FIRST_STEPS_LIMITS,
  firstStepLinkProblem,
  firstStepMenu,
  firstStepsDiffer,
  firstStepsLeft,
  firstStepsList,
  firstStepsProgress,
  firstStepsSettingsSchema,
  nextFirstStepTicks,
  ownTicks,
  resolveFirstSteps,
  type FirstStepSetting,
  type FirstStepsView,
} from './first-steps.js';

const menu = ['ballot', 'course', 'teams', 'forum', 'room'] as const;
const SINCE = '2026-11-01T00:00:00.000Z';
const bylaws: FirstStepSetting = { id: 'bylaws', label: 'Read the bylaws', why: 'How the party is run.', link: '/bylaws', check: 'self' };
const social: FirstStepSetting = { id: 'social', label: 'Follow us', why: '', link: 'https://example.org/ustp', check: 'self' };

const view = (over: Partial<FirstStepsView> = {}): FirstStepsView => ({ memberSince: SINCE, done: [], steps: DEFAULT_FIRST_STEPS.steps, ticked: [], ...over });
const ok = (steps: readonly FirstStepSetting[]) => checkFirstSteps({ steps });
const reason = (steps: readonly FirstStepSetting[]) => {
  const check = ok(steps);
  return check.ok ? null : check.reason;
};

describe('a new member’s first steps', () => {
  it('lists the default steps they can reach, in order, ticking what is done', () => {
    const items = firstStepsList(view({ done: ['team', 'voted'] }), menu);
    expect(items.map((i) => [i.id, i.done])).toEqual([
      ['course', false],
      ['team', true],
      ['room', false],
      ['posted', false],
      ['voted', true],
    ]);
    expect(items[0]).toMatchObject({ link: '/courses', label: 'Take a first course', external: false });
    expect(firstStepsProgress(items)).toBe('2 of 5 done');
    expect(firstStepsLeft(items)).toBe(true);
  });

  it('leaves out a step whose page the navigation settings hide', () => {
    const items = firstStepsList(view(), ['ballot', 'course']);
    expect(items.map((i) => i.id)).toEqual(['course', 'voted']);
  });

  it('is empty for someone who is not a member, and finished when all is done', () => {
    expect(firstStepsList(view({ memberSince: null }), menu)).toEqual([]);
    const all = firstStepsList(view({ done: ['course', 'team', 'room', 'posted', 'voted'] }), menu);
    expect(firstStepsLeft(all)).toBe(false);
  });

  it('shows the steps Membership Admins set, ticking their own steps from the member’s ticks', () => {
    const steps = [bylaws, { ...DEFAULT_FIRST_STEPS.steps[1]!, label: 'Find your team' }, social];
    const items = firstStepsList(view({ steps, done: ['team'], ticked: ['social'] }), menu);
    expect(items.map((i) => [i.id, i.label, i.done, i.external])).toEqual([
      ['bylaws', 'Read the bylaws', false, false],
      ['team', 'Find your team', true, false],
      ['social', 'Follow us', true, true],
    ]);
    // A tick never counts for a step the site ticks, nor a record for a step the member ticks.
    expect(firstStepsList(view({ steps, ticked: ['team', 'bylaws'] }), menu).map((i) => i.done)).toEqual([true, false, false]);
    expect(firstStepsList(view({ steps: [] }), menu)).toEqual([]);
  });

  it('reads an answer from before the list could be set as no list rather than failing', () => {
    const old = { memberSince: SINCE, done: ['team'] } as unknown as FirstStepsView;
    expect(firstStepsList(old, menu)).toEqual([]);
  });
});

describe('the getting started settings', () => {
  it('start as the default list, which can be saved as it is', () => {
    expect(resolveFirstSteps(undefined)).toBe(DEFAULT_FIRST_STEPS);
    expect(resolveFirstSteps({})).toBe(DEFAULT_FIRST_STEPS);
    expect(ok(DEFAULT_FIRST_STEPS.steps)).toEqual({ ok: true });
    expect(DEFAULT_FIRST_STEPS.steps.map((s) => s.check)).toEqual(['course', 'team', 'room', 'posted', 'voted']);
  });

  it('tidy what was saved and drop a step that cannot be read', () => {
    const stored = { steps: [{ ...bylaws, label: '  Read  the\n bylaws ', why: undefined, link: ' /bylaws ' }, { id: 'x', label: 'X', link: '/x', check: 'teleport' }, 'junk'] };
    expect(resolveFirstSteps(stored)).toEqual({ steps: [{ ...bylaws, why: '' }] });
    expect(resolveFirstSteps({ steps: [] })).toEqual({ steps: [] });
  });

  it('allow no steps at all, and at most ten', () => {
    expect(ok([])).toEqual({ ok: true });
    const many = Array.from({ length: FIRST_STEPS_LIMITS.steps + 1 }, (_, i) => ({ ...bylaws, id: `s${i}` }));
    expect(ok(many.slice(0, FIRST_STEPS_LIMITS.steps))).toEqual({ ok: true });
    expect(reason(many)).toBe('list at most 10 steps');
  });

  it('need words, a link and an id of each step’s own, within their limits', () => {
    expect(reason([{ ...bylaws, label: '' }])).toBe('Step 1 needs its words');
    expect(reason([bylaws, { ...social, label: 'x'.repeat(81) }])).toBe("Step 2's words can be at most 80 characters");
    expect(reason([{ ...bylaws, why: 'x'.repeat(241) }])).toBe("Step 1's explanation can be at most 240 characters");
    expect(reason([{ ...bylaws, link: '' }])).toBe('Step 1: a step needs a link');
    expect(reason([bylaws, { ...social, id: 'bylaws' }])).toBe('Steps 1 and 2 have the same id');
    expect(reason([{ ...bylaws, id: 'Not An Id' }])).toBe('Step 1 has no usable id');
  });

  it('let each of the site’s checks tick one step, and the member tick any number', () => {
    const team = DEFAULT_FIRST_STEPS.steps[1]!;
    expect(reason([team, bylaws, { ...team, id: 'team-2' }])).toBe(
      'Steps 1 and 3 are both ticked when they join a team: each check can tick one step',
    );
    expect(ok([bylaws, social, { ...bylaws, id: 'press', link: '/press' }])).toEqual({ ok: true });
  });

  it('take a page on this site or an https:// address as a link', () => {
    for (const link of ['/courses', '/course/intro?lesson=2#quiz', '/bylaws', 'https://transhumanist-party.org/join']) {
      expect(firstStepLinkProblem(link)).toBeNull();
    }
    expect(firstStepLinkProblem('http://example.org')).toBe('use the https:// address');
    for (const link of ['//evil.example', '/a\\b', 'javascript:alert(1)', 'mailto:a@example.org', 'courses', 'https://']) {
      expect(firstStepLinkProblem(link)).toBe('use a page on this site, starting with /, or an https:// address');
    }
    expect(firstStepLinkProblem('/a b')).toBe('a link cannot contain spaces');
    expect(firstStepLinkProblem(`/${'a'.repeat(300)}`)).toBe('a link can be at most 300 characters');
  });

  it('know which menu link a step’s page needs', () => {
    expect(firstStepMenu('/courses')).toBe('course');
    expect(firstStepMenu('/course/abc')).toBe('course');
    expect(firstStepMenu('/teams/t1')).toBe('teams');
    expect(firstStepMenu('/forum?sort=new')).toBe('forum');
    expect(firstStepMenu('/bylaws')).toBeNull();
    expect(firstStepMenu('https://example.org/room')).toBeNull();
  });

  it('notice any change of words, link, check or order', () => {
    const steps = DEFAULT_FIRST_STEPS.steps;
    expect(firstStepsDiffer(DEFAULT_FIRST_STEPS, { steps: steps.map((s) => ({ ...s })) })).toBe(false);
    expect(firstStepsDiffer(DEFAULT_FIRST_STEPS, { steps: [...steps].reverse() })).toBe(true);
    expect(firstStepsDiffer(DEFAULT_FIRST_STEPS, { steps: steps.slice(1) })).toBe(true);
    expect(firstStepsDiffer(DEFAULT_FIRST_STEPS, { steps: [{ ...steps[0]!, check: 'self' }, ...steps.slice(1)] })).toBe(true);
  });

  it('are taken from an admin as a whole list with the version it was edited from', () => {
    expect(firstStepsSettingsSchema.safeParse({ basedOn: 0, steps: [bylaws] }).success).toBe(true);
    expect(firstStepsSettingsSchema.safeParse({ basedOn: 0, steps: [{ ...bylaws, check: 'teleport' }] }).success).toBe(false);
    expect(firstStepsSettingsSchema.safeParse({ basedOn: 0, steps: [{ ...bylaws, extra: 1 }] }).success).toBe(false);
  });
});

describe('a member’s own ticks', () => {
  const settings = { steps: [bylaws, DEFAULT_FIRST_STEPS.steps[0]!, social] };

  it('are only for a step on the list that the member ticks', () => {
    expect(checkFirstStepTick(settings, 'bylaws')).toEqual({ ok: true });
    expect(checkFirstStepTick(settings, 'course')).toEqual({ ok: false, reason: 'the site ticks this step once you have done it' });
    expect(checkFirstStepTick(settings, 'gone')).toMatchObject({ ok: false, refusal: 'not_found' });
  });

  it('add and remove a tick, dropping ticks of steps no longer on the list', () => {
    expect(nextFirstStepTicks(settings, [], 'bylaws', true)).toEqual(['bylaws']);
    expect(nextFirstStepTicks(settings, ['bylaws', 'old', 'course'], 'social', true)).toEqual(['bylaws', 'social']);
    expect(nextFirstStepTicks(settings, ['bylaws', 'social'], 'bylaws', false)).toEqual(['social']);
    expect(nextFirstStepTicks(settings, ['bylaws'], 'bylaws', true)).toEqual(['bylaws']);
    expect(ownTicks(settings, ['social', 'social', 'old'])).toEqual(['social']);
  });
});
