import { describe, expect, it } from 'vitest';
import { changeVote, NO_VOTES } from '../votes.js';
import { checkReactable, reactToMessage, voteOnMessage, type RoomReactionChange, type RoomReactionRecord } from './reactions.js';
import { erased, newMessage, type RoomMessageRecord } from './room.js';
import { messageView, type RoomViewContext } from './views.js';

const AT = '2026-10-29T12:00:00.000Z';
const LATER = '2026-10-29T12:05:00.000Z';
const message = (fields: Partial<RoomMessageRecord> = {}): RoomMessageRecord => ({
  ...newMessage({ messageId: 'm1', kind: 'member', authorId: 'ada', body: 'Canvass the north side first', createdAt: AT }, 1),
  ...fields,
});
const changed = (outcome: { ok: boolean }) => (outcome as { ok: true; value: RoomReactionChange }).value;
const ctx = (accountId: string, reactions: RoomReactionRecord[] = []): RoomViewContext => ({
  accountId,
  moderator: false,
  people: new Map([['ada', 'Ada Brooks']]),
  reactions: new Map(reactions.map((r) => [r.messageId, r])),
});

describe('votes, as the forum counts them', () => {
  it('moves the tally as a vote is given, changed and taken back', () => {
    const up = changeVote(NO_VOTES, 0, 1);
    expect(up).toEqual({ up: 1, down: 0, score: 1 });
    expect(changeVote(up, 1, -1)).toEqual({ up: 0, down: 1, score: -1 });
    expect(changeVote({ up: 3, down: 1, score: 2 }, -1, 0)).toEqual({ up: 3, down: 0, score: 3 });
  });
});

describe('votes on messages', () => {
  it('counts one vote per member, which they change or take back', () => {
    const up = changed(voteOnMessage(message(), null, 1, 'bo', 2, AT));
    expect(up.message).toMatchObject({ up: 1, down: 0, score: 1, seq: 2 });
    expect(up.record).toEqual({ messageId: 'm1', accountId: 'bo', vote: 1, reactions: [], at: AT, expireAt: message().expireAt });

    const down = changed(voteOnMessage(up.message, up.record, -1, 'bo', 3, LATER));
    expect(down.message).toMatchObject({ up: 0, down: 1, score: -1, seq: 3 });
    expect(down.record).toMatchObject({ vote: -1, at: LATER });

    const back = changed(voteOnMessage(down.message, down.record, 0, 'bo', 4, LATER));
    expect(back.message).toMatchObject({ up: 0, down: 0, score: 0 });
    // Nothing left to keep: the record is deleted.
    expect(back.record).toBeNull();
  });

  it('changes nothing when the vote is the one they gave', () => {
    const up = changed(voteOnMessage(message(), null, 1, 'bo', 2, AT));
    expect(voteOnMessage(up.message, up.record, 1, 'bo', 3, LATER)).toEqual({ ok: true, value: null });
    expect(voteOnMessage(message(), null, 0, 'bo', 2, AT)).toEqual({ ok: true, value: null });
  });

  it('keeps a member’s reactions when their vote is taken back', () => {
    const liked = changed(reactToMessage(message(), null, { reaction: 'like', on: true }, 'bo', 2, AT));
    const up = changed(voteOnMessage(liked.message, liked.record, 1, 'bo', 3, AT));
    expect(changed(voteOnMessage(up.message, up.record, 0, 'bo', 4, AT)).record).toMatchObject({ vote: 0, reactions: ['like'] });
  });

  it('takes votes and reactions on members’ messages and answers only, while they are there', () => {
    expect(checkReactable(message()).ok).toBe(true);
    expect(checkReactable(message({ kind: 'assistant', authorId: null })).ok).toBe(true);
    expect(checkReactable(message({ kind: 'notice' }))).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(checkReactable(message({ deletedAt: AT }))).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(checkReactable(null)).toMatchObject({ ok: false, refusal: 'not_found' });
    expect(voteOnMessage(message({ kind: 'notice' }), null, 1, 'bo', 2, AT)).toMatchObject({ ok: false });
    expect(reactToMessage(message({ deletedAt: AT }), null, { reaction: 'like', on: true }, 'bo', 2, AT)).toMatchObject({ ok: false, refusal: 'not_found' });
  });
});

