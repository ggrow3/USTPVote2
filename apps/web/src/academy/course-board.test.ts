import { describe, expect, it } from 'vitest';
import type { CoursePosition } from 'ustp-domain';
import {
  addLink,
  arrangeAsOrgChart,
  boardChanges,
  boardFrom,
  boardRows,
  boardSize,
  courseAt,
  linkText,
  moveCourse,
  nudgeCourse,
  removeLink,
  setPrerequisites,
  squareAt,
  type BoardCourse,
  type BoardEdit,
} from './course-board.js';

const at = (row: number, column: number): CoursePosition => ({ row, column });
const course = (courseId: string, prerequisites: string[] = [], position: CoursePosition | null = null): BoardCourse => ({
  courseId,
  title: courseId.toUpperCase(),
  prerequisites,
  position,
});
const SAVED = [course('a', [], at(0, 0)), course('b', ['a'], at(1, 0)), course('c', [], null)];

const boardOf = (edit: BoardEdit) => {
  if ('problem' in edit) throw new Error(edit.problem);
  return edit.board;
};
const where = (board: readonly BoardCourse[]) => Object.fromEntries(board.map((c) => [c.courseId, c.position]));

describe('the course board (design §10.8)', () => {
  it('moves a course to an empty square, swaps with a course already there, and takes one off the map', () => {
    expect(where(boardOf(moveCourse(SAVED, 'a', at(2, 3))))).toEqual({ a: at(2, 3), b: at(1, 0), c: null });
    expect(where(boardOf(moveCourse(SAVED, 'a', at(1, 0))))).toEqual({ a: at(1, 0), b: at(0, 0), c: null });
    expect(where(boardOf(moveCourse(SAVED, 'b', null)))).toEqual({ a: at(0, 0), b: null, c: null });
    expect(where(boardOf(moveCourse(SAVED, 'c', at(0, 1))))).toEqual({ a: at(0, 0), b: at(1, 0), c: at(0, 1) });
  });

  it('does not push a course off the map for one brought onto it', () => {
    expect(moveCourse(SAVED, 'c', at(0, 0))).toEqual({ problem: 'A is on that square: put C on an empty one' });
  });

  it('moves a course one square with the arrow keys, swapping, and stops at the edge', () => {
    expect(where(boardOf(nudgeCourse(SAVED, 'a', 0, 1)))).toMatchObject({ a: at(0, 1) });
    expect(where(boardOf(nudgeCourse(SAVED, 'a', 1, 0)))).toMatchObject({ a: at(1, 0), b: at(0, 0) });
    expect(where(boardOf(nudgeCourse(SAVED, 'a', -1, 0)))).toMatchObject({ a: at(0, 0) });
    expect(where(boardOf(nudgeCourse(SAVED, 'c', 1, 0)))).toMatchObject({ c: null });
  });

  it('draws a line from a course to the one after it, refusing loops, itself and a sixth course before one', () => {
    const linked = boardOf(addLink(SAVED, 'c', 'b'));
    expect(linked.find((c) => c.courseId === 'b')!.prerequisites).toEqual(['a', 'c']);
    expect(boardOf(addLink(linked, 'c', 'b'))).toEqual(linked);
    expect(addLink(SAVED, 'b', 'a')).toEqual({ problem: 'that makes a loop nobody could finish: A → B → A' });
    expect(addLink(SAVED, 'a', 'a')).toEqual({ problem: 'a course cannot come before itself' });
    const many = [...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => course(id)), course('x', ['p1', 'p2', 'p3', 'p4', 'p5'])];
    expect(addLink(many, 'p6', 'x')).toEqual({ problem: 'X already comes after 5 courses, the most a course may' });
    expect(setPrerequisites(many, 'x', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])).toEqual({ problem: 'X can come after at most 5 courses' });
  });

  it('removes a line, and says what a line means', () => {
    expect(removeLink(SAVED, 'a', 'b').find((c) => c.courseId === 'b')!.prerequisites).toEqual([]);
    expect(linkText(SAVED, 'a', 'b')).toBe('B comes after A');
  });

  it('arranges the map as an org chart, leaving courses off the map off it', () => {
    const board = [course('top', [], at(4, 4)), course('one', ['top'], at(0, 0)), course('two', ['top'], at(0, 1)), course('off', ['top'])];
    expect(where(boardOf(arrangeAsOrgChart(board)))).toEqual({ top: at(0, 0), one: at(1, 0), two: at(1, 1), off: null });
    const chain = Array.from({ length: 9 }, (_, i) => course(`c${i}`, i ? [`c${i - 1}`] : [], at(i % 8, i % 6)));
    expect(arrangeAsOrgChart(chain)).toEqual({
      problem: "Cannot arrange it as an org chart: the chart would be 9 courses deep, more than the map's 8 rows",
    });
  });

  it('lists the courses to save: those whose square or prerequisites changed', () => {
    const board = boardOf(moveCourse(boardOf(addLink(SAVED, 'c', 'b')), 'a', at(1, 0)));
    expect(boardChanges(SAVED, board)).toEqual([
      { courseId: 'a', prerequisites: [], position: at(1, 0) },
      { courseId: 'b', prerequisites: ['a', 'c'], position: at(0, 0) },
    ]);
    expect(boardChanges(SAVED, boardFrom(SAVED))).toEqual([]);
  });

  it('keeps unsaved edits across a reload, and shows what others saved meanwhile', () => {
    const mine = boardOf(moveCourse(boardFrom(SAVED), 'a', at(0, 3)));
    // Someone else put C on the map, and B was renamed.
    const reloaded = [SAVED[0]!, { ...SAVED[1]!, title: 'Bee' }, { ...SAVED[2]!, position: at(2, 2) }];
    const board = boardFrom(reloaded, boardChanges(SAVED, mine));
    expect(where(board)).toEqual({ a: at(0, 3), b: at(1, 0), c: at(2, 2) });
    expect(board[1]!.title).toBe('Bee');
    // A course deleted meanwhile drops out, and so do lines to it.
    expect(boardFrom([course('b', ['a'], at(1, 0))], [])).toEqual([course('b', [], at(1, 0))]);
  });

  it('finds the square under a point, counting half of each gap to the square beside it', () => {
    // Cards are 184 × 128 with 40 and 64 pixel gaps.
    expect(squareAt(0, 0, 3)).toEqual(at(0, 0));
    expect(squareAt(203, 150, 3)).toEqual(at(0, 0));
    expect(squareAt(205, 161, 3)).toEqual(at(1, 1));
    expect(squareAt(1300, 400, 3)).toEqual(at(2, 5));
    expect(squareAt(100, 600, 3)).toBeNull();
    expect(squareAt(-30, 10, 3)).toBeNull();
    expect(courseAt(SAVED, at(1, 0))?.courseId).toBe('b');
  });

  it('shows the rows in use and one more to drag into, at least three', () => {
    expect(boardRows(SAVED)).toBe(3);
    expect(boardRows([course('a', [], at(5, 0))])).toBe(7);
    expect(boardRows([course('a', [], at(7, 0))])).toBe(8);
    expect(boardSize(3)).toEqual({ width: 1304, height: 512 });
  });
});
