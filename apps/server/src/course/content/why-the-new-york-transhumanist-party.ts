import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'why-the-new-york-transhumanist-party';
const lesson = lessonsOf(COURSE_ID);

/**
 * Why a New York Transhumanist Party, from what it has published about its aims and from New York's election law
 * (researched 2026-11-01): what it stands for in New York, and what a small party there must do to reach the ballot.
 */
export const whyTheNewYorkTranshumanistParty: SeededCourse = {
  courseId: COURSE_ID,
  title: 'Why the New York Transhumanist Party?',
  summary:
    'Why a transhumanist party in New York: what the New York Transhumanist Party sets out to do there, and how New York’s election law treats parties, independent bodies and their candidates.',
  placement: null,
  lessons: [
    lesson(
      'nytp-aims',
      1,
      'Science, health and technology in New York politics',
      'What the NYTP says it is for, its first New York position, and what a state party adds to a national one.',
      6,
      [
        [
          'Its aim',
          'The New York Transhumanist Party says on its website that it aims to bring science, health and technology to the forefront of politics in New York. Its constitution names the principles it brings: life extension through science and technology; reason, science and secular values; reducing existential risk; renouncing violence except in self-defense; and avoiding wedge issues.',
        ],
        [
          'A position for New York',
          'A state party can take up questions that belong to its own state. The NYTP’s first recorded position of this kind came from a poll of its members on April 4, 2022, which condemned sweeps of homeless people’s camps. When the national party re-formed the NYTP in July 2022, it recognized that position as official.',
        ],
        [
          'Local organizing, a shared platform',
          'The NYTP shares the platform of the United States Transhumanist Party word for word, so what it adds is not a second set of policies but people in New York who organize there. When the USTP announced the NYTP’s new officers in 2023, it said it expected them to organize events in New York State. Its membership is open beyond the state: people who do not live in New York may join as Allied Members.',
        ],
        [
          'Sources',
          'New York Transhumanist Party, website: https://nytranshumanistparty.wixsite.com/nytp/',
          'United States Transhumanist Party, the NYTP Constitution (October 2022): https://transhumanist-party.org/2022/10/17/nytp-constitution/',
          'United States Transhumanist Party, the declaration re-forming the NYTP (July 2022): https://transhumanist-party.org/2022/07/25/declaration-nytp-re-formation/',
          'United States Transhumanist Party, the Chairman’s sixth anniversary message (January 2023): https://transhumanist-party.org/2023/01/01/ustp-chairman-6th-anniversary/',
        ],
      ],
      [
        question('wny1-1', 'What does the NYTP say it aims to bring to the forefront of politics in New York?', ['Sports, music and film', 'Science, health and technology', 'Lower taxes and fewer rules', 'Farming and fishing'], 1, 'The NYTP aims to bring science, health and technology to the forefront of politics in New York.'),
        question('wny1-2', 'What did the NYTP’s members condemn in a poll on April 4, 2022?', ['Sweeps of homeless people’s camps', 'A new subway line', 'Public libraries', 'Space research'], 0, 'A poll on April 4, 2022 condemned sweeps of homeless people’s camps, and the national party later recognized it as an official NYTP position.'),
        question('wny1-3', 'What does the NYTP add, given that it shares the USTP’s platform word for word?', ['A second, different platform', 'Nothing at all', 'People in New York who organize there', 'Its own national candidates'], 2, 'Because the platform is shared, what the state party adds is people who organize in New York.'),
        question('wny1-4', 'What did the USTP expect the NYTP’s new officers to do?', ['Write a new platform', 'Run for governor', 'Leave the USTP', 'Organize events in New York State'], 3, 'In 2023 the USTP said it expected the NYTP’s new leaders to organize events in New York State.'),
        question('wny1-5', 'Can someone who does not live in New York join the NYTP?', ['Yes, as an Allied Member', 'No, never', 'Only if they move to New York', 'Only as an officer'], 0, 'People who do not live in New York, or cannot vote there, may join as Allied Members.'),
      ],
    ),
    lesson(
      'ny-election-law',
      2,
      'Parties and independent bodies in New York',
      'How New York decides which groups are parties, what an independent body is, and what a candidate needs to reach the ballot without a party.',
      8,
      [
        [
          'Party or independent body',
          'New York’s Election Law (section 1-104) calls an organization a party only when its candidate for governor, and in a presidential year its candidate for president, received at least 2% of the vote or 130,000 votes, whichever is greater. Any other group that nominates candidates is an independent body. As of 2025, New York recognized four parties: the Democratic, Republican, Conservative and Working Families parties. The New York Transhumanist Party is not one of them.',
        ],
        [
          'Reaching the ballot by petition',
          'Candidates of an independent body get onto the ballot with independent nominating petitions (section 6-142): for an office elected by the whole state, 45,000 signatures or 1% of the votes cast for governor at the last election, whichever is less; for the State Assembly, 1,500. An independent body may choose its own name, but not one that could be confused with the name of an existing party (section 6-138).',
        ],
        [
          'An example from 2018',
          'The national party’s answers to common questions say that its local candidates will likely have to run as independents. In 2018 James D. Schultz ran as an independent for the New York State Assembly in District 2. The United States Transhumanist Party endorsed him on April 12, 2018, after its members voted 49 for, 5 against and 3 abstaining. He ended his campaign on August 21, 2018, with 1,239 of the 1,500 signatures he needed.',
        ],
        [
          'What it shows',
          'Without party status, reaching New York’s ballot takes many people collecting signatures, the kind of work a state party can organize. The 2018 campaign came within a few hundred signatures of it.',
        ],
        [
          'Sources',
          'New York State Senate, Election Law section 1-104: https://www.nysenate.gov/legislation/laws/ELN/1-104',
          'New York State Senate, Election Law section 6-142: https://www.nysenate.gov/legislation/laws/ELN/6-142',
          'New York State Senate, Election Law section 6-138: https://www.nysenate.gov/legislation/laws/ELN/6-138',
          'New York State Board of Elections, Committee Information: https://elections.ny.gov/committee-information',
          'United States Transhumanist Party, frequently asked questions: https://transhumanist-party.org/faq/',
          'United States Transhumanist Party, the endorsement of James D. Schultz (April 2018): https://transhumanist-party.org/2018/04/12/ustp-endorses-schultz/',
          'United States Transhumanist Party, the end of the Schultz campaign (August 2018): https://transhumanist-party.org/2018/08/22/schultz-ends-campaign/',
        ],
      ],
      [
        question('wny2-1', 'When is an organization a party under New York’s Election Law?', ['When it has a website', 'When its candidate for governor (and for president in a presidential year) got at least 2% of the vote or 130,000 votes, whichever is greater', 'When it has 110 members', 'When the national party says so'], 1, 'Section 1-104 makes a party of an organization whose candidate for governor, and for president in presidential years, reached the greater of 2% or 130,000 votes.'),
        question('wny2-2', 'What is a group that nominates candidates but is not a party called in New York?', ['A caucus', 'A committee', 'An independent body', 'A club'], 2, 'Any group that nominates candidates but is not a party is an independent body.'),
        question('wny2-3', 'How many signatures does an independent candidate for the New York State Assembly need?', ['150', '15,000', '45,000', '1,500'], 3, 'Independent nominating petitions for the State Assembly need 1,500 signatures (section 6-142).'),
        question('wny2-4', 'Which of these was one of the four parties New York recognized as of 2025?', ['The Working Families Party', 'The New York Transhumanist Party', 'The Pirate Party', 'The Green Party'], 0, 'As of 2025 the four were the Democratic, Republican, Conservative and Working Families parties.'),
        question('wny2-5', 'How many of the 1,500 signatures he needed did James D. Schultz have when he ended his 2018 campaign?', ['49', '435', '1,239', '110'], 2, 'He ended his campaign on August 21, 2018, with 1,239 of the 1,500 signatures he needed.'),
      ],
    ),
  ],
};
