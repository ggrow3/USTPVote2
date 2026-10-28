import { z } from 'zod';
import { ELECTION_PACKAGE_FORMAT, electionPackageSchema, type ElectionPackage, type ElectionPackageInput } from './election-package.js';
import { MIN_K_ANONYMITY, SECRECY_MODES, type ElectionDetail, type Secrecy } from './elections.js';
import type { Random } from './test-votes.js';

/**
 * Demo elections (design §10.4): a whole election made up at random, on Transhumanist themes, to show the system from
 * start to finish on a test deployment. `demoElection` is a pure function of the random numbers it is given, so a seed
 * (`seededRandom`) gives the same contests, candidates and texts everywhere. Every person in it is invented: a
 * candidate's name pairs a first name and a surname from the lists below, which the tests check against real people.
 */

/** Every demo election's title starts with this, wherever the title is shown. */
export const DEMO_TITLE_PREFIX = '[Demo] ';

/** How long after it is made a demo opens: `now` at the worker's next tick, `soon` five minutes later. */
export const DEMO_OPENINGS = { now: 60, soon: 300 } as const;
export type DemoOpening = keyof typeof DEMO_OPENINGS;

/** The voting windows the web app offers, in minutes. */
export const DEMO_VOTING_MINUTES = [10, 15, 30, 60, 120, 1440] as const;

/** Active test voters a demo makes sure there are, adding test voters if needed, so a secret ballot has company. */
export const DEMO_MIN_TEST_VOTERS = 5;

/** `POST /v1/testing/demo-elections`. */
export const demoElectionInputSchema = z.strictObject({
  opens: z.enum(['now', 'soon']).default('now'),
  votingMinutes: z.number().int().min(5).max(1440).default(15),
  /** Chosen at random when left out. */
  secrecy: z.enum(SECRECY_MODES).optional(),
  /** The same seed makes the same contests, candidates and texts; a random one when left out. */
  seed: z.string().trim().min(1).max(64).optional(),
});
export type DemoElectionInput = z.input<typeof demoElectionInputSchema>;

/** The demo as scheduled, and the seed it was made from. */
export interface DemoElectionResult {
  readonly seed: string;
  readonly election: ElectionDetail;
}

export interface DemoElectionOptions {
  /** When it is made: the window counts from here, and its title names this year or the next. */
  readonly now: Date;
  readonly opensInSeconds: number;
  readonly votingSeconds: number;
  /** Secret or roll-call; chosen at random when not given. */
  readonly secrecy?: Secrecy;
}

/**
 * A demo election as a `ustp.election` package (design §6.7), to import as a draft: a title starting "[Demo]", one
 * leadership office and one or two others, each with two to four candidates elected by ranked choice, plurality or
 * approval, sometimes a committee electing several, and up to two ballot measures. No contest fills an office and no
 * candidate is linked to an account, so certifying it seats nobody and it can be deleted afterwards (§6.1).
 */
export function demoElection(random: Random, options: DemoElectionOptions): ElectionPackage {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const sample = <T>(items: readonly T[], n: number): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, n);
  };

  const group = pick(GROUPS);
  const year = options.now.getUTCFullYear() + between(0, 1);
  const secrecy = options.secrecy ?? pick<Secrecy>(['secret', 'secret', 'open']);
  const offices = [pick(LEADERSHIP), ...sample(DIRECTORS, between(1, 2))];
  const committee = random() < 0.4 ? pick(COMMITTEES) : null;
  const measures = sample(MEASURES, pick([0, 1, 1, 2]));

  const sizes = [...offices.map(() => between(2, 4)), ...(committee ? [committee.seats + between(1, 2)] : [])];
  const total = sizes.reduce((a, b) => a + b, 0);
  const firsts = sample(DEMO_FIRST_NAMES, total);
  const lasts = sample(DEMO_SURNAMES, total);
  let drawn = 0;
  const candidates = (n: number, office: string) =>
    Array.from({ length: n }, () => {
      const i = drawn++;
      return { name: `${firsts[i]} ${lasts[i]}`, statement: statement(pick, office) };
    });

  const contests: ElectionPackageInput['contests'] = offices.map((office, i) => {
    const common = { title: office.title, description: office.description.replace('{group}', group), candidates: candidates(sizes[i]!, office.title) };
    const system = pick(['irv', 'plurality', 'approval'] as const);
    if (system === 'irv') return { kind: 'irv' as const, ...common };
    return { kind: 'choose_n' as const, ...common, seats: 1, maxSelections: system === 'plurality' ? 1 : common.candidates.length };
  });
  if (committee) {
    const listed = candidates(sizes.at(-1)!, `a member of the ${committee.title}`);
    contests.push({
      kind: 'choose_n',
      title: `${committee.title} (${committee.seats} seats)`,
      description: committee.description.replace('{group}', group),
      seats: committee.seats,
      maxSelections: committee.seats,
      candidates: listed,
    });
  }
  for (const measure of measures) {
    const twoThirds = random() < 0.3;
    contests.push({
      kind: 'proposal',
      title: measure.title,
      description: measure.description,
      passRule: {
        threshold: twoThirds ? { ratio: { num: 2, den: 3 }, comparison: 'gte' } : { ratio: { num: 1, den: 2 }, comparison: 'gt' },
        base: 'yes_no',
      },
      proposal: { body: `${measure.body}\n\n${DEMO_MEASURE_NOTE}`, source: MEASURE_SOURCE },
    });
  }

  const choosing = ['its officers', 'its officers and decides on a ballot measure', 'its officers and decides on two ballot measures'][
    measures.length
  ];
  const input: ElectionPackageInput = {
    format: ELECTION_PACKAGE_FORMAT,
    v: 1,
    title: `${DEMO_TITLE_PREFIX}${year} ${group} ${pick(EVENTS)}`,
    description:
      `The ${group} chooses ${choosing} for ${year}. ` +
      'This is a demonstration election, made up at random for testing: every candidate, platform and resolution is ' +
      'invented, and no real person is standing. Its voters are the test voters, and it sends no email.',
    secrecy,
    kAnonymity: MIN_K_ANONYMITY,
    window: { opensInSeconds: options.opensInSeconds, votingSeconds: options.votingSeconds },
    contests,
  };
  return electionPackageSchema.parse(input);
}

