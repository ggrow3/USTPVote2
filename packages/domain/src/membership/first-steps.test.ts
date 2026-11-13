import { describe, expect, it } from 'vitest';
import { firstStepsLeft, firstStepsList, firstStepsProgress } from './first-steps.js';

const menu = ['ballot', 'course', 'teams', 'forum', 'room'] as const;

describe('a new member’s first steps', () => {
  it('lists what the member can reach, in order, ticking what is done', () => {
    const items = firstStepsList({ memberSince: '2026-11-01T00:00:00.000Z', done: ['team', 'voted'] }, menu);
    expect(items.map((i) => [i.step, i.done])).toEqual([
      ['course', false],
      ['team', true],
      ['room', false],
      ['posted', false],
      ['voted', true],
    ]);
    expect(items[0]).toMatchObject({ to: '/courses', label: 'Take a first course' });
    expect(firstStepsProgress(items)).toBe('2 of 5 done');
    expect(firstStepsLeft(items)).toBe(true);
  });

  it('leaves out a step whose page the navigation settings hide', () => {
    const items = firstStepsList({ memberSince: '2026-11-01T00:00:00.000Z', done: [] }, ['ballot', 'course']);
    expect(items.map((i) => i.step)).toEqual(['course', 'voted']);
  });

  it('is empty for someone who is not a member, and finished when all is done', () => {
    expect(firstStepsList({ memberSince: null, done: [] }, menu)).toEqual([]);
    const all = firstStepsList({ memberSince: '2026-11-01T00:00:00.000Z', done: ['course', 'team', 'room', 'posted', 'voted'] }, menu);
    expect(firstStepsLeft(all)).toBe(false);
  });
});
