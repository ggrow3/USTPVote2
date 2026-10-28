import { introParagraphs, type RegistrationFormChange, type RegistrationFormPart } from 'ustp-domain';

/** Wording for the registration form's settings (design §5.2): each part's name and its unsaved changes. */

export const FORM_PART_LABELS: Readonly<Record<RegistrationFormPart, string>> = {
  intro: 'Intro',
  usVoterQuestion: 'First question',
  usVoterHelp: "First question's help",
  idealsTitle: "Core Ideals' heading",
  ideals: 'Core Ideals',
  coreIdealsQuestion: 'Second question',
  coreIdealsHelp: "Second question's help",
  tipsTitle: "Bonus link's title",
  tipsAddress: "Bonus link's address",
};

const PREVIEW = 80;
const short = (text: string) => (text.length > PREVIEW ? `${text.slice(0, PREVIEW - 1).trimEnd()}…` : text);
const count = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** One unsaved change in words: "First question: “Can you vote?”", "Core Ideals: 4 ideals", "Intro: left empty". */
export function describeFormChange(change: RegistrationFormChange): string {
  const label = FORM_PART_LABELS[change.part];
  switch (change.part) {
    case 'ideals':
      return `${label}: ${count(change.to.length, 'ideal')}`;
    case 'intro':
      return change.to ? `${label}: ${count(introParagraphs(change.to).length, 'paragraph')}, “${short(change.to)}”` : `${label}: left empty`;
    case 'tipsAddress':
      return change.to ? `${label}: ${change.to}` : `${label}: removed, so no link is shown`;
    default:
      return change.to ? `${label}: “${short(change.to)}”` : `${label}: left empty`;
  }
}
