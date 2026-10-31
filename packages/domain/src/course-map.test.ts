import { describe, expect, it } from 'vitest';
import {
  courseIdFromTitle,
  courseMapSchema,
  coursePlacementProblem,
  isCourseId,
  learnerCourseState,
  missingPrerequisites,
  placementOf,
  type CoursePlacement,
} from './course-map.js';

const course = (courseId: string, prerequisites: readonly string[] = [], position: CoursePlacement['position'] = null) => ({
  courseId,
  title: courseId.toUpperCase(),
  prerequisites,
  position,
});

describe('course IDs', () => {
  it('accepts lower-case words joined by single hyphens, and nothing that could be a database path', () => {
    expect(isCourseId('transhumanism')).toBe(true);
    expect(isCourseId('why-the-new-york-transhumanist-party')).toBe(true);
    for (const bad of ['', 'a/b', 'a%2Fb', '-a', 'a-', 'a--b', 'A', 'a_b', 'x'.repeat(65)]) expect(isCourseId(bad), bad).toBe(false);
  });

  it('makes an ID from a title: its words, lower case, accents dropped, at most 64 characters', () => {
    expect(courseIdFromTitle('Why the New York Transhumanist Party?')).toBe('why-the-new-york-transhumanist-party');
    expect(courseIdFromTitle('  Révolution & Futures 101 ')).toBe('revolution-futures-101');
    expect(courseIdFromTitle('???')).toBe('course');
    const long = courseIdFromTitle('word '.repeat(30));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(isCourseId(long)).toBe(true);
  });
});

describe('placing a course on the map', () => {
  const courses = [course('a', [], { row: 0, column: 0 }), course('b', ['a'], { row: 1, column: 0 }), course('c', ['b'], { row: 2, column: 0 })];

  it('allows a course after others, on a free square', () => {
    expect(coursePlacementProblem(courses, 'c', { prerequisites: ['a', 'b'], position: { row: 2, column: 1 } })).toBeNull();
    expect(coursePlacementProblem(courses, 'c', { prerequisites: [], position: null })).toBeNull();
  });

  it('refuses a loop, naming the courses in the order they would have to be passed', () => {
    expect(coursePlacementProblem(courses, 'a', { prerequisites: ['c'], position: { row: 0, column: 0 } })).toBe(
      'that makes a loop nobody could finish: A → B → C → A',
    );
    expect(coursePlacementProblem(courses, 'a', { prerequisites: ['a'], position: null })).toBe('a course cannot come before itself');
  });

  it('refuses an unknown course and a square another course has', () => {
    expect(coursePlacementProblem(courses, 'c', { prerequisites: ['nope'], position: null })).toBe('there is no course "nope"');
    expect(coursePlacementProblem(courses, 'c', { prerequisites: ['b'], position: { row: 1, column: 0 } })).toBe('B is already on the map at row 2, column 1');
  });

  it('checks the shape: known limits, no course named twice', () => {
    expect(courseMapSchema.safeParse({ prerequisites: ['a', 'a'], position: null }).success).toBe(false);
    expect(courseMapSchema.safeParse({ prerequisites: ['a/b'], position: null }).success).toBe(false);
    expect(courseMapSchema.safeParse({ prerequisites: [], position: { row: 8, column: 0 } }).success).toBe(false);
    expect(courseMapSchema.safeParse({ prerequisites: ['a', 'b', 'c', 'd', 'e', 'f'], position: null }).success).toBe(false);
    expect(courseMapSchema.safeParse({ prerequisites: ['a'], position: { row: 7, column: 5 } }).success).toBe(true);
  });

  it('reads a course saved before the map as standing alone, off it', () => {
    expect(placementOf({})).toEqual({ prerequisites: [], position: null });
  });
});

describe('a learner in a course', () => {
  it('is locked while a prerequisite is missing, unless already passed', () => {
    const missing = missingPrerequisites(['a', 'b'], new Set(['b']));
    expect(missing).toEqual(['a']);
    expect(learnerCourseState({ passed: false, missing, started: true })).toBe('locked');
    expect(learnerCourseState({ passed: true, missing, started: true })).toBe('passed');
    expect(learnerCourseState({ passed: false, missing: [], started: true })).toBe('in_progress');
    expect(learnerCourseState({ passed: false, missing: [], started: false })).toBe('not_started');
  });
});