/** A candidate's platform: who they are and two things they will do. */
function statement(pick: <T>(items: readonly T[]) => T, office: string): string {
  const background = pick(BACKGROUNDS);
  const first = pick(PLEDGES);
  const second = pick(PLEDGES.filter((p) => p !== first));
  const article = /^[aeiou]/i.test(background) ? 'An' : 'A';
  return `${article} ${background}. ${pick(OPENERS).replace('{office}', office)} ${first}, and ${second}.`;
}

/** The note every demo measure ends with. */
export const DEMO_MEASURE_NOTE = 'This text was made up for a demo election. It is not party policy.';
const MEASURE_SOURCE = 'Made up for a demo election';

/** Invented names only: no first name or surname here is a real transhumanist's or party officer's (see the tests). */
export const DEMO_FIRST_NAMES = [
  'Aurelia', 'Bastian', 'Calla', 'Dorian', 'Elowen', 'Fenwick', 'Galen', 'Halcyon', 'Isolde', 'Jovan',
  'Kestrel', 'Lumen', 'Marisol', 'Nyx', 'Oberon', 'Perpetua', 'Quill', 'Rhiannon', 'Soren', 'Tamsin',
  'Ulric', 'Vesper', 'Wren', 'Xanthe', 'Yara', 'Zephyr', 'Orla', 'Thaddeus', 'Ione', 'Caspian',
] as const;

export const DEMO_SURNAMES = [
  'Ashgrove', 'Brightwater', 'Corvane', 'Dawnmere', 'Emberlyn', 'Farrowmoor', 'Glimmerholt', 'Hollowell', 'Ironvale', 'Kestwick',
  'Larkmoor', 'Moonfield', 'Northvane', 'Oakhaven', 'Quillfeather', 'Ravenmere', 'Silverthorn', 'Thornwick', 'Umberfield', 'Vantaro',
  'Wyndmere', 'Yarrowby', 'Zenthari', 'Starwright', 'Helixford', 'Solvayne', 'Mirrowen', 'Cindervale', 'Fairhallow', 'Lumenford',
] as const;

const GROUPS = [
  'Longevity Caucus',
  'Mars Settlement Chapter',
  'Neurorights Working Group',
  'Cryonics Circle',
  'Open Biology Guild',
  'AI Futures Council',
  'Morphological Freedom League',
  'Youth Futurist Network',
  'Healthspan Alliance',
  'Uplift Society',
  'Brain–Computer Interface Forum',
  'Lunar Outreach Chapter',
] as const;

const EVENTS = ['Officer Election', 'Leadership Election', 'Annual Election', 'General Assembly Vote', 'Steering Election'] as const;

interface Office {
  readonly title: string;
  /** `{group}` is filled in. */
  readonly description: string;
}

const LEADERSHIP: readonly Office[] = [
  { title: 'Chair', description: 'Leads the meetings of the {group} and speaks for it between them.' },
  { title: 'Vice-Chair', description: 'Stands in for the Chair and looks after the {group}’s volunteers.' },
  { title: 'Secretary', description: 'Keeps the minutes and the membership list of the {group}.' },
  { title: 'Treasurer', description: 'Keeps the books of the {group} and reports on them every quarter.' },
];

