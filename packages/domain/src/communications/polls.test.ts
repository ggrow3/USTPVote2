import { describe, expect, it } from 'vitest';
import {
  checkPollAddress,
  checkPollOpen,
  closePoll,
  closingProblem,
  createPollSchema,
  isTrappedVote,
  leadingChoices,
  newPoll,
  pollBars,
  pollClosesAt,
  POLL_VOTES_PER_ADDRESS_PER_DAY,
  pollResultsShown,
  pollState,
  pollVoteSchema,
  publicPoll,
  publishPoll,
  sumPollTallies,
  updatePoll,
  type PollRecord,
} from './polls.js';
import { parseShareItem, pollItem } from './share-counts.js';

const POLL_ID = '019a6f00-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-12T12:00:00.000Z');
const IN_A_WEEK = '2026-11-19T12:00:00.000Z';

const draft = (over: Partial<Parameters<typeof createPollSchema.parse>[0]> = {}) =>
  newPoll(createPollSchema.parse({ question: 'Should Congress fund longevity research?', choices: ['Yes', 'No', 'Not sure'], closesAt: IN_A_WEEK, ...over }), POLL_ID, 'comms', NOW.toISOString());

const published = (): PollRecord => {
  const p = publishPoll(draft(), 1, 'comms', NOW);
  if (!p.ok) throw new Error(p.reason);
  return p.value;
};

describe('writing a poll', () => {
  it('takes a question and two to six different choices, numbered in order', () => {
    const poll = draft();
    expect(poll.choices).toEqual([
      { choiceId: 'c1', label: 'Yes' },
      { choiceId: 'c2', label: 'No' },
      { choiceId: 'c3', label: 'Not sure' },
    ]);
    expect(poll.status).toBe('draft');
    expect(pollState(poll, NOW)).toBe('draft');
    expect(createPollSchema.safeParse({ question: 'Q?', choices: ['Only one'] }).success).toBe(false);
    expect(createPollSchema.safeParse({ question: 'Q?', choices: ['1', '2', '3', '4', '5', '6', '7'] }).success).toBe(false);
    expect(createPollSchema.safeParse({ question: 'Q?', choices: ['Yes', ' yes '] }).success).toBe(false);
    expect(createPollSchema.safeParse({ question: '  ', choices: ['Yes', 'No'] }).success).toBe(false);
    expect(createPollSchema.parse({ question: 'Fund\n research?', choices: ['Yes', 'No'], hashtags: ['#USTP'] })).toMatchObject({
      question: 'Fund research?',
      hashtags: ['USTP'],
      closesAt: null,
    });
  });

  it('changes only as a draft, and only from the version it was opened at', () => {
    const changed = updatePoll(draft(), { question: 'Fund it?', description: '', choices: ['Yes', 'No'], hashtags: [], closesAt: IN_A_WEEK, basedOn: 1 }, 'comms', NOW.toISOString());
    expect(changed.ok && changed.value).toMatchObject({ question: 'Fund it?', version: 2, choices: [{ choiceId: 'c1' }, { choiceId: 'c2' }] });
    expect(updatePoll(draft(), { question: 'x', description: '', choices: ['a', 'b'], hashtags: [], closesAt: null, basedOn: 3 }, 'c', NOW.toISOString())).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(updatePoll(published(), { question: 'x', description: '', choices: ['a', 'b'], hashtags: [], closesAt: null, basedOn: 2 }, 'c', NOW.toISOString())).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no longer changes'),
    });
  });

  it('publishes with a closing time 10 minutes to 90 days ahead, open at once', () => {
    expect(closingProblem(null, NOW)).toMatch(/set when/);
    expect(closingProblem('2026-11-12T12:05:00.000Z', NOW)).toMatch(/at least 10 minutes/);
    expect(closingProblem('2027-03-01T00:00:00.000Z', NOW)).toMatch(/at most 90 days/);
    expect(closingProblem(IN_A_WEEK, NOW)).toBeNull();
    const poll = published();
    expect(poll).toMatchObject({ status: 'published', publishedAt: NOW.toISOString(), publishedBy: 'comms', version: 2 });
    expect(pollState(poll, NOW)).toBe('open');
    expect(pollState(poll, new Date(IN_A_WEEK))).toBe('closed');
    expect(publishPoll(draft({ closesAt: null }), 1, 'c', NOW)).toMatchObject({ ok: false });
    expect(publishPoll(poll, 2, 'c', NOW)).toMatchObject({ ok: false, reason: 'this poll is already published' });
  });

  it('closes early, once', () => {
    const later = new Date('2026-11-13T00:00:00.000Z');
    const closed = closePoll(published(), 2, 'comms', later);
    if (!closed.ok) throw new Error(closed.reason);
    expect(pollClosesAt(closed.value)).toBe(later.toISOString());
    expect(pollState(closed.value, later)).toBe('closed');
    expect(closePoll(closed.value, 3, 'comms', later)).toMatchObject({ ok: false, reason: 'this poll has already closed' });
    expect(closePoll(draft(), 1, 'comms', later)).toMatchObject({ ok: false });
  });
});

