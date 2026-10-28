import { describe, expect, it } from 'vitest';
import { announcements, optionName, questionName, saveStatusText, titleOf, undoText } from './builder-text.js';

const saved = { state: 'saved', error: null, failedKey: null } as const;

describe('the save bar', () => {
  it('says whether everything is saved, and why not', () => {
    expect(saveStatusText(saved, 0)).toBe('All changes saved');
    expect(saveStatusText({ ...saved, state: 'saving' }, 0)).toBe('Saving…');
    expect(saveStatusText(saved, 0, 1)).toBe('A text you are writing is saved when you leave its field');
    expect(saveStatusText(saved, 1)).toBe('Not saved: fix what is marked in one place');
    expect(saveStatusText({ ...saved, state: 'saving' }, 2)).toBe('Not saved: fix what is marked in 2 places');
    expect(saveStatusText({ state: 'error', error: 'the election is scheduled; only drafts can be edited', failedKey: 'order' }, 1)).toBe(
      'Not saved: the election is scheduled; only drafts can be edited',
    );
  });
});

describe('names and announcements', () => {
  it('names repeated controls by place and title', () => {
    expect(titleOf('  ')).toBe('Untitled question');
    expect(questionName(3, 'Chair')).toBe('question 3: Chair');
    expect(optionName(2, ' Ada Brooks ')).toBe('option 2: Ada Brooks');
    expect(optionName(2, '')).toBe('option 2');
  });

  it('says what changed, and where undo is', () => {
    expect(announcements.questionAdded(4, 'rank')).toBe('Question 4 added: Rank in order. Type the question.');
    expect(announcements.questionDeleted('Chair')).toBe('Question “Chair” deleted. Undo is in the bar at the bottom of the ballot.');
    expect(announcements.questionMoved('', 1, 5)).toBe('“Untitled question” is now question 1 of 5.');
    expect(announcements.optionRemoved('')).toBe('Empty option removed.');
    expect(announcements.optionMoved('Ada', 2, 3)).toBe('“Ada” is now option 2 of 3.');
    expect(announcements.restored(undoText.option('Ada'))).toBe('Undone: remove option “Ada”.');
    expect(undoText.question('Chair')).toBe('delete question “Chair”');
  });
});
