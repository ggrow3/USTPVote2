import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'why-the-transhumanist-party';
const lesson = lessonsOf(COURSE_ID);

const SOURCES = {
  constitution: 'United States Transhumanist Party, Constitution: https://transhumanist-party.org/constitution/',
  faq: 'United States Transhumanist Party, frequently asked questions: https://transhumanist-party.org/faq/',
  values: 'United States Transhumanist Party, Values: https://transhumanist-party.org/values/',
  platform: 'United States Transhumanist Party, Platform: https://transhumanist-party.org/platform/',
};

/**
 * The case the United States Transhumanist Party makes for itself, from what it has published (researched
 * 2026-11-01): its Core Ideals, its platform, how to join and take part, and how its members choose candidates.
 */
export const whyTheTranshumanistParty: SeededCourse = {
  courseId: COURSE_ID,
  title: 'Why the Transhumanist Party?',
  summary:
    'The case the United States Transhumanist Party makes for itself: its three Core Ideals, the platform its members vote on, free membership open to anyone who shares the ideals, and how members choose the candidates the party nominates and endorses.',
  placement: null,
  lessons: [
    lesson(
      'why-core-ideals',
      1,
      'The Core Ideals',
      'The three ideals at the heart of the party, and what it says sets it apart from other parties.',
      6,
      [
        [
          'Three Core Ideals',
          'The party’s Constitution opens with three Core Ideals, in Article I, which can never be amended. First, the party “supports significant life extension achieved through the progress of science and technology”. Second, it supports a culture, a society and a politics shaped by reason, science and secular values. Third, it supports efforts to reduce existential risks, the dangers that could end humanity.',
        ],
        [
          'Science, health and technology',
          'The party’s home page sums up its purpose as putting science, health and technology at the forefront of American politics. It describes itself as focused on policy rather than on the contests of conventional politics, and it wants to end the duopoly of the two major parties.',
        ],
        [
          'Not one ideology',
          'The party says that it does not fit a single ideology. It values individual freedom and innovation driven by markets, with some limits to prevent exploitation. It is secular, but not opposed to religion.',
        ],
        ['Sources', SOURCES.constitution, SOURCES.values, SOURCES.faq, 'United States Transhumanist Party, home page: https://transhumanist-party.org/'],
      ],
      [
        question('wp1-1', 'What does the first Core Ideal support?', ['Lower taxes', 'Significant life extension achieved through the progress of science and technology', 'Leaving the human body unchanged', 'A single national religion'], 1, 'The first Core Ideal supports significant life extension achieved through the progress of science and technology.'),
        question('wp1-2', 'What does the second Core Ideal want culture, society and politics to be shaped by?', ['Reason, science and secular values', 'Tradition alone', 'A single party', 'Wealth'], 0, 'The second Core Ideal supports a culture, a society and a politics shaped by reason, science and secular values.'),
        question('wp1-3', 'What does the third Core Ideal support?', ['Faster economic growth', 'Space travel only', 'Smaller government', 'Efforts to reduce existential risks'], 3, 'The third Core Ideal supports efforts to reduce existential risks, the dangers that could end humanity.'),
        question('wp1-4', 'What does the party say about religion?', ['It is a religious party', 'It opposes all religion', 'It is secular, but not opposed to religion', 'It has no view'], 2, 'The party is secular, but not anti-religious.'),
        question('wp1-5', 'What does the party want to end in American politics?', ['Elections', 'The duopoly of the two major parties', 'State governments', 'Online voting'], 1, 'The party describes itself as wanting to end the two-party duopoly.'),
      ],
    ),
    lesson(
      'why-platform',
      2,
      'The platform',
      'The main themes of the platform the members have adopted, and how members add to it.',
      7,
      [
        [
          'What the platform covers',
          'The party’s platform runs from science and health to rights and how elections work. Among its themes: funding research against disease and aging; privacy, and morphological freedom, the freedom to change one’s own body; ending the war on drugs; rights for sentient beings, including advanced artificial intelligence; nuclear disarmament; open education and open research; ranked-choice or proportional voting and the abolition of the Electoral College; and a universal basic income.',
        ],
        [
          'Written by the members',
          'Each plank of the platform is adopted by a vote of the members, and the platform is not finished: members may propose additions, which go to a vote. So the platform says what the members, not only the officers, think the party should stand for.',
        ],
        ['Sources', SOURCES.platform, SOURCES.faq],
      ],
      [
        question('wp2-1', 'Which of these research goals is on the party’s platform?', ['Funding research against disease and aging', 'Ending all research', 'Research for the military only', 'Research paid for by members'], 0, 'The platform includes funding research against disease and aging.'),
        question('wp2-2', 'What is morphological freedom?', ['The freedom to travel', 'The freedom to change one’s own body', 'The freedom of the press', 'The freedom to form a party'], 1, 'Morphological freedom is the freedom to change one’s own body; the platform supports it alongside privacy.'),
        question('wp2-3', 'Which beings does the platform say should have rights, besides humans?', ['None', 'Only animals kept as pets', 'Only corporations', 'Sentient beings, including advanced artificial intelligence'], 3, 'The platform supports rights for sentient beings, including advanced artificial intelligence.'),
        question('wp2-4', 'What does the platform say about how elections are run?', ['It wants the Electoral College kept as it is', 'It wants elections every ten years', 'It supports ranked-choice or proportional voting and abolishing the Electoral College', 'It says nothing'], 2, 'The platform supports ranked-choice or proportional voting and the abolition of the Electoral College.'),
        question('wp2-5', 'How is a plank added to the platform?', ['The Chairman writes it', 'A member proposes it and the members vote on it', 'It is copied from another party', 'It never changes'], 1, 'The platform is not finished: members may propose additions, and each plank is adopted by a vote of the members.'),
      ],
    ),
    lesson(
      'why-join',
      3,
      'Joining and taking part',
      'Who may join and what it costs, the party’s goals for its members, and the rules for the candidates it supports.',
      7,
      [
        [
          'Free, and open to anyone who shares the ideals',
          'Membership is free, and the Constitution requires that it stay free. Anyone who agrees with the Core Ideals may join: people who can vote in the United States as U.S. Members, and everyone else as Allied Members. The party’s near-term goals are to reach at least 10,000 members and to build up the volunteers it needs to reach the ballot in the states.',
        ],
        [
          'Candidates',
          'Article VII of the Constitution sets the rules for candidates the party supports. A candidate must accept the Core Ideals, align closely with the platform and accept being vetted, and must publicly support transhumanism or life extension, or mention the party’s endorsement. The officers interview each candidate, and then the members vote.',
        ],
        [
          'Endorsements',
          'The party’s answers to common questions say that it does not endorse candidates of other parties that are not transhumanist, though it may endorse independents. In practice it has also endorsed some candidates of other parties: in April 2026, for example, 37 of the 43 members who voted, or 86%, endorsed Pete Karas, the Green Party’s candidate for Secretary of State in Wisconsin.',
        ],
        [
          'Sources',
          SOURCES.faq,
          SOURCES.constitution,
          'United States Transhumanist Party, Membership: https://transhumanist-party.org/membership/',
          'United States Transhumanist Party, the Karas and Henry endorsements (April 2026): https://transhumanist-party.org/2026/04/22/ustp-karas-henry-endorsements/',
        ],
      ],
      [
        question('wp3-1', 'What does membership of the party cost?', ['A yearly fee', 'Nothing: it is free, and the Constitution requires that it stay free', 'A donation of any size', 'Nothing in the first year only'], 1, 'Membership is free, and the Constitution requires that it stay free.'),
        question('wp3-2', 'Who may join the party?', ['Anyone who agrees with the Core Ideals', 'Only people living in the United States', 'Only scientists', 'Only people invited by an officer'], 0, 'Anyone who agrees with the Core Ideals may join, as a U.S. Member or an Allied Member.'),
        question('wp3-3', 'How many members does the party aim to reach in the near term?', ['1,000', '4,800', '1,000,000', 'At least 10,000'], 3, 'The party’s near-term goal is at least 10,000 members.'),
        question('wp3-4', 'What happens after the officers interview a candidate?', ['The Chairman decides alone', 'The candidate is endorsed at once', 'The members vote', 'Nothing more'], 2, 'The officers interview each candidate, and then the members vote.'),
        question('wp3-5', 'How many members voted to endorse Pete Karas in April 2026?', ['37 of 43', '74 of 86', '43 of 43', '6 of 43'], 0, 'Of the 43 members who voted, 37, or 86%, endorsed Pete Karas.'),
      ],
    ),
    lesson(
      'why-nominations',
      4,
      'Choosing a candidate for President',
      'How the members chose the party’s candidates for President in 2020 and 2024, in online primaries.',
      7,
      [
        [
          'The 2020 primary',
          'From September 21 to 30, 2019, the members held an online primary for the 2020 election, with nine candidates and the option of None of the Above. 312 ballots were cast, ranking the candidates in order of preference. Johannon Ben Zion won in the seventh round of the instant runoff, with 51.28% of the votes then counted.',
        ],
        [
          'A change of candidate',
          'In June 2020 Ben Zion left the party, saying he was better suited to a techno-progressive platform. Under the party’s rules of succession, Charlie Kam, its candidate for Vice-President since October 5, 2019, became its candidate for President, and the officers confirmed him on June 11, 2020. On August 21, 2020, Liz Parrish was named his running mate.',
        ],
        [
          'The 2024 primary',
          'From May 14 to 22, 2023, the members held their primary for the 2024 election. Of 129 ballots, Tom Ross won 62.02% in the first round, and Daniel Twedt became his running mate. After the election, members reported at least 37 verified write-in votes for Ross and Twedt.',
        ],
        [
          'Sources',
          'United States Transhumanist Party, results of the 2019 electronic primary: https://transhumanist-party.org/2019/10/02/ustp-2019-electronic-primary-results/',
          'United States Transhumanist Party, reorganization (June 2020): https://transhumanist-party.org/2020/06/12/ustp-reorganization/',
          'United States Transhumanist Party, Kam and Parrish 2020: https://transhumanist-party.org/kam-parrish-2020/',
          'United States Transhumanist Party, results of the 2023 electronic primary: https://transhumanist-party.org/2023/05/23/ustp-2023-electronic-primary-results/',
          'United States Transhumanist Party, write-in totals for Ross and Twedt (November 2024): https://transhumanist-party.org/2024/11/06/ross-twedt-write-in-totals/',
        ],
      ],
      [
        question('wp4-1', 'How did the members choose the party’s candidate for the 2020 election?', ['At a convention in person', 'In an online primary, ranking the candidates in order of preference', 'The Chairman chose', 'By drawing lots'], 1, 'The members held an online primary from September 21 to 30, 2019, ranking the candidates in order of preference.'),
        question('wp4-2', 'Who won the primary for the 2020 election?', ['Charlie Kam', 'Tom Ross', 'Liz Parrish', 'Johannon Ben Zion'], 3, 'Johannon Ben Zion won in the seventh round of the instant runoff, with 51.28%.'),
        question('wp4-3', 'Who became the party’s candidate for President in June 2020?', ['Charlie Kam, its candidate for Vice-President', 'Zoltan Istvan', 'Daniel Twedt', 'Gennady Stolyarov II'], 0, 'When Ben Zion left, Charlie Kam, the candidate for Vice-President, became the candidate for President under the rules of succession.'),
        question('wp4-4', 'Who was named Charlie Kam’s running mate on August 21, 2020?', ['Daniel Twedt', 'Liz Parrish', 'Arin Vahanian', 'Brent Ellman'], 1, 'Liz Parrish was named Charlie Kam’s running mate on August 21, 2020.'),
        question('wp4-5', 'Who won the party’s primary for the 2024 election?', ['Johannon Ben Zion', 'Charlie Kam', 'Tom Ross, with 62.02% in the first round', 'Nobody: None of the Above won'], 2, 'Tom Ross won 62.02% in the first round of the 2023 primary, and Daniel Twedt became his running mate.'),
      ],
    ),
  ],
};
