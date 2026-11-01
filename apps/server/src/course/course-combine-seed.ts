import { allies } from './content/allies.js';
import { newYorkTranshumanistParty } from './content/new-york-transhumanist-party.js';

/** Marks, in `course_seeds`, that the courses below were combined, so it happens once. */
export const COMBINE_SEED = 'course-combine-2026-11';

/** Who the records the combining changes say changed them. */
export const COMBINE_SOURCE = 'course-combine';

/**
 * Courses combined into one at the user's request (2026-11-01, design §10.8). The draft lessons and profiles of each
 * course in `from`, in that order, go after those of the course `into`, which keeps its address, title, square,
 * prerequisites and learners, and becomes a draft for a Course Administrator to publish. Its summary becomes `summary`
 * while it is still the one it was seeded with (`seeded`), so one a Course Administrator wrote is kept.
 */
export interface CourseCombination {
  readonly into: string;
  readonly from: readonly string[];
  readonly seeded: string;
  readonly summary: string;
}

export const combinedCourses: readonly CourseCombination[] = [
  {
    into: 'allies',
    from: ['the-coalition'],
    seeded: allies.summary,
    summary:
      'Who the United States Transhumanist Party works with: the state Transhumanist Parties, the Allied Organizations it lists, and All Hands for a Free Future, its coalition with the U.S. Pirate Party, a progressive left leaning party.',
  },
  {
    into: 'new-york-transhumanist-party',
    from: ['why-the-new-york-transhumanist-party', 'introduction-to-left-transhumanism'],
    seeded: newYorkTranshumanistParty.summary,
    summary:
      'The New York Transhumanist Party: a state party under the auspices of the United States Transhumanist Party, how it was re-formed in 2022, its constitution, officers and membership, what it sets out to do and how New York’s election law treats parties; then Left Transhumanism 101 to 501 and the USTP-Left.',
  },
];