describe('answering a poll', () => {
  it('needs an open, published poll', () => {
    expect(checkPollOpen(null, NOW)).toMatchObject({ refusal: 'not_found' });
    expect(checkPollOpen(draft(), NOW)).toMatchObject({ refusal: 'not_found' });
    expect(checkPollOpen(published(), NOW)).toEqual({ ok: true });
    expect(checkPollOpen(published(), new Date(IN_A_WEEK))).toMatchObject({ refusal: 'conflict' });
  });

  it('takes a choice and the browser’s token; a filled hidden field marks a form filler', () => {
    const vote = pollVoteSchema.parse({ choiceId: 'c2', voter: 'abcdefghijklmnopqrstuv' });
    expect(isTrappedVote(vote)).toBe(false);
    expect(isTrappedVote({ website: 'http://spam' })).toBe(true);
    expect(pollVoteSchema.safeParse({ choiceId: 'c0', voter: 'abcdefghijklmnopqrstuv' }).success).toBe(false);
    expect(pollVoteSchema.safeParse({ choiceId: 'c1', voter: 'short' }).success).toBe(false);
    expect(pollVoteSchema.safeParse({ choiceId: 'c1', voter: 'has/slash/in/it/1234567' }).success).toBe(false);
  });

  it('holds one network address to a day’s number of answers per poll', () => {
    expect(checkPollAddress(POLL_VOTES_PER_ADDRESS_PER_DAY - 1)).toEqual({ ok: true });
    expect(checkPollAddress(POLL_VOTES_PER_ADDRESS_PER_DAY)).toMatchObject({ refusal: 'rate_limited' });
  });
});

describe('results', () => {
  const choices = published().choices;
  const results = sumPollTallies(choices, [
    { everyone: { c1: 5, c2: 1 }, members: { c1: 2 } },
    { everyone: { c1: 2, c3: 2, c9: 50 } },
    {},
  ]);

  it('add up the count documents, counting only the poll’s choices', () => {
    expect(results.everyone).toEqual({ total: 10, counts: { c1: 7, c2: 1, c3: 2 } });
    expect(results.members).toEqual({ total: 2, counts: { c1: 2, c2: 0, c3: 0 } });
  });

  it('show to someone who answered, and to everyone once it closed', () => {
    expect(pollResultsShown('open', false)).toBe(false);
    expect(pollResultsShown('open', true)).toBe(true);
    expect(pollResultsShown('closed', false)).toBe(true);
    expect(publicPoll(published(), results, false, NOW).results).toBeNull();
    expect(publicPoll(published(), results, true, NOW).results).toEqual(results);
    expect(publicPoll(published(), results, false, new Date(IN_A_WEEK))).toMatchObject({ state: 'closed', results, closesAt: IN_A_WEEK });
    expect(() => publicPoll(draft(), results, false, NOW)).toThrow();
  });

  it('draw a bar per choice for the card, the leader solid', () => {
    expect(leadingChoices(choices, results.everyone).map((c) => c.label)).toEqual(['Yes']);
    expect(pollBars(choices, results.everyone)).toEqual([
      { label: 'Yes', value: '70%', share: 0.7, highlight: true },
      { label: 'No', value: '10%', share: 0.1 },
      { label: 'Not sure', value: '20%', share: 0.2 },
    ]);
    expect(pollBars(choices, { total: 0, counts: {} }).map((b) => b.value)).toEqual(['–', '–', '–']);
    expect(leadingChoices(choices, { total: 0, counts: {} })).toEqual([]);
  });

  it('with more than four choices, the four with the most answers, in the order written', () => {
    const six = draft({ choices: ['A', 'B', 'C', 'D', 'E', 'F'] }).choices;
    const bars = pollBars(six, { total: 21, counts: { c1: 1, c2: 6, c3: 2, c4: 5, c5: 3, c6: 4 } });
    expect(bars.map((b) => b.label)).toEqual(['B', 'D', 'E', 'F']);
  });

  it('are shared and counted as the poll', () => {
    expect(parseShareItem(pollItem(POLL_ID))).toEqual({ kind: 'poll', pollId: POLL_ID });
    expect(parseShareItem('poll-123')).toBeNull();
  });
});
