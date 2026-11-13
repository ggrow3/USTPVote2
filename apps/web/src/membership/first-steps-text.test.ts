import { describe, expect, it } from 'vitest';
import { DEFAULT_FIRST_STEPS, FIRST_STEP_ID, firstStepsList, type FirstStepSetting } from 'ustp-domain';
import { firstStepsCaption, newFirstStepId } from './first-steps-text.js';

const menu = ['ballot', 'course', 'teams', 'forum', 'room'] as const;
const bylaws: FirstStepSetting = { id: 'bylaws', label: 'Read the bylaws', why: '', link: '/bylaws', check: 'self' };
const items = (steps: readonly FirstStepSetting[], ticked: string[] = []) =>
  firstStepsList({ memberSince: '2026-11-01T00:00:00.000Z', done: ['team'], steps, ticked }, menu);

describe('the getting started list’s words', () => {
  it('say how many are done and how the steps on it get ticked', () => {
    expect(firstStepsCaption(items(DEFAULT_FIRST_STEPS.steps))).toBe('1 of 5 done. Each is ticked once you have done it.');
    expect(firstStepsCaption(items([bylaws], ['bylaws']))).toBe('1 of 1 done. Tick each box once you have done that step.');
    expect(firstStepsCaption(items([bylaws, DEFAULT_FIRST_STEPS.steps[1]!]))).toBe(
      '1 of 2 done. Tick a box yourself once you have done that step; the others are ticked once you have done them.',
    );
  });

  it('give a new step an id the API takes, not one already on the list', () => {
    const id = newFirstStepId(['course']);
    expect(id).toMatch(FIRST_STEP_ID);
    expect(id).not.toBe('course');
  });
});
