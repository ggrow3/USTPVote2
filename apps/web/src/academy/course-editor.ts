import { portraitProblem, QUIZ_LIMITS, type CourseQuestion, type SaveCourseLessonInput, type SaveFuturistProfileInput } from 'ustp-domain';

/** A question as the Course tab edits it: `key` keeps its card while questions move; a new one has no questionId yet. */
export interface QuestionDraft {
  key: string;
  questionId?: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

let keys = 0;
const nextKey = () => `q${++keys}`;

export function blankQuestion(): QuestionDraft {
  return { key: nextKey(), prompt: '', choices: ['', '', '', ''], correctIndex: 0, explanation: '' };
}

export function questionDrafts(questions: readonly CourseQuestion[]): QuestionDraft[] {
  return questions.map((question) => ({ ...question, key: nextKey(), choices: [...question.choices] }));
}

/** Removes a choice, keeping the same choice marked correct (the first, if it was the one removed). */
export function removeChoice(question: QuestionDraft, index: number): void {
  question.choices.splice(index, 1);
  if (question.correctIndex === index) question.correctIndex = 0;
  else if (question.correctIndex > index) question.correctIndex -= 1;
}

/** Moves an item one place up (-1) or down (+1), if it can go there. */
export function move<T>(list: T[], index: number, by: -1 | 1): void {
  const to = index + by;
  if (to < 0 || to >= list.length) return;
  [list[index], list[to]] = [list[to]!, list[index]!];
}

export function questionsPayload(drafts: readonly QuestionDraft[]): SaveCourseLessonInput['questions'] {
  return drafts.map(({ questionId, prompt, choices, correctIndex, explanation }) => ({
    ...(questionId && { questionId }),
    prompt: prompt.trim(),
    choices: choices.map((choice) => choice.trim()),
    correctIndex,
    explanation: explanation.trim(),
  }));
}

const blank = (value: string) => !value.trim();
const whole = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** What stops a lesson from being saved, in words, before it is sent; the server checks it all again. */
export function lessonProblems(lesson: {
  order: number;
  estimatedMinutes: number;
  title: string;
  summary: string;
  body: string;
  questions: readonly QuestionDraft[];
}): string[] {
  const problems: string[] = [];
  if (!whole(lesson.order, 1, 1000)) problems.push('The order must be a whole number from 1 to 1000.');
  if (!whole(lesson.estimatedMinutes, 1, 240)) problems.push('The minutes must be a whole number from 1 to 240.');
  if (blank(lesson.title)) problems.push('The lesson needs a title.');
  if (blank(lesson.summary)) problems.push('The lesson needs a summary.');
  if (blank(lesson.body)) problems.push('The lesson needs its text.');
  const { minQuestions, maxQuestions, minChoices, maxChoices } = QUIZ_LIMITS;
  if (lesson.questions.length < minQuestions || lesson.questions.length > maxQuestions) {
    problems.push(`The quiz needs ${minQuestions} to ${maxQuestions} questions.`);
  }
  lesson.questions.forEach((question, index) => {
    const name = `Question ${index + 1}`;
    if (blank(question.prompt)) problems.push(`${name} needs its question.`);
    if (question.choices.length < minChoices || question.choices.length > maxChoices) {
      problems.push(`${name} needs ${minChoices} to ${maxChoices} choices.`);
    }
    const empty = question.choices.flatMap((choice, i) => (blank(choice) ? [i + 1] : []));
    if (empty.length) problems.push(`${name}: choice ${empty.join(', ')} ${empty.length > 1 ? 'are' : 'is'} empty.`);
    if (blank(question.explanation)) problems.push(`${name} needs an explanation.`);
  });
  return problems;
}

const link = (value: string | null) => {
  if (!value) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** What stops a profile from being saved, in words, before it is sent; the server checks it all again. */
export function profileProblems(profile: Omit<SaveFuturistProfileInput, 'profileId'>): string[] {
  const problems: string[] = [];
  if (!whole(profile.order, 1, 1000)) problems.push('The order must be a whole number from 1 to 1000.');
  if (blank(profile.name)) problems.push('The profile needs a name.');
  if (blank(profile.biography)) problems.push('The profile needs a biography.');
  if (!profile.ideas.length) problems.push('Add at least one key idea.');
  if (profile.ideas.length > 8) problems.push('List at most 8 key ideas.');
  if (blank(profile.quote) || blank(profile.quoteSource)) problems.push('The profile needs a quoted passage and its source.');
  if (!link(profile.quoteUrl)) problems.push('The quote source URL must be a web address.');
  if (!link(profile.furtherReadingUrl)) problems.push('The further reading URL must be a web address.');
  if (profile.portraitUrl && !link(profile.portraitUrl)) problems.push('The image link must be a web address.');
  if (profile.portraitSourceUrl && !link(profile.portraitSourceUrl)) problems.push('The image source page must be a web address.');
  const started = [profile.portraitImage, profile.portraitUrl, profile.portraitAlt, profile.portraitCredit, profile.portraitLicense, profile.portraitSourceUrl];
  const portrait = portraitProblem(profile);
  if (started.some(Boolean) && portrait) {
    problems.push(
      profile.portraitImage || profile.portraitUrl
        ? `${portrait[0]!.toUpperCase()}${portrait.slice(1)}.`
        : 'Upload a photo or give an image link, or clear the other portrait fields.',
    );
  }
  return problems;
}
