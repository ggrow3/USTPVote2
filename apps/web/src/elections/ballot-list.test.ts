import type { VoterElection } from 'ustp-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ballotCard,
  ballotLists,
  finishedVotesShown,
  rememberFinishedVotesShown,
  secrecyText,
  shortWhen,
  votingFinished,
  votingWindow,
} from './ballot-list.js';

const AT = { now: new Date('2026-10-28T12:00:00Z'), locale: 'en-US', timeZone: 'UTC' };
// ICU puts thin and narrow no-break spaces around the dash and before AM/PM; ballot-list.ts makes the latter no-break.
const plain = (s: string) => s.replace(/[   ]/g, ' ');

const election = (state: VoterElection['state'], castAt: string | null = null): VoterElection => ({
  electionId: 'e1',
  title: 'Test 2026',
  description: '',
  secrecy: 'secret',
  state,
  opensAt: '2026-10-25T15:30:00Z',
  closesAt: '2026-11-15T14:18:00Z',
  castAt,
});

describe('ballot list dates', () => {
  it('show the voting window without seconds, and the year only when it is not this one', () => {
    expect(plain(votingWindow('2026-10-25T15:30:00Z', '2026-11-15T14:18:00Z', AT))).toBe('Voting Oct 25, 3:30 PM – Nov 15, 2:18 PM');
    expect(plain(votingWindow('2026-12-30T15:00:00Z', '2027-01-05T15:00:00Z', AT))).toBe(
      'Voting Dec 30, 2026, 3:00 PM – Jan 5, 2027, 3:00 PM',
    );
  });

  it('keep a time on one line with its AM or PM', () => {
    expect(votingWindow('2026-10-25T15:30:00Z', '2026-11-15T14:18:00Z', AT)).toMatch(/3:30 PM.*2:18 PM$/);
    expect(shortWhen('2026-10-26T16:01:30Z', AT)).toMatch(/4:01 PM$/);
  });

  it('name the day once for a window within one day', () => {
    expect(plain(votingWindow('2026-10-25T15:30:00Z', '2026-10-25T17:00:00Z', AT))).toBe('Voting Oct 25, 3:30 – 5:00 PM');
  });

  it('show a moment short', () => {
    expect(plain(shortWhen('2026-10-26T16:01:30Z', AT))).toBe('Oct 26, 4:01 PM');
    expect(plain(shortWhen('2025-10-26T16:01:30Z', AT))).toBe('Oct 26, 2025, 4:01 PM');
  });

  it('say whether the ballot is secret', () => {
    expect(secrecyText('secret')).toBe('Secret ballot');
    expect(secrecyText('open')).toBe('Roll-call: how you vote is published with your name');
  });
});

describe('finished votes', () => {
  const titled = (electionId: string, state: VoterElection['state'], closesAt: string): VoterElection => ({
    ...election(state),
    electionId,
    closesAt,
  });
  const ids = (list: readonly VoterElection[]) => list.map((e) => e.electionId);

  it('are those whose voting has closed, whether or not the voter took part', () => {
    expect(votingFinished(election('closed'))).toBe(true);
    expect(votingFinished(election('certified', '2026-10-26T16:01:30Z'))).toBe(true);
    expect(votingFinished(election('scheduled'))).toBe(false);
    expect(votingFinished(election('open'))).toBe(false);
    // Voted, but voting is still open: the ballot and its receipt stay on the list.
    expect(votingFinished(election('open', '2026-10-26T16:01:30Z'))).toBe(false);
  });

  it('are listed apart, the latest closed first, the others staying in the order given', () => {
    const { current, finished } = ballotLists([
      titled('old', 'certified', '2026-01-10T00:00:00Z'),
      titled('open', 'open', '2026-11-15T00:00:00Z'),
      titled('recent', 'closed', '2026-10-20T00:00:00Z'),
      titled('soon', 'scheduled', '2026-12-15T00:00:00Z'),
      titled('middle', 'certified', '2026-06-10T00:00:00Z'),
    ]);
    expect(ids(current)).toEqual(['open', 'soon']);
    expect(ids(finished)).toEqual(['recent', 'middle', 'old']);
  });

  it('leave the list given as it was', () => {
    const given = [titled('a', 'closed', '2026-01-10T00:00:00Z'), titled('b', 'closed', '2026-06-10T00:00:00Z')];
    ballotLists(given);
    expect(ids(given)).toEqual(['a', 'b']);
  });

  describe('in this browser', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('are hidden until shown, then keep the choice', () => {
      const held = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => held.get(key) ?? null,
        setItem: (key: string, value: string) => void held.set(key, value),
      });
      expect(finishedVotesShown()).toBe(false);
      rememberFinishedVotesShown(true);
      expect(finishedVotesShown()).toBe(true);
      rememberFinishedVotesShown(false);
      expect(finishedVotesShown()).toBe(false);
    });

    it('stay hidden, and nothing breaks, when storage is blocked', () => {
      const blocked = () => {
        throw new Error('blocked');
      };
      vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
      expect(finishedVotesShown()).toBe(false);
      expect(() => rememberFinishedVotesShown(true)).not.toThrow();
    });
  });
});

describe('ballot list cards', () => {
  const labels = (e: VoterElection) => ballotCard(e, AT).actions.map((a) => `${a.label} ${a.to}${a.main ? ' (main)' : ''}`);

  it('ask a voter who has not voted to vote while voting is open', () => {
    const card = ballotCard(election('open'), AT);
    expect(card).toMatchObject({ status: 'Voting is open. You have not voted yet.', icon: 'how_to_vote', tone: 'primary' });
    expect(labels(election('open'))).toEqual(['Vote now /ballot/e1 (main)']);
  });

  it('say when the voter voted, and offer their ballot', () => {
    const card = ballotCard(election('open', '2026-10-26T16:01:30Z'), AT);
    expect(plain(card.status)).toBe('You voted on Oct 26, 4:01 PM.');
    expect(card).toMatchObject({ icon: 'check_circle', tone: 'positive' });
    expect(labels(election('open', '2026-10-26T16:01:30Z'))).toEqual(['View your ballot /ballot/e1']);
  });

  it('let the ballot be read before voting opens', () => {
    expect(ballotCard(election('scheduled'), AT)).toMatchObject({
      status: 'Voting has not opened yet. You can read the ballot now.',
      tone: 'grey-7',
    });
    expect(labels(election('scheduled'))).toEqual(['Read the ballot /ballot/e1']);
  });

  it('lead with the results once voting has closed', () => {
    expect(ballotCard(election('closed'), AT).status).toBe('Voting has closed.');
    expect(ballotCard(election('certified'), AT).status).toBe('Voting has closed and the results are certified.');
    expect(labels(election('closed'))).toEqual(['See results /results/e1', 'Read the ballot /ballot/e1']);
    expect(labels(election('certified', '2026-10-26T16:01:30Z'))).toEqual(['See results /results/e1', 'View your ballot /ballot/e1']);
    expect(ballotCard(election('certified', '2026-10-26T16:01:30Z'), AT).tone).toBe('positive');
  });
});
