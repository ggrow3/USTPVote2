import { describe, expect, it } from 'vitest';
import { courseMapLayout, MAP_GEOMETRY, statusText } from './course-map.js';

const { cardWidth: w, cardHeight: h, columnGap: gx, rowGap: gy } = MAP_GEOMETRY;
const course = (courseId: string, row: number | null, column = 0, prerequisites: string[] = []) => ({
  courseId,
  title: courseId,
  prerequisites,
  position: row === null ? null : { row, column },
});

describe('the course map', () => {
  it('places cards on the grid and leaves out courses off the map', () => {
    const layout = courseMapLayout([course('top', 0, 1), course('left', 1, 0, ['top']), course('hidden', null)]);
    expect(layout.cards.map((card) => [card.course.courseId, card.x, card.y])).toEqual([
      ['top', w + gx, 0],
      ['left', 0, h + gy],
    ]);
    expect(layout.width).toBe(2 * w + gx);
    expect(layout.height).toBe(2 * h + gy);
  });

  it('runs a line down from a course, across the gap and down into the one after it', () => {
    const layout = courseMapLayout([course('top', 0, 1), course('left', 1, 0, ['top'])]);
    expect(layout.lines).toEqual([{ from: 'top', to: 'left', path: `M ${w + gx + w / 2} ${h} V ${h + gy / 2} H ${w / 2} V ${h + gy}` }]);
  });

  it('joins courses on the same row side to side, and skips a prerequisite that is off the map', () => {
    const layout = courseMapLayout([course('allies', 1, 1), course('coalition', 1, 0, ['allies', 'hidden']), course('hidden', null)]);
    expect(layout.lines).toEqual([{ from: 'allies', to: 'coalition', path: `M ${w + gx} ${h + gy + h / 2} H ${w}` }]);
  });

  it('is empty with no course on the map', () => {
    expect(courseMapLayout([course('hidden', null)])).toMatchObject({ width: 0, height: 0, cards: [], lines: [] });
  });
});

describe("a learner's card", () => {
  const titles = new Map([['fundamentals', 'The Fundamentals']]);
  it('says where the learner stands', () => {
    const status = { courseId: 'c', lessonsPassed: 2, lessonCount: 6, missing: [] };
    expect(statusText(undefined, false, titles)).toBe('Coming soon');
    expect(statusText(undefined, true, titles)).toBe('Open to everyone');
    expect(statusText({ ...status, state: 'in_progress' }, true, titles)).toBe('2 of 6 lessons passed');
    expect(statusText({ ...status, state: 'not_started' }, true, titles)).toBe('6 lessons');
    expect(statusText({ ...status, state: 'passed' }, true, titles)).toBe('Passed');
    expect(statusText({ ...status, state: 'locked', missing: ['fundamentals'] }, true, titles)).toBe('Quizzes open after The Fundamentals');
    expect(statusText({ ...status, state: 'locked', missing: ['fundamentals'] }, true, titles, { onMap: true })).toBe('Quizzes open after the course before it');
    expect(statusText({ ...status, state: 'locked', missing: ['a', 'b'] }, true, titles, { onMap: true })).toBe('Quizzes open after the 2 courses before it');
  });
});
