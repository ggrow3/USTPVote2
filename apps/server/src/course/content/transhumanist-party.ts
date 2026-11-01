import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'transhumanist-party';
const lesson = lessonsOf(COURSE_ID);

const SOURCES = {
  constitution: 'United States Transhumanist Party, Constitution: https://transhumanist-party.org/constitution/',
  faq: 'United States Transhumanist Party, frequently asked questions: https://transhumanist-party.org/faq/',
  leadership: 'United States Transhumanist Party, Leadership: https://transhumanist-party.org/leadership/',
  wikipedia: 'Wikipedia, Transhumanist Party: https://en.wikipedia.org/wiki/Transhumanist_Party',
};

/**
 * The United States Transhumanist Party, from what it has published (researched 2026-11-01): its founding and
 * chairmen, the two parties that joined it, its Constitution and officers, and its members, votes and documents.
 */
export const transhumanistParty: SeededCourse = {
  courseId: COURSE_ID,
  title: 'An Introduction into the Transhumanist Party',
  summary:
    'Who the United States Transhumanist Party is: its founding in 2014 and its chairmen, the two parties that merged into it, the Constitution its members adopted in 2020, and how its members vote on its platform and its Transhumanist Bill of Rights.',
  placement: null,
  lessons: [
    lesson(
      'ustp-founding',
      1,
      'Founded in 2014',
      'Who founded the party and when, its first presidential campaign, and the Chairman who has led it since 2016.',
      6,
      [
        [
          'The founding',
          'The Transhumanist Party was founded on October 7, 2014 by Zoltan Istvan. He was its first Chairman, and in 2016 he was its first candidate for President of the United States. According to Wikipedia, his campaign had no ballot access; he toured the country in the Immortality Bus and received write-in votes in two states.',
        ],
        [
          'A new Chairman',
          'On November 17, 2016, Gennady Stolyarov II became the party’s second Chairman, and he has led it since. Zoltan Istvan remained with the party as a Political and Media Advisor, a role that takes no decisions for the party.',
        ],
        [
          'Sources',
          SOURCES.constitution,
          SOURCES.faq,
          'United States Transhumanist Party, the Chairman’s first anniversary message (November 2017): https://transhumanist-party.org/2017/11/25/ustp-chairman-anniversary/',
          SOURCES.wikipedia,
        ],
      ],
      [
        question('ip1-1', 'Who founded the Transhumanist Party?', ['Gennady Stolyarov II', 'Zoltan Istvan', 'Hank Pellissier', 'Johannon Ben Zion'], 1, 'Zoltan Istvan founded the party on October 7, 2014, and was its first Chairman.'),
        question('ip1-2', 'When was the Transhumanist Party founded?', ['October 7, 2014', 'January 1, 2012', 'November 17, 2016', 'February 1, 2020'], 0, 'The party was founded on October 7, 2014.'),
        question('ip1-3', 'In which year was Zoltan Istvan the party’s candidate for President?', ['2012', '2014', '2020', '2016'], 3, 'Zoltan Istvan was the party’s first presidential candidate, in 2016.'),
        question('ip1-4', 'What was the Immortality Bus?', ['The party’s office', 'A research laboratory', 'The bus in which Istvan toured the country during his 2016 campaign', 'A conference'], 2, 'In 2016 Istvan toured the country in the Immortality Bus.'),
        question('ip1-5', 'Who became the party’s second Chairman on November 17, 2016?', ['Gennady Stolyarov II', 'Arin Vahanian', 'Charlie Kam', 'Brent Ellman'], 0, 'Gennady Stolyarov II became the second Chairman on November 17, 2016, and has led the party since.'),
      ],
    ),
    lesson(
      'ustp-mergers',
      2,
      'Two parties join',
      'The Transhuman Party in 2019 and the U.S. Longevity Party in 2020, and the name the party has had since.',
      6,
      [
        [
          'The Transhuman Party',
          'In October 2017 a small group of about 25 members split off and founded the Transhuman Party. Between December 30, 2018 and January 26, 2019 the two parties merged again, under the combined name United States Transhumanist Party / Transhuman Party.',
        ],
        [
          'The U.S. Longevity Party',
          'Hank Pellissier founded the U.S. Longevity Party on January 1, 2012. It was chaired by Hank Pellissier, then Brandon King, then Johannon Ben Zion. On February 1, 2020, after the members of both parties had voted for it, the Longevity Party merged into the Transhumanist Party.',
        ],
        [
          'The United States Transhumanist Party',
          'Since that merger the party has been called the United States Transhumanist Party, or USTP. Gennady Stolyarov II remained Chairman, and Johannon Ben Zion, the Longevity Party’s last chair, became Vice-Chairman.',
        ],
        ['Sources', SOURCES.constitution],
      ],
      [
        question('ip2-1', 'Which party split off in October 2017 and merged back between December 2018 and January 2019?', ['The Longevity Party', 'The Transhuman Party', 'The Pirate Party', 'The Libertarian Party'], 1, 'The Transhuman Party, founded by about 25 members in October 2017, merged with the Transhumanist Party between December 30, 2018 and January 26, 2019.'),
        question('ip2-2', 'Who founded the U.S. Longevity Party on January 1, 2012?', ['Brandon King', 'Zoltan Istvan', 'Johannon Ben Zion', 'Hank Pellissier'], 3, 'Hank Pellissier founded the U.S. Longevity Party on January 1, 2012.'),
        question('ip2-3', 'How did the Longevity Party come to merge into the Transhumanist Party on February 1, 2020?', ['A court ordered it', 'The Chairman decided alone', 'The members of both parties voted for it', 'The Longevity Party had closed'], 2, 'The two parties merged after the members of both had voted for it.'),
        question('ip2-4', 'What has the party been called since the 2020 merger?', ['The United States Transhumanist Party', 'The Transhuman Party', 'The Longevity Party', 'The Immortality Party'], 0, 'Since the merger it has been the United States Transhumanist Party, or USTP.'),
        question('ip2-5', 'Who became Vice-Chairman when the Longevity Party merged into the USTP?', ['Hank Pellissier', 'Johannon Ben Zion', 'Zoltan Istvan', 'Brandon King'], 1, 'Johannon Ben Zion, the Longevity Party’s last chair, became Vice-Chairman.'),
      ],
    ),
    lesson(
      'ustp-constitution',
      3,
      'The Constitution and the officers',
      'The Constitution the members adopted in 2020, its nine Articles, how it is amended, and who the party’s officers are.',
      8,
      [
        [
          'Adopted by the members',
          'The party’s current Constitution was adopted by a vote of its members from January 18 to 25, 2020, and took effect on February 1, 2020, the day of the merger with the Longevity Party. The members have amended it since, in December 2020 and from February to March 2025.',
        ],
        [
          'Nine Articles',
          'The Constitution has nine Articles: I, Immutable Principles, which hold the Core Ideals, statements of the party’s history and its operating principles; II, Membership; III, Officers; IV, Meetings; V, Amendments; VI, Platform; VII, Candidates; VIII, Additional Initiatives; and IX, Emergency Actions.',
        ],
        [
          'Amending it',
          'Article I can never be amended. Any other part of the Constitution may be amended by a majority of the members who vote on the amendment.',
        ],
        [
          'The officers',
          'A new or vacant office is filled when two-thirds of the active officers agree and the Chairman approves, and the Chairman may call an election for Chairman with two months’ notice. The officers in 2026 include the Chairman, Gennady Stolyarov II; the Vice-Chairman, Arin Vahanian; the Secretary, Brent Ellman; and the Legislative Director, Jason Geringer. The office of Vice-Chairman rotates among four people.',
        ],
        ['Sources', SOURCES.constitution, SOURCES.leadership],
      ],
      [
        question('ip3-1', 'How was the party’s current Constitution adopted?', ['By the Chairman alone', 'By a vote of the members, from January 18 to 25, 2020', 'By the Federal Election Commission', 'By a court'], 1, 'The members adopted it by a vote from January 18 to 25, 2020, and it took effect on February 1, 2020.'),
        question('ip3-2', 'How many Articles does the Constitution have?', ['Three', 'Five', 'Twelve', 'Nine'], 3, 'The Constitution has nine Articles, from Immutable Principles to Emergency Actions.'),
        question('ip3-3', 'Which part of the Constitution can never be amended?', ['Article I, the Immutable Principles', 'Article VI, the Platform', 'Article II, Membership', 'None: every part can be amended'], 0, 'Article I, which holds the Core Ideals, can never be amended.'),
        question('ip3-4', 'What does it take to amend any other part of the Constitution?', ['The Chairman’s signature', 'Two-thirds of the officers', 'A majority of the members who vote', 'Every member’s agreement'], 2, 'Other amendments need a majority of the members who vote on them.'),
        question('ip3-5', 'How is a new or vacant office filled?', ['By lottery', 'Two-thirds of the active officers agree and the Chairman approves', 'By the longest-serving member', 'By a vote of the public'], 1, 'An office is filled when two-thirds of the active officers agree and the Chairman approves.'),
      ],
    ),
    lesson(
      'ustp-members',
      4,
      'Members, votes and documents',
      'The two classes of member, how members vote online, the Platform, the Transhumanist Bill of Rights, and how the party is run without money.',
      8,
      [
        [
          'Two classes of member',
          'U.S. Members are people who can vote in elections in the United States. Allied Members are everyone else who joins, such as people living outside the United States and minors, and they take part in the party’s internal votes. The Constitution would extend Allied Membership to sentient artificial intelligences, or to extraterrestrials, should any be found. The party’s home page says it has more than 4,800 members.',
        ],
        [
          'Voting online',
          'The members decide the party’s questions in online votes, on ballots where each voter ranks the options in order of preference, counted by instant runoff. The party describes itself as the first party in the United States to use ranked-preference voting on its internal ballots. Platform Vote #9, held from February 17 to March 10, 2025, was its twentieth member vote.',
        ],
        [
          'The Platform',
          'The Platform is Article VI of the Constitution. It is made of planks, each adopted by a vote of the members.',
        ],
        [
          'The Transhumanist Bill of Rights',
          'Zoltan Istvan wrote the first version of the Transhumanist Bill of Rights and delivered it to the United States Capitol on December 14, 2015. The members adopted version 2.0 in an online vote from December 25 to 31, 2016, and version 3.0, with 43 Articles, in a vote from December 2 to 9, 2018.',
        ],
        [
          'Run without money',
          'The party takes no donations and has no budget or bank account. It is not registered with the Federal Election Commission.',
        ],
        [
          'Sources',
          SOURCES.constitution,
          SOURCES.faq,
          'United States Transhumanist Party, Platform: https://transhumanist-party.org/platform/',
          'United States Transhumanist Party, Transhumanist Bill of Rights, Version 3.0: https://transhumanist-party.org/tbr-3/',
          'United States Transhumanist Party, results of Platform Vote #9 (March 2025): https://transhumanist-party.org/2025/03/13/results-of-platform-vote-9/',
          'United States Transhumanist Party, home page: https://transhumanist-party.org/',
        ],
      ],
      [
        question('ip4-1', 'Who are the party’s U.S. Members?', ['Its officers only', 'People who can vote in elections in the United States', 'Everyone who has paid a fee', 'People who live in Washington, D.C.'], 1, 'U.S. Members are people who can vote in U.S. elections; Allied Members are everyone else who joins.'),
        question('ip4-2', 'How are the members’ online ballots counted?', ['By instant runoff, from each voter’s ranking of the options', 'By the officers alone', 'By whoever votes first', 'They are not counted'], 0, 'Members rank the options in order of preference, and the ballots are counted by instant runoff.'),
        question('ip4-3', 'Which Article of the Constitution is the Platform?', ['Article I', 'Article IX', 'Article III', 'Article VI'], 3, 'The Platform is Article VI of the Constitution, made of planks adopted by member votes.'),
        question('ip4-4', 'How many Articles does version 3.0 of the Transhumanist Bill of Rights have?', ['10', '25', '43', '82'], 2, 'Version 3.0, adopted by the members in December 2018, has 43 Articles.'),
        question('ip4-5', 'How does the party pay for itself?', ['It takes no donations and has no budget or bank account', 'Through membership fees', 'Through federal election funds', 'Through a single large donor'], 0, 'The party takes no donations, has no budget or bank account, and is not registered with the Federal Election Commission.'),
      ],
    ),
  ],
};
