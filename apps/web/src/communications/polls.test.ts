import { describe, expect, it } from 'vitest';
import { POLL_VOTER, type PublicPoll, type ResultsSynopsis } from 'ustp-domain';
import { resultsShareable } from '../elections/results-share.js';
import { cardSrc } from '../seo.js';
import { answersText, leadText, newVoterToken, pollShareable, pollVoter, rememberAnswer, rememberedAnswer, type KeyValueStore } from './polls.js';

const ORIGIN = 'https://vote.example';
const POLL_ID = '019a6f00-0000-7000-8000-000000000001';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const choices = [
  { choiceId: 'c1', label: 'Yes' },
  { choiceId: 'c2', label: 'No' },
];
const poll = (over: Partial<PublicPoll> = {}): PublicPoll => ({
  pollId: POLL_ID,
  question: 'Should Congress fund longevity research?',
  description: '',
  choices,
  hashtags: ['Longevity'],
  state: 'open',
  publishedAt: '2026-11-12T12:00:00.000Z',
  closesAt: '2026-11-19T12:00:00.000Z',
  voted: false,
  results: null,
  ...over,
});

describe("this browser's poll token", () => {
  it('is random, URL-safe and the shape the api takes', () => {
    const a = newVoterToken();
    expect(a).toMatch(POLL_VOTER);
    expect(a).toHaveLength(22);
    expect(newVoterToken()).not.toBe(a);
  });

  it('is made once and kept; without storage, kept for the page', () => {
    const store = memory();
    const first = pollVoter(store);
    expect(pollVoter(store)).toBe(first);
    store.data.set('ustp-poll-voter', 'not a token!');
    expect(pollVoter(store)).not.toBe('not a token!');
    const refusing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(pollVoter(refusing)).toBe(pollVoter(null));
  });

  it('remembers what this browser answered, here only', () => {
    const store = memory();
    expect(rememberedAnswer(POLL_ID, store)).toBeNull();
    rememberAnswer(POLL_ID, 'c2', store);
    rememberAnswer('other', 'c1', store);
    expect(rememberedAnswer(POLL_ID, store)).toBe('c2');
    store.data.set('ustp-poll-answers', '{broken');
    expect(rememberedAnswer(POLL_ID, store)).toBeNull();
  });
});

describe('sharing a poll', () => {
  it('invites people to answer while it is open', () => {
    expect(pollShareable(poll(), ORIGIN)).toEqual({
      text: 'Should Congress fund longevity research? Answer the poll and see what others think.',
      url: `${ORIGIN}/polls/${POLL_ID}`,
      hashtags: ['Longevity'],
      title: 'Poll: Should Congress fund longevity research?',
    });
  });

  it('says how it came out once closed', () => {
    const results = { everyone: { total: 8, counts: { c1: 6, c2: 2 } }, members: { total: 0, counts: {} } };
    expect(pollShareable(poll({ state: 'closed', results }), ORIGIN).text).toBe('Should Congress fund longevity research? Most chose “Yes” (75%).');
    expect(leadText(choices, { total: 4, counts: { c1: 2, c2: 2 } })).toBe('A tie: “Yes” and “No”.');
    expect(leadText(choices, { total: 0, counts: {} })).toBeNull();
    expect(answersText(1)).toBe('1 answer');
  });

  it("shows the page's own card image", () => {
    expect(cardSrc(`/polls/${POLL_ID}`, 'closed-8')).toBe(`/v1/public/link-cards?path=%2Fpolls%2F${POLL_ID}&v=closed-8`);
  });
});

describe("sharing an election's results", () => {
  const synopsis = {
    electionId: 'e1',
    title: '2026 Officer Election',
    certifiedAt: null,
    turnout: { part: 40, whole: 80 },
    tally: { proposals: { total: 2, passed: 1, failed: 1, noQuorum: 0 }, candidateContests: { total: 1, seats: 3, elected: 3, vacantSeats: 0 } },
  } as unknown as ResultsSynopsis;

  it('says its status, outcome and turnout, and links its results page', () => {
    expect(resultsShareable(synopsis, false, ORIGIN)).toEqual({
      text: 'Provisional results of 2026 Officer Election: 1 of 2 proposals passed, 3 of 3 seats filled (50% turnout). Anyone can verify them from the published record.',
      url: `${ORIGIN}/results/e1`,
      hashtags: ['USTP'],
      title: 'Results: 2026 Officer Election',
    });
  });

  it('says a rehearsal is one, and certified results are', () => {
    const certified = { ...synopsis, certifiedAt: '2026-11-10T00:00:00.000Z' } as ResultsSynopsis;
    expect(resultsShareable(certified, true, ORIGIN)).toMatchObject({ text: expect.stringMatching(/^Rehearsal: Certified results/), hashtags: [] });
  });
});
