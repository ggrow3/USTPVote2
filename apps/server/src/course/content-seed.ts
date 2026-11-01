import { allies } from './content/allies.js';
import { figuresOfTranshumanism } from './content/figures-of-transhumanism.js';
import { fundamentalQuestions } from './content/fundamental-questions.js';
import { historicalAppliedProjects } from './content/historical-applied-projects.js';
import { introductionToLeftTranshumanism } from './content/introduction-to-left-transhumanism.js';
import type { SeededCourse } from './content/lessons.js';
import { newYorkTranshumanistParty } from './content/new-york-transhumanist-party.js';
import { theCoalition } from './content/the-coalition.js';
import { transhumanistParty } from './content/transhumanist-party.js';
import { whyTheNewYorkTranshumanistParty } from './content/why-the-new-york-transhumanist-party.js';
import { whyTheTranshumanistParty } from './content/why-the-transhumanist-party.js';

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

/** Marks that the courses written from the party's own published sources were added; a seed of its own, so it runs where the curriculum's already has. */
export const PARTY_SEED = 'course-party-2026-11';

/**
 * The map courses the curriculum has nothing for, written from what the United States Transhumanist Party and the New
 * York Transhumanist Party have published (researched 2026-11-01), each lesson naming its sources: drafts too.
 */
export const partyCourses: readonly SeededCourse[] = [
  allies,
  transhumanistParty,
  newYorkTranshumanistParty,
  whyTheTranshumanistParty,
  whyTheNewYorkTranshumanistParty,
];

/** Each batch of written courses, seeded once under its own marker, in this order. */
export const CONTENT_SEEDS: readonly { readonly seed: string; readonly courses: readonly SeededCourse[] }[] = [
  { seed: CONTENT_SEED, courses: contentCourses },
  { seed: PARTY_SEED, courses: partyCourses },
];