const DIRECTORS: readonly Office[] = [
  { title: 'Director of Life-Extension Outreach', description: 'Brings the case for longer, healthier lives to the public.' },
  { title: 'Director of AI Ethics', description: 'Leads the {group}’s work on safe and humane artificial intelligence.' },
  { title: 'Cryonics Liaison', description: 'Keeps members informed about brain preservation and cryonics.' },
  { title: 'Space Settlement Coordinator', description: 'Plans the {group}’s events on living and working beyond Earth.' },
  { title: 'Neurorights Officer', description: 'Speaks up for privacy of thought and the freedom of the mind.' },
  { title: 'Director of Open-Source Biology', description: 'Connects members with community labs and open research.' },
  { title: 'Morphological Freedom Advocate', description: 'Defends the right to change one’s own body and mind.' },
  { title: 'Youth Outreach Coordinator', description: 'Welcomes students and young futurists to the {group}.' },
  { title: 'Longevity Research Liaison', description: 'Follows aging research and reports what it means for policy.' },
  { title: 'Director of Futures Education', description: 'Runs the {group}’s talks, reading lists and courses.' },
];

const COMMITTEES: readonly (Office & { readonly seats: number })[] = [
  { title: 'Steering Committee', seats: 2, description: 'Sets the {group}’s priorities between general meetings.' },
  { title: 'Platform Committee', seats: 3, description: 'Drafts the {group}’s positions for the members to vote on.' },
  { title: 'Ethics Board', seats: 2, description: 'Hears complaints and advises the officers of the {group}.' },
];

const BACKGROUNDS = [
  'biogerontology lab technician',
  'open-source prosthetics designer',
  'orbital habitat engineer',
  'neuroethics graduate student',
  'longevity clinic nurse',
  'machine-learning researcher',
  'science-fiction librarian',
  'gene-therapy patient advocate',
  'cryonics standby volunteer',
  'high-school biology teacher',
  'retired machinist who builds robots',
  'community-garden organizer turned biohacker',
  'data-privacy lawyer',
  'veteran of three Mars analog missions',
  'nanomaterials chemist',
  'sleep-science podcaster',
] as const;

/** `{office}` is filled in. */
const OPENERS = ['I will', 'If elected, I will', 'As {office}, I will', 'My plan is to'] as const;

const PLEDGES = [
  'push for open access to rejuvenation therapies',
  'start a monthly reading circle on longevity science',
  'defend every member’s right to modify their own body',
  'ask lawmakers to hold hearings on the rights of artificial minds',
  'fund small grants for citizen-science studies of aging',
  'publish a plain-language guide to brain preservation',
  'invite brain–computer interface researchers to our meetings',
  'build a coalition with community biology labs',
  'campaign for aging to be treated as a disease in health policy',
  'keep the books open to every member',
  'organize a regional futurist conference',
  'set up mentoring for young transhumanists',
  'draft a charter for humane AI development',
  'bring morphological freedom into local anti-discrimination rules',
  'plan a lunar outreach day with space-settlement engineers',
  'answer every member’s email within a week',
] as const;

interface Measure {
  readonly title: string;
  readonly description: string;
  readonly body: string;
}

const MEASURES: readonly Measure[] = [
  {
    title: 'Amend the Plank on Morphological Freedom',
    description: 'Rewords the platform plank on changing one’s own body and mind.',
    body:
      'Resolved, that the platform plank on morphological freedom be amended to read: “Every person has the right to ' +
      'keep, change or enhance their own body and mind by any safe means they choose, and no law should forbid an ' +
      'enhancement that harms no one else.”',
  },
  {
    title: 'Resolution on the Rights of Artificial Minds',
    description: 'Supports legal protection for artificial intelligences shown to be sentient.',
    body:
      'Resolved, that we support legal recognition for any artificial intelligence shown to be sentient, including ' +
      'protection from arbitrary deletion and a say in decisions about copies of itself.',
  },
  {
    title: 'Universal Access to Rejuvenation Therapies',
    description: 'Asks health plans to cover proven treatments for biological aging.',
    body:
      'Resolved, that therapies proven to slow or reverse biological aging should be covered by public and private ' +
      'health plans like any other treatment, so that a longer, healthier life does not depend on wealth.',
  },
  {
    title: 'Add a Plank on Cognitive Liberty',
    description: 'Adds a platform plank on the privacy of thoughts and neural data.',
    body:
      'Resolved, that the platform gain a plank on cognitive liberty: each person’s thoughts, memories and neural data ' +
      'belong to them, and no one may read, alter or sell them without informed consent.',
  },
  {
    title: 'Charter for Off-World Settlements',
    description: 'Calls for settlements beyond Earth to guarantee their residents’ rights.',
    body:
      'Resolved, that any permanent settlement beyond Earth should adopt a charter guaranteeing its residents the same ' +
      'rights as the people of the country that founded it, the right to vote included.',
  },
  {
    title: 'Open Science Pledge',
    description: 'Asks the research we endorse to publish its data and results openly.',
    body:
      'Resolved, that we ask every research project we endorse to publish its data and results openly, so that ' +
      'discoveries about aging, cognition and disease benefit everyone.',
  },
  {
    title: 'Defeating Aging as a Public Goal',
    description: 'Declares the defeat of aging a goal of public health policy.',
    body:
      'Resolved, that public policy should treat the defeat of aging as a goal worth the same effort as any other cure, ' +
      'and that no law should require anyone to grow old and die.',
  },
];
