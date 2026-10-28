import { QUESTION_TYPE_LABELS, UNTITLED, type QuestionType } from './question-model.js';
import type { SaveStatus } from './save-queue.js';

/**
 * The ballot builder's wording (design §6.5): the save status, names of repeated controls, and what screen readers
 * are told after each change (docs/ACCESSIBILITY.md), so the same words are used everywhere and tested once.
 */

/** A question's title as the builder names it, "Untitled question" while empty. */
export const titleOf = (title: string) => title.trim() || UNTITLED;

/** "Question 3: Chair", for buttons repeated on every question. */
export const questionName = (n: number, title: string) => `question ${n}: ${titleOf(title)}`;

/** "option 2: Ada Brooks", or "option 2" while empty. */
export const optionName = (n: number, name: string) => (name.trim() ? `option ${n}: ${name.trim()}` : `option ${n}`);

/**
 * The line in the save bar. A failure says what went wrong; fields in error are not sent until fixed, and say so; a
 * pause in typing saves, so "Saving…" covers both waiting and sending.
 */
export function saveStatusText(status: SaveStatus, unsaved: number, textsTyping = 0): string {
  if (status.state === 'error') return `Not saved: ${status.error}`;
  if (unsaved > 0) return unsaved === 1 ? 'Not saved: fix what is marked in one place' : `Not saved: fix what is marked in ${unsaved} places`;
  if (status.state === 'saving') return 'Saving…';
  return textsTyping > 0 ? 'A text you are writing is saved when you leave its field' : 'All changes saved';
}

export const UNDO_HINT = 'Undo is in the bar at the bottom of the ballot.';

export const announcements = {
  questionAdded: (n: number, type: QuestionType) => `Question ${n} added: ${QUESTION_TYPE_LABELS[type]}. Type the question.`,
  questionCopied: (n: number, title: string) => `Copy of “${titleOf(title)}” added as question ${n}.`,
  questionDeleted: (title: string) => `Question “${titleOf(title)}” deleted. ${UNDO_HINT}`,
  questionMoved: (title: string, to: number, total: number) => `“${titleOf(title)}” is now question ${to} of ${total}.`,
  typeChanged: (type: QuestionType) => `Now a ${QUESTION_TYPE_LABELS[type]} question.`,
  optionRemoved: (name: string) => (name.trim() ? `Option “${name.trim()}” removed. ${UNDO_HINT}` : 'Empty option removed.'),
  optionCopied: (n: number) => `Copy added as option ${n}.`,
  optionMoved: (name: string, to: number, total: number) => `“${name.trim() || 'Empty option'}” is now option ${to} of ${total}.`,
  restored: (what: string) => `Undone: ${what}.`,
  linked: (name: string) => `${name} linked to their member account.`,
  unlinked: (name: string) => `No longer linked to ${name}’s member account.`,
  saveFailed: (error: string) => `Not saved: ${error}`,
  savedAgain: 'All changes saved.',
};

/** What an undo puts back, said in the bar ("Undo delete question “Chair”"). */
export const undoText = {
  question: (title: string) => `delete question “${titleOf(title)}”`,
  option: (name: string) => `remove option “${name.trim()}”`,
};
