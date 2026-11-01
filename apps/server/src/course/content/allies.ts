import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'allies';
const lesson = lessonsOf(COURSE_ID);

const SOURCES = {
  constitution: 'United States Transhumanist Party, Constitution: https://transhumanist-party.org/constitution/',
  allies: 'United States Transhumanist Party, States and Allies: https://transhumanist-party.org/allied-organizations/',
  faq: 'United States Transhumanist Party, frequently asked questions: https://transhumanist-party.org/faq/',
};

/**
 * Who the United States Transhumanist Party names as its allies, from what it has published (researched 2026-11-01):
 * the state parties, its Allied Organizations, and the All Hands for a Free Future coalition with the U.S. Pirate Party.
 */
export const allies: SeededCourse = {
  courseId: COURSE_ID,
  title: 'Allies of the Transhumanist Party',
  summary:
    'Who the United States Transhumanist Party works with: the state Transhumanist Parties, the Allied Organizations it lists, and All Hands for a Free Future, its coalition with the U.S. Pirate Party.',
  placement: null,
  lessons: [
    lesson(
      'allies-states',
      1,
      'The state parties',
      'The state Transhumanist Parties, how the national party treats them, and how a new one starts.',
      6,
      [
        [
          'Fifteen state parties',
          'The national party’s page of states and allies lists state Transhumanist Parties in fifteen places: Arizona, Colorado, the District of Columbia, Florida, Illinois, Kentucky, Maryland, Michigan, Nevada, New York, North Carolina, Pennsylvania, Texas, Virginia and Washington.',
        ],
        [
          'Their own parties',
          'The Constitution of the United States Transhumanist Party respects the autonomy of the state parties and encourages new ones to form. It also lets the national party re-form a state party that has become inactive, as it did with the New York Transhumanist Party in 2022. A state party can also work with the national party on its state’s questions: in October 2026 the Nevada Transhumanist Party and the national party published their positions on the questions on Nevada’s 2026 ballot together.',
        ],
        [
          'Starting one',
          'Some state parties are registered with their state’s Secretary of State. Where there is no state party, the national party urges members to form one, and to contact it first. It has published no process for recognizing a state party: a state party’s leaders ask to be listed.',
        ],
        [
          'Sources',
          SOURCES.allies,
          SOURCES.constitution,
          SOURCES.faq,
          'United States Transhumanist Party, the declaration re-forming the NYTP (July 2022): https://transhumanist-party.org/2022/07/25/declaration-nytp-re-formation/',
          'United States Transhumanist Party, the Nevada Transhumanist Party’s positions on the 2026 ballot questions: https://transhumanist-party.org/2026/10/30/ntp-positions-2026-ballot-questions/',
        ],
      ],
      [
        question('al1-1', 'In how many places does the national party list a state Transhumanist Party?', ['Five', 'Fifteen', 'Fifty', 'Twenty-six'], 1, 'The page of states and allies lists state parties in fifteen places, from Arizona to Washington.'),
        question('al1-2', 'How does the USTP Constitution treat state parties?', ['It respects their autonomy and encourages new ones to form', 'It forbids them', 'It runs them all directly', 'It ignores them'], 0, 'The Constitution respects the autonomy of the state parties and encourages new ones.'),
        question('al1-3', 'What may the national party do with a state party that has become inactive?', ['Nothing', 'Sell it', 'Merge it with a major party', 'Re-form it'], 3, 'The Constitution lets the national party re-form an inactive state party, as it did with the New York Transhumanist Party in 2022.'),
        question('al1-4', 'Which state party published positions on its state’s 2026 ballot questions with the national party?', ['The New York Transhumanist Party', 'The Texas Transhumanist Party', 'The Nevada Transhumanist Party', 'The Florida Transhumanist Party'], 2, 'In October 2026 the Nevada Transhumanist Party and the national party published their positions on Nevada’s 2026 ballot questions together.'),
        question('al1-5', 'What should a member do first who wants to start a state party where there is none?', ['Contact the national party', 'Register with the Federal Election Commission', 'Wait for an invitation', 'Run for governor'], 0, 'The national party urges members to form a state party where there is none, and to contact it first.'),
      ],
    ),
    lesson(
      'allies-organizations',
      2,
      'Allied Organizations',
      'The organizations the party lists as allies, the Transhumanist Council, and what the Constitution says about allies.',
      7,
      [
        [
          'Fourteen organizations',
          'The national party lists fourteen Allied Organizations: AmpliCell Medical, Debt Nation, IFERS, the Institute of Exponential Sciences, Long Long Life, the LEV Foundation, the Longevity Meme Folding@home Team, MILE, The Rational Argumentator, the Revival Research Group, Sierra Sciences, THPedia, Transhumanism Australia and the Transhumanist Council. Many of them work on longevity and life extension, the party’s first Core Ideal. New members of the party, for example, receive discounts from AmpliCell Medical.',
        ],
        [
          'The Transhumanist Council',
          'Josh Universe announced the Transhumanist Council on November 22, 2024, and the party welcomed it as an Allied Organization. The party now calls itself a Recognized Organization of the Transhumanist Council, and also a Certified Vitalist Organization.',
        ],
        [
          'Allies in the Constitution',
          'The Constitution lets the Chairman designate allies, and lets the officers set up affiliated organizations that are not political. The party has Foreign Ambassadors in 26 countries, whose biographies mention transhumanist parties abroad, but it does not list those parties as allies. Nor is it affiliated with the Libertarian Party.',
        ],
        [
          'Sources',
          SOURCES.allies,
          SOURCES.constitution,
          SOURCES.faq,
          'United States Transhumanist Party, Membership: https://transhumanist-party.org/membership/',
          'United States Transhumanist Party, on the Transhumanist Council (November 2024): https://transhumanist-party.org/2024/11/26/transhumanist-council-worthy-effort/',
          'United States Transhumanist Party, home page: https://transhumanist-party.org/',
          'United States Transhumanist Party, Leadership: https://transhumanist-party.org/leadership/',
        ],
      ],
      [
        question('al2-1', 'How many Allied Organizations does the national party list?', ['Four', 'Nine', 'Fourteen', 'Twenty-six'], 2, 'The party lists fourteen Allied Organizations.'),
        question('al2-2', 'Which of these is one of the party’s Allied Organizations?', ['The LEV Foundation', 'The Federal Election Commission', 'The Libertarian Party', 'NASA'], 0, 'The LEV Foundation is one of the fourteen Allied Organizations; the party says it is not affiliated with the Libertarian Party.'),
        question('al2-3', 'Who announced the Transhumanist Council on November 22, 2024?', ['Zoltan Istvan', 'Gennady Stolyarov II', 'Hank Pellissier', 'Josh Universe'], 3, 'Josh Universe announced the Transhumanist Council, and the party welcomed it as an Allied Organization.'),
        question('al2-4', 'What does the Constitution let the Chairman do?', ['Change the Core Ideals', 'Designate allies', 'Spend the party’s budget', 'Admit states to the Union'], 1, 'The Constitution lets the Chairman designate allies, and the officers set up affiliated organizations that are not political.'),
        question('al2-5', 'Does the party list the transhumanist parties abroad, named in its Foreign Ambassadors’ biographies, as allies?', ['Yes, all of them', 'Only the largest', 'No, it does not list them as allies', 'They are part of the USTP'], 2, 'The party has Foreign Ambassadors in 26 countries, but does not list the parties abroad that their biographies mention as allies.'),
      ],
    ),
    lesson(
      'allies-coalition',
      3,
      'All Hands for a Free Future',
      'The party’s coalition with the U.S. Pirate Party: how the members chose it, how it is run, and the candidates it supports.',
      7,
      [
        [
          'A coalition with the Pirate Party',
          'All Hands for a Free Future is a coalition of the United States Transhumanist Party and the U.S. Pirate Party. The Transhumanist Party’s members voted to join it in an online vote from August 18 to September 1, 2025: 74 voted yes, 86.05%, with 7 against and 5 abstaining. The party announced the result on September 4, 2025.',
        ],
        [
          'How it works',
          'Under the coalition’s bylaws, each party keeps its own identity, and they endorse each other’s candidates. A Coalition Council governs it, and endorsing a candidate for President needs two-thirds of it. The two parties plan to run separate candidates for President in 2028, and perhaps a joint ticket in 2032.',
        ],
        [
          'Candidates in common',
          'With the coalition, the party endorsed Timothy Grady, an independent, for Governor of Ohio, and Zoltan Istvan, a Democrat, for Governor of California; Istvan suspended his campaign on February 24, 2026. In April 2026 the party said that all five candidates it then endorsed were also endorsed by the Pirate Party. The course that follows, The Coalition, looks at the Pirate Party itself.',
        ],
        [
          'Sources',
          'United States Transhumanist Party, the coalition vote and the Grady and Istvan endorsements (September 2025): https://transhumanist-party.org/2025/09/04/ustp-allhandsfuture-grady-istvan-endorsement/',
          'United States Transhumanist Party, bylaws of All Hands for a Free Future (August 2025): https://transhumanist-party.org/2025/08/18/bylaws-all-hands-for-a-free-future/',
          'United States Transhumanist Party, the Karas and Henry endorsements (April 2026): https://transhumanist-party.org/2026/04/22/ustp-karas-henry-endorsements/',
        ],
      ],
      [
        question('al3-1', 'Which party is the USTP’s partner in All Hands for a Free Future?', ['The Libertarian Party', 'The U.S. Pirate Party', 'The Green Party', 'The Longevity Party'], 1, 'All Hands for a Free Future is a coalition of the USTP and the U.S. Pirate Party.'),
        question('al3-2', 'How many of the USTP’s members voted yes to joining the coalition in 2025?', ['37, 86%', '7, 8%', '5, 6%', '74, 86.05%'], 3, 'In the vote from August 18 to September 1, 2025, 74 members voted yes, 86.05%, with 7 against and 5 abstaining.'),
        question('al3-3', 'What happens to each party’s identity in the coalition?', ['Each keeps its own identity', 'They merge into one party', 'The Pirate Party joins the USTP', 'Both take a new name'], 0, 'Under the bylaws, each party keeps its own identity, and they endorse each other’s candidates.'),
        question('al3-4', 'What does it take for the coalition to endorse a candidate for President?', ['The USTP Chairman alone', 'A simple majority of members', 'Two-thirds of the Coalition Council', 'A vote of the public'], 2, 'A Coalition Council governs the coalition, and presidential endorsements need two-thirds of it.'),
        question('al3-5', 'What do the two parties plan for the presidential elections of 2028 and 2032?', ['A joint ticket in 2028', 'Separate candidates in 2028, and perhaps a joint ticket in 2032', 'No candidates at all', 'To merge before 2028'], 1, 'They plan separate candidates for President in 2028, and perhaps a joint ticket in 2032.'),
      ],
    ),
  ],
};
