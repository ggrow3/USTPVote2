import { figuresOfTranshumanism } from './content/figures-of-transhumanism.js';
import { fundamentalQuestions } from './content/fundamental-questions.js';
import { historicalAppliedProjects } from './content/historical-applied-projects.js';
import { introductionToLeftTranshumanism } from './content/introduction-to-left-transhumanism.js';
import type { SeededCourse } from './content/lessons.js';
import { theCoalition } from './content/the-coalition.js';

export { SEED_SOURCE, SEEDED_AT, type SeededCourse } from './content/lessons.js';

/** Marks, in `course_seeds`, that the curriculum was added, so a course or lesson a Course Administrator deletes stays deleted. */
export const CONTENT_SEED = 'course-content-2026-11';

/**
 * The party's curriculum ("Considerations", 2026-11-01) as courses on its map (design §10.8): Basics of Transhumanism
 * in The Fundamental Questions, Historical Figures in The Figures of Transhumanism, the USPP in The Coalition, and two
 * new courses, Introduction to Left Transhumanism and Historical Applied Projects. All are drafts, for a Course
 * Administrator to read and publish.
 */
export const contentCourses: readonly SeededCourse[] = [
  fundamentalQuestions,
  theCoalition,
  introductionToLeftTranshumanism,
  figuresOfTranshumanism,
  historicalAppliedProjects,
];