describe('reactions', () => {
  it('counts each reaction once per member, in a fixed order, and drops those nobody gives', () => {
    const bo = changed(reactToMessage(message(), null, { reaction: 'thanks', on: true }, 'bo', 2, AT));
    const bo2 = changed(reactToMessage(bo.message, bo.record, { reaction: 'like', on: true }, 'bo', 3, AT));
    expect(bo2.record).toMatchObject({ reactions: ['like', 'thanks'] });
    const cy = changed(reactToMessage(bo2.message, null, { reaction: 'like', on: true }, 'cy', 4, AT));
    expect(cy.message.reactions).toEqual([
      { reaction: 'like', count: 2 },
      { reaction: 'thanks', count: 1 },
    ]);
    const off = changed(reactToMessage(cy.message, bo2.record, { reaction: 'thanks', on: false }, 'bo', 5, AT));
    expect(off.message).toMatchObject({ reactions: [{ reaction: 'like', count: 2 }], seq: 5 });
    expect(off.record).toMatchObject({ reactions: ['like'] });
    expect(changed(reactToMessage(off.message, off.record, { reaction: 'like', on: false }, 'bo', 6, AT)).record).toBeNull();
  });

  it('changes nothing when adding one they gave, or taking back one they did not', () => {
    const bo = changed(reactToMessage(message(), null, { reaction: 'love', on: true }, 'bo', 2, AT));
    expect(reactToMessage(bo.message, bo.record, { reaction: 'love', on: true }, 'bo', 3, AT)).toEqual({ ok: true, value: null });
    expect(reactToMessage(bo.message, bo.record, { reaction: 'laugh', on: false }, 'bo', 3, AT)).toEqual({ ok: true, value: null });
  });

  it('go when the message’s text goes', () => {
    const up = changed(voteOnMessage(message(), null, 1, 'bo', 2, AT)).message;
    const liked = changed(reactToMessage(up, null, { reaction: 'like', on: true }, 'cy', 3, AT)).message;
    expect(erased(liked, 'ada', 4, LATER)).toMatchObject({ up: 0, down: 0, score: 0, reactions: [], body: '' });
  });
});

describe('what each member sees', () => {
  it('shows the score and the counts, and only the viewer’s own vote and reactions', () => {
    const bo = changed(voteOnMessage(message(), null, -1, 'bo', 2, AT));
    const boLikes = changed(reactToMessage(bo.message, bo.record, { reaction: 'like', on: true }, 'bo', 3, AT));
    const cy = changed(reactToMessage(boLikes.message, null, { reaction: 'like', on: true }, 'cy', 4, AT));
    const cyUp = changed(voteOnMessage(cy.message, cy.record, 1, 'cy', 5, AT));
    const shown = cyUp.message;

    expect(messageView(shown, ctx('bo', [boLikes.record!]))).toMatchObject({
      reactable: true,
      score: 0,
      myVote: -1,
      reactions: [{ reaction: 'like', count: 2, mine: true }],
    });
    expect(messageView(shown, ctx('cy', [cyUp.record!]))).toMatchObject({ myVote: 1, reactions: [{ mine: true }] });
    const ada = messageView(shown, ctx('ada'));
    expect(ada).toMatchObject({ score: 0, myVote: 0, reactions: [{ reaction: 'like', count: 2, mine: false }] });
    // Totals only: nothing in a view says who voted or reacted.
    expect(JSON.stringify(ada)).not.toMatch(/"(bo|cy)"/);
    expect(messageView(message({ kind: 'notice' }), ctx('ada')).reactable).toBe(false);
  });
});
