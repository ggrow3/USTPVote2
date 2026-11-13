/** Marks, in `course_seeds`, that the courses below were opened to guests, so it happens once. */
export const OPEN_SEED = 'course-open-2026-11';

/** Who the records the seed changes say changed them. */
export const OPEN_SOURCE = 'course-open';

/**
 * The courses whose quizzes anyone may take without signing in from the start (design §10.8, "Open without sign-in";
 * the user's choice, 2026-11-12): the six-lesson introduction, the first course, which comes after no other. Opened
 * once; a Course Administrator may close it, or open another, with the course's switch, and it stays as they leave it.
 */
export const openCourses: readonly string[] = ['transhumanism'];
