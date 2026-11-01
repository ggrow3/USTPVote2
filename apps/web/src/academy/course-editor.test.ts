import { describe, expect, it } from 'vitest';
import { blankQuestion, lessonProblems, move, profileProblems, questionsPayload, removeChoice, type QuestionDraft } from './course-editor.js';

const question = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
  ...blankQuestion(),
  prompt: 'Which?',
  choices: ['a', 'b', 'c'],
  correctIndex: 1,
  explanation: 'Because.',
  ...over,
});
const lesson = (questions: QuestionDraft[]) => ({ order: 1, estimatedMinutes: 10, title: 'T', summary: 'S', body: 'B', questions });
const profile = {
  order: 1,
  name: 'Ada',
  category: 'foundational_visionary' as const,
  biography: 'Bio.',
  ideas: ['Idea'],
  quote: 'Quote.',
  quoteSource: 'Source',
  quoteUrl: 'https://example.test/q',
  portraitImage: null,
  portraitUrl: null,
  portraitAlt: '',
  portraitCredit: null,
  portraitLicense: null,
  portraitSourceUrl: null,
  furtherReadingUrl: 'https://example.test/r',
};

describe('the quiz editor', () => {
  it('keeps the same choice correct when another is removed', () => {
    const q = question({ choices: ['a', 'b', 'c', 'd'], correctIndex: 2 });
    removeChoice(q, 0);
    expect(q).toMatchObject({ choices: ['b', 'c', 'd'], correctIndex: 1 });
    removeChoice(q, 2);
    expect(q).toMatchObject({ choices: ['b', 'c'], correctIndex: 1 });
    removeChoice(q, 1);
    expect(q).toMatchObject({ choices: ['b'], correctIndex: 0 });
  });

  it('moves questions within the list only', () => {
    const list = ['a', 'b', 'c'];
    move(list, 0, -1);
    move(list, 2, 1);
    expect(list).toEqual(['a', 'b', 'c']);
    move(list, 0, 1);
    expect(list).toEqual(['b', 'a', 'c']);
  });

  it('sends kept IDs, trimmed text, and no editor keys', () => {
    expect(questionsPayload([question({ questionId: 'kept', prompt: ' Which? ' }), question()])).toEqual([
      { questionId: 'kept', prompt: 'Which?', choices: ['a', 'b', 'c'], correctIndex: 1, explanation: 'Because.' },
      { prompt: 'Which?', choices: ['a', 'b', 'c'], correctIndex: 1, explanation: 'Because.' },
    ]);
  });

  it('says in words what a lesson still needs', () => {
    expect(lessonProblems(lesson([question()]))).toEqual([]);
    expect(lessonProblems(lesson([]))).toEqual(['The quiz needs 1 to 10 questions.']);
    expect(lessonProblems({ ...lesson([question(), question({ prompt: ' ', choices: ['a', '', ''], explanation: '' })]), title: '' })).toEqual([
      'The lesson needs a title.',
      'Question 2 needs its question.',
      'Question 2: choice 2, 3 are empty.',
      'Question 2 needs an explanation.',
    ]);
    expect(lessonProblems(lesson([question({ choices: ['only'], correctIndex: 0 })]))).toEqual(['Question 1 needs 2 to 6 choices.']);
  });
});

describe('the lesson video', () => {
  const upload = '0190a000-0000-7000-8000-000000000000';

  it('needs a link to be one YouTube video', () => {
    const watch = { ...lesson([question()]), videoUpload: null };
    expect(lessonProblems({ ...watch, videoLink: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toEqual([]);
    expect(lessonProblems({ ...watch, videoLink: '' })).toEqual([]);
    expect(lessonProblems({ ...watch, videoLink: 'https://vimeo.com/1' })).toEqual(['The video link must be the address of one YouTube video, or leave it empty.']);
    expect(lessonProblems({ ...watch, videoUpload: upload, videoLink: 'https://vimeo.com/1' })).toEqual([]);
  });
});

describe('the profile editor', () => {
  it('lets a draft go without a portrait, but not half of one', () => {
    expect(profileProblems(profile)).toEqual([]);
    expect(profileProblems({ ...profile, portraitCredit: 'Photo: Bo' })).toEqual(['Upload a photo or give an image link, or clear the other portrait fields.']);
    expect(profileProblems({ ...profile, portraitImage: 'a'.repeat(64), portraitAlt: 'Ada.' })).toEqual(['The portrait needs a credit and a licence.']);
    expect(profileProblems({ ...profile, portraitUrl: 'ftp://example.test/a.jpg', portraitAlt: 'Ada.', portraitCredit: 'Bo', portraitLicense: 'CC0' })).toEqual([
      'The image link must be a web address.',
    ]);
  });
});
