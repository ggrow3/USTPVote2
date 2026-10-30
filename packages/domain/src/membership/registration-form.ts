import { z } from 'zod';
import { deny, OK, type Check } from '../check.js';

/**
 * The registration form's wording (design §5.2): the Register page's heading and the intro above its steps, the two
 * membership questions and their help text, the Core Ideals shown before the second question, and the bonus link
 * applicants get once they have applied. Membership Admins change the wording. What each answer means is fixed here,
 * since rules hang off it: Yes or No to the first makes a United States or an Allied Member, and the second records
 * agreement with the Core Ideals. Neither answer ever blocks an application.
 */

/** A member's class, from their answer to the first question. */
export const MEMBER_CLASSES = ['united_states', 'allied'] as const;
export type MemberClass = (typeof MEMBER_CLASSES)[number];

/** Yes makes a United States Member, No an Allied Member; null for someone never asked (they joined before it was). */
export function memberClass(usVoteEligible: boolean | null | undefined): MemberClass | null {
  if (typeof usVoteEligible !== 'boolean') return null;
  return usVoteEligible ? 'united_states' : 'allied';
}

/** The most each part may hold once tidied, and how many Core Ideals there may be. */
export const REGISTRATION_FORM_LIMITS = {
  title: 120,
  intro: 4000,
  question: 300,
  help: 1000,
  idealsTitle: 120,
  ideal: 500,
  ideals: 10,
  tipsTitle: 120,
  tipsAddress: 500,
} as const;

export interface RegistrationForm {
  /** The Register page's heading: "Register as a member". */
  readonly title: string;
  /** Paragraphs, separated by a blank line; empty shows no intro. */
  readonly intro: string;
  /** "Are you eligible to vote in any United States elections?" */
  readonly usVoterQuestion: string;
  readonly usVoterHelp: string;
  /** The heading over the Core Ideals. */
  readonly idealsTitle: string;
  /** Each ideal's words, in order; the page numbers them ("Ideal 1."). */
  readonly ideals: readonly string[];
  /** "Do you agree with the Core Ideals … listed above?" */
  readonly coreIdealsQuestion: string;
  readonly coreIdealsHelp: string;
  /** The bonus link's title, shown once someone has applied. */
  readonly tipsTitle: string;
  /** Its `https://` address; empty shows no link. */
  readonly tipsAddress: string;
}

/** The parts of the form in the order the settings show them, as changes name them. */
export const REGISTRATION_FORM_PARTS = [
  'title',
  'intro',
  'usVoterQuestion',
  'usVoterHelp',
  'idealsTitle',
  'ideals',
  'coreIdealsQuestion',
  'coreIdealsHelp',
  'tipsTitle',
  'tipsAddress',
] as const satisfies readonly (keyof RegistrationForm)[];
export type RegistrationFormPart = (typeof REGISTRATION_FORM_PARTS)[number];

