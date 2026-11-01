import { coursePackageFileName, coursesPackageFileName, type CoursePackage, type CoursesPackage } from 'ustp-domain';
import { saveFile } from '../bylaws-files.js';

/**
 * Course files as the browser saves them (design §10.8): one course's `ustp.course` file from its Export JSON menu,
 * or every course with the map as one `ustp.courses` file from the map's Export all. Both hold the quiz answers and
 * the drafts, so only the Course tab offers them.
 */

/** Indented JSON ending in a newline, as election files are. */
export function courseFileText(pkg: CoursePackage | CoursesPackage): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function saveCoursePackage(pkg: CoursePackage): void {
  saveFile(new Blob([courseFileText(pkg)], { type: 'application/json' }), coursePackageFileName(pkg));
}

export function saveCoursesPackage(pkg: CoursesPackage): void {
  saveFile(new Blob([courseFileText(pkg)], { type: 'application/json' }), coursesPackageFileName(pkg));
}

/**
 * What Export all says it saved: how many courses and how many of them published, and, while the board has changes
 * not saved, that the file has the map as last saved.
 */
export function coursesExportedText(pkg: Pick<CoursesPackage, 'courses'>, unsavedChanges: number): string {
  const count = pkg.courses.length;
  const published = pkg.courses.filter((course) => course.published).length;
  const saved = `Exported ${count === 1 ? '1 course' : `${count} courses`} (${published} published) and the course map`;
  if (!unsavedChanges) return saved;
  const changes = unsavedChanges === 1 ? 'the course you changed on the board' : `the ${unsavedChanges} courses you changed on the board`;
  return `${saved}, as last saved: save the map, then export again, to include ${changes}`;
}
