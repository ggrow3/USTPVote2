import { ELECTION_PACKAGE_FORMAT, type ElectionPackageInput } from './election-package.js';

/**
 * The sample ballot (design §6.7): a `ustp.election` file on Transhumanist themes with a question of every kind the
 * ballot builder makes, for Election Admins to download from Admin › Elections, change and import, as a new draft or
 * into a draft's ballot. Its candidates are invented, from the demo elections' names (§10.4), and its planks say they
 * are not party policy. `examples/elections/transhumanist-sample.election.json` is this file as the download writes it.
 */

export const SAMPLE_BALLOT_FILE_NAME = 'transhumanist-sample.election.json';

/** The end of every plank's text, so a sample text is never taken for the party's. */
export const SAMPLE_BALLOT_NOTE = 'Sample text for trying out the ballot. It is not party policy.';
const SOURCE = 'Sample ballot';

const majority = { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' } as const;
const twoThirds = { threshold: { ratio: { num: 2, den: 3 }, comparison: 'gte' }, base: 'yes_no' } as const;

export const SAMPLE_BALLOT: ElectionPackageInput = {
  format: ELECTION_PACKAGE_FORMAT,
  v: 1,
  title: 'Transhumanist Party Sample Ballot',
  description:
    'A sample ballot with a question of each kind: a ranked choice, a choice of one, a committee where members choose ' +
    'several, and three platform planks to vote yes, no or abstain on. Every candidate is invented and no plank is ' +
    'party policy: change them before using this for a real election.',
  secrecy: 'secret',
  // Two weeks after it is imported, for a week, as a new election starts.
  window: { opensInSeconds: 14 * 86_400, votingSeconds: 7 * 86_400 },
  contests: [
    {
      id: 'chair',
      kind: 'irv',
      title: 'Party Chair',
      description: 'Rank the candidates in order of preference. If your first choice is eliminated, your vote goes to your next.',
      candidates: [
        {
          id: 'aurelia-dawnmere',
          name: 'Aurelia Dawnmere',
          statement: 'Organizer of a longevity research reading group. Wants every national meeting open to members online.',
        },
        {
          id: 'bastian-helixford',
          name: 'Bastian Helixford',
          statement: 'Science teacher. Wants a party chapter in every state before the next convention.',
        },
        { id: 'isolde-northvane', name: 'Isolde Northvane', statement: 'Bioethicist. Will publish what the party spends every quarter.' },
      ],
    },
    {
      id: 'convention-city',
      kind: 'choose_n',
      title: 'Host city for the next national convention',
      description: 'Choose one. The city with the most votes hosts the convention.',
      seats: 1,
      maxSelections: 1,
      candidates: [
        { id: 'austin', name: 'Austin, Texas' },
        { id: 'denver', name: 'Denver, Colorado' },
        { id: 'seattle', name: 'Seattle, Washington' },
        { id: 'online', name: 'Online only' },
      ],
    },
    {
      id: 'science-committee',
      kind: 'choose_n',
      title: 'Science and Technology Committee (3 seats)',
      description: 'Choose up to three. The three with the most votes join the committee.',
      seats: 3,
      maxSelections: 3,
      candidates: [
        { id: 'calla-brightwater', name: 'Calla Brightwater', statement: 'Gerontologist. Would review the platform’s health planks.' },
        { id: 'dorian-ironvale', name: 'Dorian Ironvale', statement: 'Software engineer working on open-source AI tools.' },
        { id: 'elowen-starwright', name: 'Elowen Starwright', statement: 'Neuroscientist studying brain–computer interfaces.' },
        { id: 'galen-moonfield', name: 'Galen Moonfield', statement: 'Materials scientist with an eye on settling space.' },
        { id: 'marisol-oakhaven', name: 'Marisol Oakhaven', statement: 'Science journalist. Would write the committee’s reports for members.' },
      ],
    },
    {
      id: 'morphological-freedom',
      kind: 'proposal',
      title: 'Plank: Morphological freedom',
      description: 'Should the platform include this plank? It passes with more than half of the yes and no votes.',
      passRule: majority,
      proposal: {
        body:
          'Every person has the right to keep, change and enhance their own body and mind, by medical, technological or ' +
          'other means, as long as they do not harm others. The law should not forbid an informed adult’s choice of an ' +
          `enhancement that is safe for others.\n\n${SAMPLE_BALLOT_NOTE}`,
        source: SOURCE,
      },
    },
    {
      id: 'rejuvenation-research',
      kind: 'proposal',
      title: 'Plank: Public funding for rejuvenation research',
      description: 'Should the platform include this plank? It passes with two thirds of the yes and no votes.',
      passRule: twoThirds,
      proposal: {
        body:
          'Aging causes more death and disease than anything else. Public research budgets should treat the biology of ' +
          'aging as a target for medicine, and fund therapies that slow, stop or reverse it, with the results published ' +
          `openly.\n\n${SAMPLE_BALLOT_NOTE}`,
        source: SOURCE,
      },
    },
    {
      id: 'open-ai-safety',
      kind: 'proposal',
      title: 'Plank: Open research into AI safety',
      description:
        'Should the platform include this plank? It passes with more than half of the yes and no votes, if at least a ' +
        'quarter of the voter roll votes on it.',
      passRule: majority,
      quorum: { rollRatio: { num: 1, den: 4 } },
      proposal: {
        body:
          'Research into making advanced artificial intelligence safe should be publicly funded and openly published, so ' +
          `that anyone can check it and build on it.\n\n${SAMPLE_BALLOT_NOTE}`,
        source: SOURCE,
      },
    },
  ],
};
