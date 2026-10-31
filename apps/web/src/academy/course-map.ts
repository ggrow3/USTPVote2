import type { CoursePosition, LearnerCourseStatus } from 'ustp-domain';

/** A course as the map draws it: where it sits and which courses come before it. */
export interface MapCourse {
  readonly courseId: string;
  readonly title: string;
  readonly prerequisites: readonly string[];
  readonly position: CoursePosition | null;
}

/** Card size and the gaps between cards, in pixels; the lines between cards run through the gaps. */
export const MAP_GEOMETRY = { cardWidth: 184, cardHeight: 128, columnGap: 40, rowGap: 64 } as const;

export interface PlacedCard<C extends MapCourse> {
  readonly course: C;
  readonly x: number;
  readonly y: number;
}

/** A line from a course to one that comes after it, as an SVG path. */
export interface MapLine {
  readonly from: string;
  readonly to: string;
  readonly path: string;
}

export interface MapLayout<C extends MapCourse> {
  readonly width: number;
  readonly height: number;
  readonly cards: readonly PlacedCard<C>[];
  readonly lines: readonly MapLine[];
}

/**
 * Lays the courses with a position out on a grid, and draws a line from each prerequisite to the course after it: down
 * from the bottom of the earlier card, across the gap above the later one, and down into it, so courses after the same
 * one share a bar, as on the party's drawing; sideways between cards on the same row. Courses off the map are left out.
 */
export function courseMapLayout<C extends MapCourse>(courses: readonly C[]): MapLayout<C> {
  const { cardWidth: w, cardHeight: h, columnGap, rowGap } = MAP_GEOMETRY;
  const placed = courses.filter((course): course is C & { position: CoursePosition } => course.position !== null);
  const at = (position: CoursePosition) => ({ x: position.column * (w + columnGap), y: position.row * (h + rowGap) });
  const cards = placed.map((course) => ({ course, ...at(course.position) }));
  const byId = new Map(cards.map((card) => [card.course.courseId, card]));
  const lines: MapLine[] = [];
  for (const card of cards) {
    for (const id of card.course.prerequisites) {
      const before = byId.get(id);
      if (before) lines.push({ from: id, to: card.course.courseId, path: linePath(before, card) });
    }
  }
  const columns = Math.max(0, ...placed.map((course) => course.position.column + 1));
  const rows = Math.max(0, ...placed.map((course) => course.position.row + 1));
  return {
    width: Math.max(0, columns * (w + columnGap) - columnGap),
    height: Math.max(0, rows * (h + rowGap) - rowGap),
    cards,
    lines,
  };
}

function linePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const { cardWidth: w, cardHeight: h, rowGap } = MAP_GEOMETRY;
  if (from.y === to.y) {
    const [left, right] = from.x < to.x ? [from.x + w, to.x] : [from.x, to.x + w];
    return `M ${left} ${from.y + h / 2} H ${right}`;
  }
  const fromX = from.x + w / 2;
  const toX = to.x + w / 2;
  if (from.y < to.y) return `M ${fromX} ${from.y + h} V ${to.y - rowGap / 2} H ${toX} V ${to.y}`;
  return `M ${fromX} ${from.y} V ${to.y + h + rowGap / 2} H ${toX} V ${to.y + h}`;
}

/** A date and time as people read it here, such as "Oct 31, 2026, 9:05 AM". */
export function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * What a course's card or list item says about where the learner stands. A card on the map is small, so a locked one
 * points at the lines instead of naming the courses before it.
 */
export function statusText(
  status: LearnerCourseStatus | undefined,
  published: boolean,
  titles: ReadonlyMap<string, string>,
  { onMap = false } = {},
): string {
  if (!published) return 'Coming soon';
  if (!status) return 'Open to everyone';
  switch (status.state) {
    case 'passed':
      return 'Passed';
    case 'locked':
      if (onMap) return `Quizzes open after ${status.missing.length === 1 ? 'the course' : `the ${status.missing.length} courses`} before it`;
      return `Quizzes open after ${status.missing.map((id) => titles.get(id) ?? id).join(' and ')}`;
    case 'in_progress':
      return `${status.lessonsPassed} of ${status.lessonCount} lessons passed`;
    case 'not_started':
      return `${status.lessonCount} ${status.lessonCount === 1 ? 'lesson' : 'lessons'}`;
  }
}