/** `registration_form/current`, and each saved version in `registration_form_versions/{version}`; version 0 is the default. */
export interface RegistrationFormRecord extends RegistrationForm {
  /** Counts saves: an edit made from an older copy is refused, and each application records the version it answered. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

/** `GET /v1/registration/form`: what the Register page shows, without who changed it. */
export type PublicRegistrationForm = RegistrationForm & { readonly version: number };

/**
 * The party's own wording for its membership form. The sentence linking to "a separate page containing the form" is
 * left out: here the form is the page itself. No address is filled in for the bonus link, which is never guessed.
 */
export const DEFAULT_REGISTRATION_FORM: RegistrationForm = {
  title: 'Register as a member',
  intro: [
    'Become a member of the U.S. Transhumanist Party for free by filling out this concise Membership Application Form.',
    "As a bonus for completing this form, you will receive a link to a free compilation of Tips for Advancing a Brighter Future, providing insights from the U.S. Transhumanist Party's Advisors and Officers on some of what you can do as an individual to improve the world and bring it closer to the kind of future we wish to see. This short document could help you see improvement in your own life, while you become empowered to act to bring about the next era of our civilization.",
    'Members also become eligible for discounts on certain procedures from AmpliCell Medical, one of our Allied Organizations, located in the Los Angeles area and specializing in regenerative medicine and stem-cell therapies.',
  ].join('\n\n'),
  usVoterQuestion: 'Are you eligible to vote in any United States elections?',
  usVoterHelp:
    '(Answer "Yes" or "No". The answer will determine whether you will be a United States Member or an Allied Member. You will not be rejected due to a "No" answer.)',
  idealsTitle: 'Core Ideals of the Transhumanist Party',
  ideals: [
    'The Transhumanist Party supports significant life extension achieved through the progress of science and technology.',
    'The Transhumanist Party supports a cultural, societal, and political atmosphere informed and animated by reason, science, and secular values.',
    'The Transhumanist Party supports efforts to use science, technology, and rational discourse to reduce and eliminate various existential risks to the human species.',
  ],
  coreIdealsQuestion:
    'Do you agree with the Core Ideals of the Transhumanist Party listed above (however you may interpret those ideals)?',
  coreIdealsHelp:
    '(Answer "Yes" or "No". You will not be rejected for membership due to a "No" answer and will still be able to participate in discussions. However, voting on platform planks and organizational structure may, at the Chairman\'s discretion, be limited to those members who answered "Yes" to this question, in order to ensure that the platform and party structure are representative of the views of those who hold core transhumanist ideals.)',
  tipsTitle: 'Tips for Advancing a Brighter Future',
  tipsAddress: '',
};

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Each paragraph on one line, empty ones dropped, separated by one blank line. */
export function tidyIntro(intro: string): string {
  return introParagraphs(intro).join('\n\n');
}

/** The intro's paragraphs, as the page sets them: split at blank lines, each on one line. */
export function introParagraphs(intro: string): string[] {
  return intro
    .split(/\n\s*\n/)
    .map(oneLine)
    .filter((p) => p.length > 0);
}

type Stored = { readonly [K in keyof RegistrationForm]?: unknown };

/** The wording in force from what was saved, tidied, with the default for anything missing. */
export function resolveRegistrationForm(stored: Stored | null | undefined): RegistrationForm {
  const text = (part: Exclude<RegistrationFormPart, 'ideals'>) => {
    const value = stored?.[part];
    return typeof value === 'string' ? value : DEFAULT_REGISTRATION_FORM[part];
  };
  const ideals = Array.isArray(stored?.ideals) ? stored.ideals.filter((i): i is string => typeof i === 'string') : DEFAULT_REGISTRATION_FORM.ideals;
  return {
    title: oneLine(text('title')),
    intro: tidyIntro(text('intro')),
    usVoterQuestion: oneLine(text('usVoterQuestion')),
    usVoterHelp: oneLine(text('usVoterHelp')),
    idealsTitle: oneLine(text('idealsTitle')),
    ideals: ideals.map(oneLine).filter((i) => i.length > 0),
    coreIdealsQuestion: oneLine(text('coreIdealsQuestion')),
    coreIdealsHelp: oneLine(text('coreIdealsHelp')),
    tipsTitle: oneLine(text('tipsTitle')),
    tipsAddress: text('tipsAddress').trim(),
  };
}

/** Why the bonus link's address cannot be used, if it cannot. Empty shows no link. */
export function tipsAddressProblem(address: string): string | null {
  if (!address) return null;
  if (address.length > REGISTRATION_FORM_LIMITS.tipsAddress) {
    return `the address can be at most ${REGISTRATION_FORM_LIMITS.tipsAddress} characters`;
  }
  if (/\s/.test(address)) return 'an address cannot contain spaces';
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return 'use an https:// address';
  }
  return parsed.protocol === 'https:' ? null : parsed.protocol === 'http:' ? 'use the https:// address' : 'use an https:// address';
}

