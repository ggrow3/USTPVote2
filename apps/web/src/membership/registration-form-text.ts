import {
  introParagraphs,
  REGISTRATION_FIELD_CHOICES,
  REGISTRATION_FIELDS,
  type FieldSetting,
  type RegistrationField,
  type RegistrationFormChange,
  type RegistrationFormPart,
} from 'ustp-domain';

/** Wording for the registration form's settings (design §5.2): each part's name and its unsaved changes. */

export const FORM_PART_LABELS: Readonly<Record<RegistrationFormPart, string>> = {
  title: 'Page heading',
  intro: 'Intro',
  usVoterQuestion: 'First question',
  usVoterHelp: "First question's help",
  idealsTitle: "Core Ideals' heading",
  ideals: 'Core Ideals',
  coreIdealsQuestion: 'Second question',
  coreIdealsHelp: "Second question's help",
  tipsTitle: "Bonus link's title",
  tipsAddress: "Bonus link's address",
  fields: 'Fields',
};

/** Each field the settings cover, as the settings name it. */
export const FIELD_LABELS: Readonly<Record<RegistrationField, string>> = {
  preferredName: 'Preferred name',
  dateOfBirth: 'Date of birth',
  country: 'Country',
  state: 'State, territory or region',
  city: 'City',
  postalCode: 'ZIP code or postcode',
  phone: 'Phone',
  statement: 'Why do you want to join?',
  interests: 'Issues you care most about',
  skills: 'Skills or experience',
  referral: 'How did you hear about USTP?',
  volunteer: '“I\'d like to volunteer” box',
  runForOffice: '“Interested in running for office” box',
  keepInTouch: 'Staying in touch box',
};

/**
 * A setting in words. A field that is only ever asked or not (the country, which always has an answer, and the boxes,
 * which cannot be required) is "Shown", not "Required" or "Optional".
 */
export function settingLabel(field: RegistrationField, setting: FieldSetting): string {
  if (setting === 'hidden') return 'Not shown';
  if (REGISTRATION_FIELD_CHOICES[field].length < 3) return 'Shown';
  return setting === 'required' ? 'Required' : 'Optional';
}

/** The choices a field's picker offers. */
export function settingOptions(field: RegistrationField): { label: string; value: FieldSetting }[] {
  return REGISTRATION_FIELD_CHOICES[field].map((value) => ({ label: settingLabel(field, value), value }));
}

const PREVIEW = 80;
const short = (text: string) => (text.length > PREVIEW ? `${text.slice(0, PREVIEW - 1).trimEnd()}…` : text);
const count = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/**
 * One unsaved change in words: "First question: “Can you vote?”", "Core Ideals: 4 ideals", "Intro: left empty",
 * "Fields: City optional, Phone not shown".
 */
export function describeFormChange(change: RegistrationFormChange): string {
  const label = FORM_PART_LABELS[change.part];
  switch (change.part) {
    case 'fields':
      return `${label}: ${REGISTRATION_FIELDS.flatMap((field) => {
        const to = change.to[field];
        return to ? [`${FIELD_LABELS[field]} ${settingLabel(field, to).toLowerCase()}`] : [];
      }).join(', ')}`;
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
