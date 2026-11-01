import type { CourseMap, CourseMapEntry, LearnerCourseState, LearnerCourseStatus } from 'ustp-domain';

/**
 * The Courses page's catalogue (design §10.8): artwork made from each course's ID, the featured courses at the top,
 * the panels of course rows under them, and the search box. Everything comes from the course map the api sends; no
 * course has a picture, rating or count of learners of its own.
 */

/** A course's artwork: a gradient between two colours and an icon, the same wherever the course shows. */
export interface CourseArt {
  readonly from: string;
  readonly to: string;
  readonly icon: string;
}

/** Dark enough at their deep end for a white icon, and none green, which says "passed". */
const GRADIENTS: readonly (readonly [string, string])[] = [
  ['#9a3c00', '#ff8a3d'],
  ['#3b1782', '#8b5cf6'],
  ['#1d3fd8', '#60a5fa'],
  ['#0b5d63', '#2bb3a3'],
  ['#8f1239', '#f472b6'],
  ['#7a4300', '#e0a106'],
];
const ICONS = [
  'psychology', 'rocket_launch', 'hub', 'public', 'auto_awesome', 'biotech', 'diversity_3', 'lightbulb', 'travel_explore',
  'school', 'science', 'groups', 'balance', 'explore', 'eco', 'memory', 'all_inclusive', 'emoji_objects',
];

/** FNV-1a, so a course keeps its artwork from one visit to the next. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function courseArt(courseId: string): CourseArt {
  const h = hash(courseId);
  const [from, to] = GRADIENTS[h % GRADIENTS.length]!;
  return { from, to, icon: ICONS[Math.floor(h / GRADIENTS.length) % ICONS.length]! };
}

/** The artwork of the card for the drafts still to come. */
export const SOON_ART: CourseArt = { from: '#3b1782', to: '#8b5cf6', icon: 'schedule' };

/** Where a course stands for the person looking: a signed-in learner's state, open for a visitor, or coming soon. */
export type CatalogState = LearnerCourseState | 'open' | 'coming_soon';

export function catalogState(course: CourseMapEntry, status: LearnerCourseStatus | undefined): CatalogState {
  if (!course.published) return 'coming_soon';
  return status?.state ?? 'open';
}

/** What a course row says about where the learner stands, with an icon. */
export function statusLine(
  course: CourseMapEntry,
  status: LearnerCourseStatus | undefined,
  titles: ReadonlyMap<string, string>,
): { readonly label: string; readonly icon: string } {
  const names = (ids: readonly string[]) => ids.map((id) => titles.get(id) ?? id).join(' and ');
  switch (catalogState(course, status)) {
    case 'coming_soon':
      return { label: 'Coming soon', icon: 'schedule' };
    case 'open':
      return { label: 'Open to everyone', icon: 'menu_book' };
    case 'not_started':
      return { label: 'Not started', icon: 'play_circle' };
    case 'in_progress':
      return { label: `In progress: ${status!.lessonsPassed} of ${status!.lessonCount} lessons passed`, icon: 'timelapse' };
    case 'passed':
      return { label: 'Passed', icon: 'check_circle' };
    case 'locked':
      return { label: `Locked: pass ${names(status!.missing)} first`, icon: 'lock' };
  }
}

/** The row's short line: the course's summary, or for a draft, which courses it comes after. */
export function shortLine(course: CourseMapEntry, titles: ReadonlyMap<string, string>): string {
  if (course.summary) return course.summary;
  if (course.prerequisites.length) return `After ${course.prerequisites.map((id) => titles.get(id) ?? id).join(' and ')}`;
  return course.published ? `${course.lessonCount} ${course.lessonCount === 1 ? 'lesson' : 'lessons'}` : 'Not published yet';
}

/** The words typed in the search box, each found in the course's title or summary, in any case and order. */
export function matchesQuery(course: CourseMapEntry, query: string): boolean {
  const text = `${course.title} ${course.summary ?? ''}`.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/**
 * The three panels under the featured courses. Start here: courses the person can begin now (for a visitor, those
 * that come after no other); Continue learning: courses a signed-in learner is part-way through; Coming soon: drafts
 * on the map. Each in map order; the page hides an empty panel.
 */
export interface CatalogPanels {
  readonly start: readonly CourseMapEntry[];
  readonly continuing: readonly CourseMapEntry[];
  readonly soon: readonly CourseMapEntry[];
}

export function catalogPanels(map: CourseMap): CatalogPanels {
  const states = stateOf(map);
  const signedIn = !!map.status;
  return {
    start: map.courses.filter((course) =>
      signedIn ? states(course) === 'not_started' : course.published && course.prerequisites.length === 0,
    ),
    continuing: map.courses.filter((course) => states(course) === 'in_progress'),
    soon: map.courses.filter((course) => !course.published),
  };
}

/** A card in the featured courses: a course with what its button does, or the drafts still to come. */
export type HeroSlide =
  | { readonly kind: 'course'; readonly course: CourseMapEntry; readonly eyebrow: string; readonly action: string }
  | { readonly kind: 'soon'; readonly count: number; readonly titles: readonly string[] };

/** At most this many courses are featured, before the card for the drafts. */
export const HERO_COURSES = 5;

/**
 * The featured courses, chosen from where the learner stands rather than by hand: those they are part-way through,
 * then those they can start, then those they have passed; a visitor sees the courses that come after no other first.
 * Locked courses are left out. A last card names the drafts still to come.
 */
export function heroSlides(map: CourseMap): HeroSlide[] {
  const states = stateOf(map);
  const slide = (course: CourseMapEntry, eyebrow: string, action: string): HeroSlide => ({ kind: 'course', course, eyebrow, action });
  const published = map.courses.filter((course) => course.published);
  const courses = map.status
    ? [
        ...published.filter((course) => states(course) === 'in_progress').map((course) => slide(course, 'Continue learning', 'Continue')),
        ...published.filter((course) => states(course) === 'not_started').map((course) => slide(course, 'Start here', 'Start the course')),
        ...published.filter((course) => states(course) === 'passed').map((course) => slide(course, 'You passed this course', 'Review it')),
      ]
    : [
        ...published.filter((course) => !course.prerequisites.length).map((course) => slide(course, 'Free course', 'Start the course')),
        ...published.filter((course) => course.prerequisites.length).map((course) => slide(course, 'Free course', 'Read the course')),
      ];
  const soon = map.courses.filter((course) => !course.published);
  return [
    ...courses.slice(0, HERO_COURSES),
    ...(soon.length ? [{ kind: 'soon' as const, count: soon.length, titles: soon.map((course) => course.title) }] : []),
  ];
}

function stateOf(map: CourseMap): (course: CourseMapEntry) => CatalogState {
  const statuses = new Map((map.status ?? []).map((status) => [status.courseId, status]));
  return (course) => catalogState(course, statuses.get(course.courseId));
}