/**
 * Whether tidied wording can be saved: each part within its limit; the page's heading, both questions, the Core
 * Ideals' heading and at least one ideal (the second question refers to them); and a bonus link with a title and an
 * https:// address, or no address at all. The intro and the help texts may be empty.
 */
export function checkRegistrationForm(form: RegistrationForm): Check {
  const L = REGISTRATION_FORM_LIMITS;
  const lengths: [string, number, number][] = [
    ["the page's heading", form.title.length, L.title],
    ['the intro', form.intro.length, L.intro],
    ['the first question', form.usVoterQuestion.length, L.question],
    ["the first question's help", form.usVoterHelp.length, L.help],
    ["the Core Ideals' heading", form.idealsTitle.length, L.idealsTitle],
    ['the second question', form.coreIdealsQuestion.length, L.question],
    ["the second question's help", form.coreIdealsHelp.length, L.help],
    ["the bonus link's title", form.tipsTitle.length, L.tipsTitle],
  ];
  for (const [name, length, max] of lengths) {
    if (length > max) return deny(`${name} can be at most ${max} characters`);
  }
  if (!form.title) return deny('the page needs a heading');
  if (!form.usVoterQuestion) return deny('the first question needs its words');
  if (!form.coreIdealsQuestion) return deny('the second question needs its words');
  if (!form.idealsTitle) return deny('the Core Ideals need a heading');
  if (form.ideals.length === 0) return deny('list at least one Core Ideal');
  if (form.ideals.length > L.ideals) return deny(`list at most ${L.ideals} Core Ideals`);
  const long = form.ideals.findIndex((i) => i.length > L.ideal);
  if (long >= 0) return deny(`Ideal ${long + 1} can be at most ${L.ideal} characters`);
  const address = tipsAddressProblem(form.tipsAddress);
  if (address) return deny(`the bonus link: ${address}`);
  if (form.tipsAddress && !form.tipsTitle) return deny('the bonus link needs a title');
  return OK;
}

/** One part that changed, with its new value, as the ledger records it (`registration_form.changed`). */
export type RegistrationFormChange = {
  readonly [K in RegistrationFormPart]: { readonly part: K; readonly to: RegistrationForm[K] };
}[RegistrationFormPart];

/** `registration_form.changed`: the wording's new version and every part that changed in it. */
export interface RegistrationFormChangedPayload {
  readonly version: number;
  readonly changes: readonly RegistrationFormChange[];
}

const same = (a: RegistrationForm[RegistrationFormPart], b: RegistrationForm[RegistrationFormPart]) =>
  typeof a === 'string' || typeof b === 'string' ? a === b : a.length === b.length && a.every((x, i) => x === b[i]);

/** Every part that differs between two versions of the wording, in the settings' order. */
export function registrationFormChanges(before: RegistrationForm, after: RegistrationForm): RegistrationFormChange[] {
  return REGISTRATION_FORM_PARTS.filter((part) => !same(before[part], after[part])).map(
    (part) => ({ part, to: after[part] }) as RegistrationFormChange,
  );
}

/** Raw parts are capped well above the limits, which apply once the whitespace is tidied. */
const raw = (max: number) => z.string().max(max);

/** `PUT /v1/admin/registration-form`: the whole wording, and the version it was edited from. */
export const registrationFormSchema = z.strictObject({
  basedOn: z.number().int().min(0),
  title: raw(1000),
  intro: raw(8000),
  usVoterQuestion: raw(1000),
  usVoterHelp: raw(3000),
  idealsTitle: raw(1000),
  ideals: z.array(raw(2000)).max(20),
  coreIdealsQuestion: raw(1000),
  coreIdealsHelp: raw(3000),
  tipsTitle: raw(1000),
  tipsAddress: raw(1000),
});
export type RegistrationFormInput = z.infer<typeof registrationFormSchema>;
