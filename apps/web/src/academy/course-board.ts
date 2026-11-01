import { COURSE_MAP, coursePlacementProblem, orgChartPositions, type CoursePlacement, type CoursePosition } from 'ustp-domain';
import { MAP_GEOMETRY, type MapCourse } from './course-map.js';

/**
 * The Course tab's board (design §10.8): Course Administrators drag courses between squares and draw a line from a
 * course to one that comes after it. Every change stays on the board until Save map sends the courses that changed
 * together (`PUT /v1/admin/course-map`); the api checks the whole map again.
 */

/** A course on the board: where it sits there and which courses come before it, saved or not. */
export interface BoardCourse extends MapCourse {
  readonly prerequisites: readonly string[];
  readonly position: CoursePosition | null;
}

/** An edit refused on the board, in words, or the board after it. */
export type BoardEdit = { readonly board: BoardCourse[] } | { readonly problem: string };

/**
 * The board for the saved courses, with the edits not saved yet (`boardChanges` of the board before) of courses that
 * are still there. Only real edits are kept, so a change saved by someone else meanwhile shows.
 */
export function boardFrom(saved: readonly MapCourse[], edited: readonly (CoursePlacement & { readonly courseId: string })[] = []): BoardCourse[] {
  const ids = new Set(saved.map((course) => course.courseId));
  const edits = new Map(edited.map((course) => [course.courseId, course]));
  return saved.map((course) => {
    const edit = edits.get(course.courseId);
    const placement = edit ?? course;
    return {
      courseId: course.courseId,
      title: course.title,
      prerequisites: placement.prerequisites.filter((id) => ids.has(id)),
      position: placement.position,
    };
  });
}

const same = (a: CoursePosition | null, b: CoursePosition | null) => a === b || (!!a && !!b && a.row === b.row && a.column === b.column);

export function courseAt(board: readonly BoardCourse[], square: CoursePosition): BoardCourse | undefined {
  return board.find((course) => same(course.position, square));
}

const titleOf = (board: readonly BoardCourse[], id: string) => board.find((course) => course.courseId === id)?.title ?? id;

/**
 * Moves a course to a square, or off the map (null). A course already on that square swaps with it, taking the moved
 * course's old square; one coming from off the map needs an empty square, so nothing is pushed off by it.
 */
export function moveCourse(board: readonly BoardCourse[], courseId: string, to: CoursePosition | null): BoardEdit {
  const moving = board.find((course) => course.courseId === courseId);
  if (!moving) return { problem: 'that course is no longer here' };
  const there = to ? courseAt(board, to) : undefined;
  if (there && there.courseId !== courseId && !moving.position) {
    return { problem: `${there.title} is on that square: put ${moving.title} on an empty one` };
  }
  return {
    board: board.map((course) => {
      if (course.courseId === courseId) return { ...course, position: to };
      if (there && course.courseId === there.courseId) return { ...course, position: moving.position };
      return course;
    }),
  };
}

/** Moves a course on the map one square up, down, left or right (swapping as `moveCourse`), or leaves it at the edge. */
export function nudgeCourse(board: readonly BoardCourse[], courseId: string, rows: number, columns: number): BoardEdit {
  const position = board.find((course) => course.courseId === courseId)?.position;
  if (!position) return { board: [...board] };
  const to = { row: position.row + rows, column: position.column + columns };
  if (to.row < 0 || to.row >= COURSE_MAP.rows || to.column < 0 || to.column >= COURSE_MAP.columns) return { board: [...board] };
  return moveCourse(board, courseId, to);
}

