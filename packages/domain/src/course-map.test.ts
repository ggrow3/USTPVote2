import { describe, expect, it } from 'vitest';
import {
  courseBoardProblem,
  courseBoardSchema,
  courseHidingProblem,
  courseIdFromTitle,
  courseMapSchema,
  coursePlacementProblem,
  courseVisibilitySchema,
  orgChartPositions,
  withBoardChanges,
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

  it('refuses a shown course after a hidden one, but lets a hidden course come after either', () => {
    const map = [{ ...course('a', [], { row: 0, column: 0 }), hidden: true }, course('b'), { ...course('c'), hidden: true }];
    expect(coursePlacementProblem(map, 'b', { prerequisites: ['a'], position: null })).toBe(
      'A is hidden from the Courses page, so a course shown there cannot come after it: show it first',
    );
    expect(coursePlacementProblem(map, 'c', { prerequisites: ['a', 'b'], position: null })).toBeNull();
    expect(coursePlacementProblem([course('a'), course('b')], 'b', { prerequisites: ['a'], position: null })).toBeNull();
  });
});

describe('hiding a course from the Courses page (design §10.8)', () => {
  it('refuses while a shown course comes after it, naming them, and never refuses showing one', () => {
    const map = [course('a'), course('b', ['a']), course('c', ['a']), { ...course('d', ['b']), hidden: true }, course('e', ['a'])];
    expect(courseHidingProblem(map, 'a', true)).toBe(
      'B, C and E come after this course and are shown on the Courses page: hide them first, or take this course off their prerequisites',
    );
    expect(courseHidingProblem(map, 'b', true)).toBeNull();
    expect(courseHidingProblem(map.slice(0, 2), 'a', true)).toBe(
      'B comes after this course and is shown on the Courses page: hide it first, or take this course off its prerequisites',
    );
    expect(courseHidingProblem(map, 'a', false)).toBeNull();
  });

  it('takes a yes or no, and nothing else', () => {
    expect(courseVisibilitySchema.parse({ hidden: true })).toEqual({ hidden: true });
    expect(courseVisibilitySchema.safeParse({ hidden: 'yes' }).success).toBe(false);
    expect(courseVisibilitySchema.safeParse({ hidden: false, title: 'x' }).success).toBe(false);
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

describe('saving the board (design §10.8)', () => {
  const map = [course('a', [], { row: 0, column: 0 }), course('b', ['a'], { row: 1, column: 0 }), course('c', [], null)];

  it('takes the courses that changed, each once', () => {
    const change = { courseId: 'a', prerequisites: [], position: { row: 0, column: 1 } };
    expect(courseBoardSchema.parse({ courses: [change] })).toEqual({ courses: [change] });
    expect(courseBoardSchema.safeParse({ courses: [] }).success).toBe(false);
    expect(courseBoardSchema.safeParse({ courses: [change, change] }).success).toBe(false);
    expect(courseBoardSchema.safeParse({ courses: [{ ...change, courseId: 'a/b' }] }).success).toBe(false);
  });

  it('lets two courses swap squares in one save', () => {
    const swap = [
      { courseId: 'a', prerequisites: [], position: { row: 1, column: 0 } },
      { courseId: 'b', prerequisites: ['a'], position: { row: 0, column: 0 } },
    ];
    expect(courseBoardProblem(map, swap)).toBeNull();
    expect(withBoardChanges(map, swap).map((c) => c.position)).toEqual([{ row: 1, column: 0 }, { row: 0, column: 0 }, null]);
    // Either move alone would put two courses on one square.
    expect(courseBoardProblem(map, [swap[0]!])).toBe('B is already on the map at row 2, column 1');
  });

  it('refuses a loop made across the courses changed, and a course that does not exist', () => {
    expect(courseBoardProblem(map, [{ courseId: 'a', prerequisites: ['b'], position: { row: 0, column: 0 } }])).toBe(
      'that makes a loop nobody could finish: A → B → A',
    );
    expect(courseBoardProblem(map, [{ courseId: 'zz', prerequisites: [], position: null }])).toBe('there is no course "zz"');
  });
});

describe('arranging the map as an org chart', () => {
  const at = (row: number, column: number) => ({ row, column });
  const arrange = (courses: Parameters<typeof orgChartPositions>[0]) => {
    const result = orgChartPositions(courses);
    if ('problem' in result) throw new Error(result.problem);
    return Object.fromEntries(result.positions);
  };

  it("lays out the party's map with each course under the one before it", () => {
    // As seeded (course-map-seed.ts), The Coalition beside Allies.
    const party = [
      course('transhumanism', [], at(0, 0)),
      course('fundamental-questions', [], at(0, 2)),
      course('the-coalition', ['allies'], at(1, 0)),
      course('allies', ['fundamental-questions'], at(1, 1)),
      course('transhumanist-party', ['fundamental-questions'], at(1, 2)),
      course('new-york-transhumanist-party', ['fundamental-questions'], at(1, 3)),
      course('figures-of-transhumanism', ['transhumanist-party'], at(2, 1)),
      course('why-the-transhumanist-party', ['transhumanist-party'], at(2, 2)),
      course('why-the-new-york-transhumanist-party', ['new-york-transhumanist-party'], at(2, 3)),
    ];
    expect(arrange(party)).toEqual({
      transhumanism: at(0, 0),
      'fundamental-questions': at(0, 2),
      allies: at(1, 1),
      'transhumanist-party': at(1, 2),
      'new-york-transhumanist-party': at(1, 4),
      'the-coalition': at(2, 1),
      'figures-of-transhumanism': at(2, 2),
      'why-the-transhumanist-party': at(2, 3),
      'why-the-new-york-transhumanist-party': at(2, 4),
    });
  });

  it('puts a course below every course before it, under the one it names first on the row above', () => {
    const chart = arrange([
      course('a', [], at(5, 5)),
      course('b', ['a'], at(0, 0)),
      course('c', ['a', 'b'], at(0, 1)),
      course('off', ['a'], null),
    ]);
    expect(chart).toEqual({ a: at(0, 0), b: at(1, 0), c: at(2, 0) });
  });

  it('keeps siblings in the order they had, left to right', () => {
    const chart = arrange([course('top', [], at(0, 0)), course('right', ['top'], at(3, 4)), course('left', ['top'], at(3, 1))]);
    expect(chart).toEqual({ top: at(0, 0), left: at(1, 0), right: at(1, 1) });
  });

  it('squeezes a chart wider than the map into its columns, row by row', () => {
    // Seven courses with none after them, but at most five on any row.
    const wide = [
      course('r1', [], at(0, 0)),
      course('r2', [], at(0, 1)),
      ...['a', 'b', 'c'].map((id, i) => course(id, ['r1'], at(1, i))),
      ...['a1', 'a2'].map((id, i) => course(id, ['a'], at(2, i))),
      ...['c1', 'c2', 'c3'].map((id, i) => course(id, ['c'], at(2, 2 + i))),
    ];
    const chart = arrange(wide);
    for (const row of [0, 1, 2]) {
      const columns = Object.entries(chart).filter(([, p]) => p.row === row).map(([, p]) => p.column);
      expect(new Set(columns).size, `row ${row}`).toBe(columns.length);
      expect(Math.max(...columns)).toBeLessThan(6);
    }
    expect(chart.a1!.column).toBeLessThan(chart.c3!.column);
    expect(chart.r1!.column).toBeLessThan(chart.r2!.column);

    const crowded = [...wide, ...['a3', 'a4'].map((id, i) => course(id, ['a'], at(3, i)))];
    expect(orgChartPositions(crowded)).toEqual({ problem: "7 courses would sit side by side, more than the map's 6 columns" });
  });

  it('refuses a chart deeper than the map', () => {
    const chain = Array.from({ length: 9 }, (_, i) => course(`c${i}`, i ? [`c${i - 1}`] : [], at(0, i % 6)));
    expect(orgChartPositions(chain.map((c, i) => ({ ...c, position: at(i % 8, i % 6) })))).toEqual({
      problem: "the chart would be 9 courses deep, more than the map's 8 rows",
    });
  });
});
