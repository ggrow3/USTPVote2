import { describe, expect, it } from 'vitest';
import { coursesPackage, coursesPackageSchema, type CourseRecord } from 'ustp-domain';
import { courseFileText, coursesExportedText } from './course-files.js';

const AT = '2026-11-01T12:00:00.000Z';
const record = (courseId: string, title: string, publishedVersion: number | null): CourseRecord => ({
  courseId,
  title,
  summary: 'A summary',
  status: publishedVersion ? 'published' : 'draft',
  version: publishedVersion ?? 0,
  publishedVersion,
  prerequisites: [],
  position: null,
  hidden: false,
  openToGuests: false,
  createdAt: AT,
  updatedAt: AT,
  updatedBy: '01a1-editor',
});
const pkg = coursesPackage(
  [
    {
      course: record('transhumanism', 'Transhumanism', 1),
      lessons: [],
      profiles: [],
      published: { courseId: 'transhumanism', version: 1, title: 'Transhumanism', summary: 'A summary', lessons: [], profiles: [], publishedAt: AT, publishedBy: '01a1-editor' },
    },
    { course: record('allies', 'Allies', null), lessons: [], profiles: [], published: null },
  ],
  AT,
);

describe('course files', () => {
  it('are indented JSON ending in a newline that reads back as the same file', () => {
    const text = courseFileText(pkg);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "format": "ustp.courses",');
    expect(coursesPackageSchema.parse(JSON.parse(text))).toEqual(pkg);
  });

  it('say how many courses were exported, and that changes on the board not saved yet are not in the file', () => {
    expect(coursesExportedText(pkg, 0)).toBe('Exported 2 courses (1 published) and the course map');
    expect(coursesExportedText({ courses: pkg.courses.filter((course) => !course.published) }, 0)).toBe('Exported 1 course (0 published) and the course map');
    expect(coursesExportedText(pkg, 1)).toBe(
      'Exported 2 courses (1 published) and the course map, as last saved: save the map, then export again, to include the course you changed on the board',
    );
    expect(coursesExportedText(pkg, 3)).toMatch(/to include the 3 courses you changed on the board$/);
  });
});