/** Sets which courses come before one, refusing what the api would: itself, too many, or a loop. */
export function setPrerequisites(board: readonly BoardCourse[], courseId: string, prerequisites: readonly string[]): BoardEdit {
  const course = board.find((candidate) => candidate.courseId === courseId);
  if (!course) return { problem: 'that course is no longer here' };
  if (prerequisites.length > COURSE_MAP.maxPrerequisites) {
    return { problem: `${course.title} can come after at most ${COURSE_MAP.maxPrerequisites} courses` };
  }
  // Only the prerequisites change here, so a square shared on the board (never left by its edits) cannot be the problem.
  const problem = coursePlacementProblem(board, courseId, { prerequisites, position: null });
  if (problem) return { problem };
  return { board: board.map((candidate) => (candidate.courseId === courseId ? { ...candidate, prerequisites: [...prerequisites] } : candidate)) };
}

/** A line from `before` to `after`: `after` now comes after `before`. Drawing a line that is there already changes nothing. */
export function addLink(board: readonly BoardCourse[], before: string, after: string): BoardEdit {
  const course = board.find((candidate) => candidate.courseId === after);
  if (!course) return { problem: 'that course is no longer here' };
  if (course.prerequisites.includes(before)) return { board: [...board] };
  if (course.prerequisites.length >= COURSE_MAP.maxPrerequisites) {
    return { problem: `${course.title} already comes after ${COURSE_MAP.maxPrerequisites} courses, the most a course may` };
  }
  return setPrerequisites(board, after, [...course.prerequisites, before]);
}

export function removeLink(board: readonly BoardCourse[], before: string, after: string): BoardCourse[] {
  return board.map((course) =>
    course.courseId === after ? { ...course, prerequisites: course.prerequisites.filter((id) => id !== before) } : course,
  );
}

/** Lays the courses on the map out as an org chart (`orgChartPositions`); courses off the map stay off. */
export function arrangeAsOrgChart(board: readonly BoardCourse[]): BoardEdit {
  const result = orgChartPositions(board);
  if ('problem' in result) return { problem: `Cannot arrange it as an org chart: ${result.problem}` };
  return { board: board.map((course) => (course.position ? { ...course, position: result.positions.get(course.courseId)! } : course)) };
}

/** The courses whose square or prerequisites differ from the saved ones, as `PUT /v1/admin/course-map` takes them. */
export function boardChanges(saved: readonly MapCourse[], board: readonly BoardCourse[]): (CoursePlacement & { courseId: string })[] {
  const before = new Map(saved.map((course) => [course.courseId, course]));
  return board
    .filter((course) => {
      const was = before.get(course.courseId);
      return !was || !same(was.position, course.position) || was.prerequisites.join() !== course.prerequisites.join();
    })
    .map(({ courseId, prerequisites, position }) => ({ courseId, prerequisites: [...prerequisites], position }));
}

/** How many rows the board shows: the rows in use and one more to drag into, at least three, at most the map's. */
export function boardRows(board: readonly BoardCourse[]): number {
  const used = Math.max(0, ...board.map((course) => (course.position ? course.position.row + 1 : 0)));
  return Math.min(COURSE_MAP.rows, Math.max(3, used + 1));
}

/** The board's size in pixels: every column of the map, and `rows` rows. */
export function boardSize(rows: number): { width: number; height: number } {
  const { cardWidth: w, cardHeight: h, columnGap, rowGap } = MAP_GEOMETRY;
  return { width: COURSE_MAP.columns * (w + columnGap) - columnGap, height: rows * (h + rowGap) - rowGap };
}

/** The square under a point on the board (pixels from its top left corner), its gaps shared by the squares beside them. */
export function squareAt(x: number, y: number, rows: number): CoursePosition | null {
  const { cardWidth: w, cardHeight: h, columnGap, rowGap } = MAP_GEOMETRY;
  const column = Math.floor((x + columnGap / 2) / (w + columnGap));
  const row = Math.floor((y + rowGap / 2) / (h + rowGap));
  return row >= 0 && row < rows && column >= 0 && column < COURSE_MAP.columns ? { row, column } : null;
}

/** What a line between two courses says, for its label and the bar that removes it. */
export function linkText(board: readonly BoardCourse[], before: string, after: string): string {
  return `${titleOf(board, after)} comes after ${titleOf(board, before)}`;
}
