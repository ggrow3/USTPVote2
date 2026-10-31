import { describe, expect, it } from 'vitest';
import { DAILY_JOKES } from '../daily.js';
import { parseRoomInput } from './commands.js';
import { EMPTY_FEED } from './room.js';
import { voiceView, type RoomViewContext } from './views.js';
import {
  checkSignals,
  JOKE_STRIDE,
  jokeBody,
  joinVoice,
  nextJoke,
  offersTo,
  ROOM_VOICE_LIMITS,
  roomSignalsSchema,
  signalRecord,
  touchVoice,
  voiceLive,
  type RoomVoiceRecord,
} from './voice.js';

const T0 = '2026-10-30T12:00:00.000Z';
const later = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

const inCall = (accountId: string, fields: Partial<RoomVoiceRecord> = {}): RoomVoiceRecord => ({
  accountId,
  sessionId: `s-${accountId}`,
  joinedAt: T0,
  seenAt: T0,
  muted: false,
  actions: [],
  ...fields,
});

const ctx: RoomViewContext = { accountId: 'ada', moderator: false, people: new Map([['ada', 'Ada Brooks'], ['bo', 'Bo']]) };

describe('the call', () => {
  it('joins from a page, replacing an earlier page of the member’s, until it is full', () => {
    const joined = joinVoice(inCall('ada', { sessionId: 'old' }), [inCall('bo')], 'ada', 'new', true, later(5));
    expect(joined).toEqual({ ok: true, value: { accountId: 'ada', sessionId: 'new', joinedAt: later(5), seenAt: later(5), muted: true, actions: [later(5)] } });

    const full = Array.from({ length: ROOM_VOICE_LIMITS.participants }, (_, i) => inCall(`m${i}`));
    expect(joinVoice(null, full, 'ada', 'new', false, T0)).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(joinVoice(null, full.slice(1), 'ada', 'new', false, T0).ok).toBe(true);
  });

  it('drops a page that has not said it is there for a minute', () => {
    const v = inCall('ada');
    expect(voiceLive(v, later(ROOM_VOICE_LIMITS.staleSeconds - 1))).toBe(true);
    expect(voiceLive(v, later(ROOM_VOICE_LIMITS.staleSeconds))).toBe(false);
    expect(voiceView([v, inCall('bo', { seenAt: later(-120) })], later(10), ctx).map((p) => p.name)).toEqual(['Ada Brooks']);
  });

  it('keeps a page in the call while it says so, and tells the room only of muting and unmuting', () => {
    const v = inCall('ada');
    expect(touchVoice(v, v.sessionId, false, later(20))).toEqual({ ok: true, value: { record: { ...v, seenAt: later(20) }, changed: false } });
    expect(touchVoice(v, v.sessionId, true, later(20))).toMatchObject({ ok: true, value: { record: { muted: true, actions: [later(20)] }, changed: true } });
    // Another page took over, or this one went quiet too long: it joins again instead.
    expect(touchVoice(v, 'other', false, later(20))).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(touchVoice(v, v.sessionId, false, later(90))).toMatchObject({ ok: false, refusal: 'conflict' });
  });

  it('limits how fast a member joins, mutes and calls', () => {
    const busy = inCall('ada', { actions: Array<string>(ROOM_VOICE_LIMITS.actionsPerMinute).fill(T0) });
    expect(touchVoice(busy, busy.sessionId, true, later(1))).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(touchVoice(busy, busy.sessionId, false, later(1)).ok).toBe(true);
    expect(touchVoice({ ...busy, seenAt: later(30) }, busy.sessionId, true, later(61))).toMatchObject({ ok: true, value: { record: { actions: [later(61)] } } });
    expect(joinVoice(busy, [], 'ada', 'new', false, later(1))).toMatchObject({ ok: false, refusal: 'rate_limited' });
  });

  it('passes handshakes only between pages in the call', () => {
    const ada = inCall('ada');
    const bo = inCall('bo');
    const call = new Map([ada, bo].map((v) => [v.accountId, v]));
    const offer = (fields = {}) => ({ sessionId: ada.sessionId, signals: [{ to: 'bo', toSession: bo.sessionId, kind: 'offer' as const, sdp: 'v=0', ...fields }] });
    expect(checkSignals(ada, offer(), call, later(1))).toEqual({ ok: true, value: { ...ada, actions: [later(1)] } });
    expect(checkSignals(ada, { ...offer(), sessionId: 'old' }, call, later(1))).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(checkSignals(ada, offer({ toSession: 'gone' }), call, later(1))).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(checkSignals(ada, offer({ to: 'ada', toSession: ada.sessionId }), call, later(1))).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(checkSignals(null, offer(), call, later(1))).toMatchObject({ ok: false, refusal: 'conflict' });

    expect(signalRecord(ada, offer().signals[0]!, 'sig', 7, T0)).toEqual({
      signalId: 'sig',
      seq: 7,
      from: 'ada',
      fromSession: ada.sessionId,
      to: 'bo',
      toSession: bo.sessionId,
      kind: 'offer',
      sdp: 'v=0',
      createdAt: T0,
      expireAt: later(ROOM_VOICE_LIMITS.signalMinutes * 60),
    });
    expect(roomSignalsSchema.safeParse({ sessionId: 's', signals: [{ to: 'bo', toSession: 's', kind: 'offer', sdp: 'x'.repeat(ROOM_VOICE_LIMITS.sdp + 1) }] }).success).toBe(false);
  });

  it('has the later joiner of each pair make the offer, so the two never offer at once', () => {
    const first = { accountId: 'bo', joinedAt: T0 };
    const second = { accountId: 'ada', joinedAt: later(3) };
    expect(offersTo(second, first)).toBe(true);
    expect(offersTo(first, second)).toBe(false);
    const tieA = { accountId: 'a', joinedAt: T0 };
    const tieB = { accountId: 'b', joinedAt: T0 };
    expect(offersTo(tieA, tieB)).not.toBe(offersTo(tieB, tieA));
  });

  it('lists who is in the call by name, in the order they joined', () => {
    expect(voiceView([inCall('bo', { joinedAt: later(2), muted: true }), inCall('ada')], later(3), ctx)).toEqual([
      { accountId: 'ada', name: 'Ada Brooks', sessionId: 's-ada', joinedAt: T0, muted: false, mine: true },
      { accountId: 'bo', name: 'Bo', sessionId: 's-bo', joinedAt: later(2), muted: true, mine: false },
    ]);
  });
});

describe('/joke', () => {
  it('goes through every joke before telling one again', () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    expect(gcd(JOKE_STRIDE, DAILY_JOKES.length)).toBe(1);
    const told = DAILY_JOKES.map((_, jokes) => nextJoke({ ...EMPTY_FEED, jokes }));
    expect(new Set(told.map((j) => (j.ok ? j.value.setup : null))).size).toBe(DAILY_JOKES.length);
    expect(nextJoke({ ...EMPTY_FEED, jokes: DAILY_JOKES.length })).toEqual(told[0]);
  });

  it('is refused while the assistant is switched off', () => {
    expect(nextJoke({ ...EMPTY_FEED, assistantOn: false })).toMatchObject({ ok: false, refusal: 'conflict' });
  });

  it('puts the punchline on its own line, and is a command', () => {
    expect(jokeBody({ setup: 'Why?', punchline: 'Because.' })).toBe('Why?\nBecause.');
    expect(parseRoomInput('/joke')).toEqual({ kind: 'command', command: 'joke', args: '' });
  });
});
