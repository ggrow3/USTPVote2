import { lessonsOf, question, type SeededCourse } from './lessons.js';

const COURSE_ID = 'the-coalition';
const lesson = lessonsOf(COURSE_ID);

/** The USPP contingent, from the party's curriculum: the one party of the coalition it describes so far. */
export const theCoalition: SeededCourse = {
  courseId: COURSE_ID,
  title: 'The Coalition',
  summary: 'The United States Pirate Party, a progressive left leaning party in a third-party coalition with the United States Transhumanist Party.',
  placement: null,
  lessons: [
    lesson(
      'uspp',
      1,
      'The United States Pirate Party',
      'The USPP, its coalition with the United States Transhumanist Party, and its cross membership with Left Transhumanism.',
      5,
      [
        [
          'USPP',
          'The ‘USPP’ is the United States Pirate Party, a Progressive left leaning party that is in a third-party coalition with the United States Transhumanist Party. Many of their members are in Left Transhumanism and vice versa, causing a degree of cross membership. So much so that the leader, or ‘Captain,’ of the Pirate Party invited Left Transhumanists to contribute to the Pirate Party’s ‘Message in a Bottle’ publication program. A warm welcome from our left wing allies!',
        ],
      ],
      [
        question('c-1', 'What is the USPP?', ['The United States Progressive Party', 'The United States Pirate Party', 'The United States People’s Party', 'The United States Planning Party'], 1, 'The ‘USPP’ is the United States Pirate Party, a progressive left leaning party.'),
        question('c-2', 'How is the USPP related to the United States Transhumanist Party?', ['It is in a third-party coalition with it', 'It is a part of it', 'It is its rival', 'It has no relation to it'], 0, 'The USPP is in a third-party coalition with the United States Transhumanist Party.'),
        question('c-3', 'Why is there a degree of cross membership between the USPP and Left Transhumanism?', ['Members must join both', 'The two have merged', 'There is none', 'Many Pirate Party members are in Left Transhumanism, and the other way round'], 3, 'Many of their members are in Left Transhumanism and vice versa, causing a degree of cross membership.'),
        question('c-4', 'What is the leader of the Pirate Party called?', ['The Admiral', 'The Chair', 'The Captain', 'The Commissar'], 2, 'The leader of the Pirate Party is its ‘Captain’.'),
        question('c-5', 'Which Pirate Party publication program were Left Transhumanists invited to contribute to?', ['Message in a Bottle', 'Immortality', 'Red Star', 'The Common Task'], 0, 'The Captain invited Left Transhumanists to contribute to the Pirate Party’s ‘Message in a Bottle’ publication program.'),
      ],
    ),
  ],
};
