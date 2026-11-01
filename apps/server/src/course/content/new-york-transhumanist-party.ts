import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'new-york-transhumanist-party';
const lesson = lessonsOf(COURSE_ID);

/**
 * The New York Transhumanist Party, from what it and the United States Transhumanist Party have published (researched
 * 2026-11-01): what it is, its re-formation in 2022, and its constitution and officers.
 */
export const newYorkTranshumanistParty: SeededCourse = {
  courseId: COURSE_ID,
  title: 'Introduction to the New York Transhumanist Party',
  summary:
    'The New York Transhumanist Party: a state party under the auspices of the United States Transhumanist Party, how it was re-formed in 2022, and the constitution, officers, principles and membership it has had since.',
  placement: null,
  lessons: [
    lesson(
      'nytp-what',
      1,
      'What the New York Transhumanist Party is',
      'A state party listed by the United States Transhumanist Party, where it is online, and how its first members found one another.',
      6,
      [
        [
          'A state party',
          'The New York Transhumanist Party, or NYTP, is one of the state parties that the United States Transhumanist Party (USTP) lists on its page of states and allies. Its own constitution says that it operates under the auspices of the United States Transhumanist Party: it is the party’s home in New York, not a separate national movement.',
        ],
        [
          'Where to find it',
          'The NYTP keeps a website at nytranshumanistparty.wixsite.com/nytp and a page of links at linktr.ee/NYTP, which points to its accounts on Instagram, X, Discord, Facebook and YouTube. The USTP’s page of states and allies also links to its Facebook group.',
        ],
        [
          'The New York Regional Liaison',
          'Since August 3, 2022, the USTP has had a Regional Liaison for New York, Dinorah Delfin. The liaison is a role of the national party rather than an office of the NYTP. She started the NYTP’s first Facebook group, which grew to 435 members.',
        ],
        [
          'Sources',
          'United States Transhumanist Party, States and Allies: https://transhumanist-party.org/allied-organizations/',
          'United States Transhumanist Party, the NYTP Constitution (October 2022): https://transhumanist-party.org/2022/10/17/nytp-constitution/',
          'United States Transhumanist Party, Regional Liaisons (August 2022): https://transhumanist-party.org/2022/08/08/ustp-regional-liaisons/',
          'New York Transhumanist Party, website: https://nytranshumanistparty.wixsite.com/nytp/',
        ],
      ],
      [
        question('ny1-1', 'What is the New York Transhumanist Party?', ['A national party that replaced the USTP', 'A state party that operates under the auspices of the United States Transhumanist Party', 'A New York city council', 'A research institute'], 1, 'The NYTP is a state party, listed by the USTP, that operates under the auspices of the United States Transhumanist Party.'),
        question('ny1-2', 'Where does the United States Transhumanist Party list the NYTP?', ['On its page of states and allies', 'On its list of candidates', 'In its bylaws only', 'Nowhere'], 0, 'The USTP lists the New York Transhumanist Party on its page of states and allies.'),
        question('ny1-3', 'Who has been the USTP’s Regional Liaison for New York since August 3, 2022?', ['Luis Arroyo', 'Daud Sheikh', 'Gennady Stolyarov II', 'Dinorah Delfin'], 3, 'Dinorah Delfin has been the USTP’s New York Regional Liaison since August 3, 2022.'),
        question('ny1-4', 'Is the Regional Liaison an office of the NYTP?', ['Yes, it is the NYTP’s highest office', 'Yes, it replaces the Chairman', 'No, it is a role of the national party', 'No, it is an office of New York State'], 2, 'The liaison is a role of the United States Transhumanist Party, not an office of the NYTP.'),
        question('ny1-5', 'How many members did the NYTP’s first Facebook group grow to?', ['35', '435', '4,350', '110'], 1, 'The first Facebook group, started by the New York Regional Liaison, grew to 435 members.'),
      ],
    ),
    lesson(
      'nytp-reformed',
      2,
      'Re-formed in 2022',
      'Why the national party re-formed the NYTP in July 2022, what its declaration decided, and the rule in the USTP Constitution it used.',
      7,
      [
        [
          'Leadership unknown and disputed',
          'On July 24, 2022, the Chairman of the United States Transhumanist Party, Gennady Stolyarov II, declared the New York Transhumanist Party re-formed and placed it under the direct control of the USTP. His reason was that the NYTP’s leadership was unknown and disputed. The declaration put the NYTP’s membership at over 110 people.',
        ],
        [
          'What the declaration decided',
          'The declaration adopted the USTP’s platform as the NYTP’s platform, and it recognized nytranshumanistparty.wixsite.com/nytp as the NYTP’s website. It also recognized as an official position of the NYTP a poll of April 4, 2022, in which the party condemned sweeps of homeless people’s camps.',
        ],
        [
          'The rule behind it',
          'The Chairman acted under Article I, Section III, Operating Principle 2 of the USTP Constitution. That principle lets the national party declare a state party inactive and re-form it under new leadership. Elsewhere, the same constitution says that the USTP respects the control state parties have over their own bylaws and platforms.',
        ],
        [
          'Sources',
          'United States Transhumanist Party, the declaration re-forming the NYTP (July 2022): https://transhumanist-party.org/2022/07/25/declaration-nytp-re-formation/',
          'United States Transhumanist Party, Constitution: https://transhumanist-party.org/constitution/',
        ],
      ],
      [
        question('ny2-1', 'Who declared the New York Transhumanist Party re-formed on July 24, 2022?', ['The Governor of New York', 'The USTP Chairman, Gennady Stolyarov II', 'The NYTP’s members by a vote', 'A New York court'], 1, 'The Chairman of the United States Transhumanist Party, Gennady Stolyarov II, declared the NYTP re-formed.'),
        question('ny2-2', 'Why was the NYTP re-formed?', ['Its leadership was unknown and disputed', 'It had no members', 'It had won an election', 'It wanted to leave the USTP'], 0, 'The reason given was that the NYTP’s leadership was unknown and disputed.'),
        question('ny2-3', 'Which platform did the declaration adopt for the NYTP?', ['A new platform written in New York', 'No platform at all', 'The platform of the United States Transhumanist Party', 'The platform of a major party'], 2, 'The declaration adopted the USTP’s platform as the NYTP’s platform.'),
        question('ny2-4', 'Which New York position did the declaration recognize as official?', ['A call to raise taxes', 'Support for a new stadium', 'A ban on social media', 'The condemnation of sweeps of homeless people’s camps, from a poll of April 4, 2022'], 3, 'It recognized a poll of April 4, 2022, condemning homeless sweeps, as an official NYTP position.'),
        question('ny2-5', 'What does Operating Principle 2 in Article I, Section III of the USTP Constitution allow?', ['Declaring a state party inactive and re-forming it under new leadership', 'Merging two state parties', 'Running candidates in every state', 'Removing members who do not vote'], 0, 'It lets the national party declare a state party inactive and re-form it under new leadership.'),
      ],
    ),
    lesson(
      'nytp-constitution',
      3,
      'The NYTP Constitution, officers and members',
      'The constitution ratified in October 2022, the party’s officers since, its core principles, and the two kinds of member.',
      8,
      [
        [
          'A constitution of its own',
          'The NYTP Constitution was ratified on October 16, 2022 and took effect the next day. Daud Sheikh became the NYTP’s Chairman and Luis Arroyo its Vice-Chairman. According to the USTP, on April 7, 2026 Daud Sheikh resigned and named Luis Arroyo Chairman, leaving the office of Vice-Chairman vacant; the USTP’s leadership page lists Luis Arroyo as Chairman.',
        ],
        [
          'Close ties to the national party',
          'Under its constitution, the NYTP’s platform is the platform of the United States Transhumanist Party, word for word, and it changes whenever the USTP’s platform changes. Officers of the USTP may veto the appointment of NYTP officers, who succeeds to an office, and amendments to the NYTP Constitution.',
        ],
        [
          'Core principles',
          'The NYTP Constitution sets out its core principles: life extension through science and technology; reason, science and secular values; reducing the risks that threaten humanity’s existence; renouncing violence except in self-defense; and avoiding wedge issues.',
        ],
        [
          'Two kinds of member',
          'The NYTP has New York Members, who lawfully live in New York and are eligible to vote there, and Allied Members, who are everyone else who joins. So people outside New York can belong to the party too.',
        ],
        [
          'Sources',
          'United States Transhumanist Party, the NYTP Constitution (October 2022, with notes added in 2026): https://transhumanist-party.org/2022/10/17/nytp-constitution/',
          'United States Transhumanist Party, Leadership: https://transhumanist-party.org/leadership/',
          'United States Transhumanist Party, the Chairman’s sixth anniversary message (January 2023): https://transhumanist-party.org/2023/01/01/ustp-chairman-6th-anniversary/',
        ],
      ],
      [
        question('ny3-1', 'When was the NYTP Constitution ratified?', ['July 24, 2022', 'October 16, 2022', 'April 4, 2022', 'January 1, 2023'], 1, 'The NYTP Constitution was ratified on October 16, 2022 and took effect on October 17.'),
        question('ny3-2', 'Who became the NYTP’s Chairman when Daud Sheikh resigned on April 7, 2026?', ['Luis Arroyo', 'Dinorah Delfin', 'Gennady Stolyarov II', 'Nobody: the office is vacant'], 0, 'Daud Sheikh resigned and named Luis Arroyo Chairman; it is the office of Vice-Chairman that is now vacant.'),
        question('ny3-3', 'What is the NYTP’s platform under its constitution?', ['A platform its members write each year', 'The platform of the New York Governor', 'The USTP’s platform, word for word, changing whenever the USTP’s does', 'It has none'], 2, 'The NYTP’s platform is the USTP platform word for word, and it changes when the USTP’s platform changes.'),
        question('ny3-4', 'Which of these is one of the NYTP’s core principles?', ['Winning every election', 'Leaving science to experts', 'Using wedge issues', 'Life extension through science and technology'], 3, 'Its core principles include life extension through science and technology, reason and secular values, reducing existential risk, renouncing violence except in self-defense, and avoiding wedge issues.'),
        question('ny3-5', 'Who can be an Allied Member of the NYTP?', ['Only officers of the USTP', 'Members who do not lawfully live in New York or are not eligible to vote there', 'Only people who live in New York City', 'Nobody: the NYTP has one kind of member'], 1, 'New York Members lawfully live in New York and are eligible to vote there; Allied Members are everyone else.'),
      ],
    ),
  ],
};
