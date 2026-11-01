import { describe, expect, it } from 'vitest';
import type { CourseMap, CourseMapEntry, LearnerCourseStatus } from 'ustp-domain';
import { catalogPanels, catalogState, courseArt, HERO_COURSES, heroSlides, matchesQuery, shortLine, statusLine } from './course-catalog.js';

const course = (courseId: string, over: Partial<CourseMapEntry> = {}): CourseMapEntry => ({
  courseId,
  title: courseId,
  summary: `About ${courseId}`,
  published: true,
  lessonCount: 4,
  prerequisites: [],
  position: { row: 0, column: 0 },
  ...over,
});
const draft = (courseId: string, prerequisites: string[] = []) => course(courseId, { summary: null, published: false, lessonCount: 0, prerequisites });
const status = (courseId: string, state: LearnerCourseStatus['state'], over: Partial<LearnerCourseStatus> = {}): LearnerCourseStatus => ({
  courseId,
  state,
  lessonsPassed: 0,
  lessonCount: 4,
  missing: [],
  ...over,
});
const titles = new Map([['basics', 'The Basics'], ['allies', 'Allies']]);

describe("a course's artwork", () => {
  it('is the same every time for a course, a gradient and an icon', () => {
    expect(courseArt('transhumanism')).toEqual(courseArt('transhumanism'));
    expect(courseArt('transhumanism')).toMatchObject({ from: expect.stringMatching(/^#[0-9a-f]{6}$/), to: expect.stringMatching(/^#[0-9a-f]{6}$/), icon: expect.any(String) });
  });

  it('differs between courses', () => {
    const ids = ['the-coalition', 'allies-of-the-transhumanist-party', 'the-figures-of-transhumanism', 'why-the-transhumanist-party', 'transhumanism'];
    expect(new Set(ids.map((id) => JSON.stringify(courseArt(id)))).size).toBeGreaterThan(3);
  });
});

describe('a course row', () => {
  it('says where the learner stands', () => {
    expect(statusLine(draft('soon'), undefined, titles).label).toBe('Coming soon');
    expect(statusLine(course('basics'), undefined, titles).label).toBe('Open to everyone');
    expect(statusLine(course('basics'), status('basics', 'not_started'), titles).label).toBe('Not started');
    expect(statusLine(course('basics'), status('basics', 'in_progress', { lessonsPassed: 2 }), titles).label).toBe('In progress: 2 of 4 lessons passed');
    expect(statusLine(course('basics'), status('basics', 'passed'), titles)).toEqual({ label: 'Passed', icon: 'check_circle' });
    expect(statusLine(course('next'), status('next', 'locked', { missing: ['basics', 'allies'] }), titles)).toEqual({
      label: 'Locked: pass The Basics and Allies first',
      icon: 'lock',
    });
  });

  it("gives a draft's place on the map for its short line, having no summary", () => {
    expect(shortLine(course('basics'), titles)).toBe('About basics');
    expect(shortLine(draft('coalition', ['allies']), titles)).toBe('After Allies');
    expect(shortLine(draft('top'), titles)).toBe('Not published yet');
  });

  it('is coming soon while a draft, whatever the learner has done', () => {
    expect(catalogState(draft('soon'), status('soon', 'locked'))).toBe('coming_soon');
  });
});

describe('the search box', () => {
  it('finds every word typed in the title or summary, in any case and order', () => {
    const c = course('x', { title: 'Why the Transhumanist Party?', summary: 'Our platform and history.' });
    expect(matchesQuery(c, 'party why')).toBe(true);
    expect(matchesQuery(c, '  PLATFORM  ')).toBe(true);
    expect(matchesQuery(c, 'party coalition')).toBe(false);
    expect(matchesQuery(draft('The Coalition'), 'coalition')).toBe(true);
  });
});

describe('the panels', () => {
  const courses = [course('basics'), course('next', { prerequisites: ['basics'] }), course('other'), draft('soon', ['basics'])];

  it('show a visitor the courses that come after no other, and the drafts', () => {
    expect(catalogPanels({ courses })).toEqual({ start: [courses[0], courses[2]], continuing: [], soon: [courses[3]] });
  });

  it('show a learner what they can start, what they are part-way through, and the drafts', () => {
    const map: CourseMap = {
      courses,
      status: [status('basics', 'passed'), status('next', 'not_started'), status('other', 'in_progress'), status('soon', 'locked')],
    };
    expect(catalogPanels(map)).toEqual({ start: [courses[1]], continuing: [courses[2]], soon: [courses[3]] });
  });

  it('leave a locked course out of Start here', () => {
    const map: CourseMap = { courses: [course('next', { prerequisites: ['basics'] })], status: [status('next', 'locked', { missing: ['basics'] })] };
    expect(catalogPanels(map).start).toEqual([]);
  });
});

describe('the featured courses', () => {
  const kinds = (map: CourseMap) => heroSlides(map).map((slide) => (slide.kind === 'course' ? `${slide.course.courseId}:${slide.action}` : `soon:${slide.count}`));

  it('put what a learner is part-way through first, then what they can start, then what they passed, and never a locked course', () => {
    const courses = [course('a'), course('b'), course('c'), course('d'), draft('e'), draft('f')];
    const map: CourseMap = {
      courses,
      status: [status('a', 'passed'), status('b', 'not_started'), status('c', 'in_progress'), status('d', 'locked')],
    };
    expect(kinds(map)).toEqual(['c:Continue', 'b:Start the course', 'a:Review it', 'soon:2']);
  });

  it('show a visitor the courses that come after no other first', () => {
    const map: CourseMap = { courses: [course('later', { prerequisites: ['first'] }), course('first')] };
    expect(kinds(map)).toEqual(['first:Start the course', 'later:Read the course']);
  });

  it(`feature at most ${HERO_COURSES} courses and the drafts' card only when there are drafts`, () => {
    const map: CourseMap = { courses: Array.from({ length: 8 }, (_, i) => course(`c${i}`)) };
    expect(heroSlides(map)).toHaveLength(HERO_COURSES);
    expect(heroSlides({ courses: [draft('only')] })).toEqual([{ kind: 'soon', count: 1, titles: ['only'] }]);
    expect(heroSlides({ courses: [] })).toEqual([]);
  });
});
