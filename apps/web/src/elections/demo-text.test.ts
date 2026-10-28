import type { ContestRecord, ElectionDetail } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { demoSummary, demoWindow, votingLength } from './demo-text.js';

const contest = (spec: ContestRecord['spec']) => ({ spec }) as ContestRecord;
const irv = contest({ kind: 'irv', id: 'a', candidates: ['x', 'y'] });
const committee = contest({ kind: 'choose_n', id: 'b', candidates: ['x', 'y', 'z'], seats: 2, maxSelections: 2 });
const measure = contest({ kind: 'proposal', id: 'c', passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' } });
const detail = (contests: ContestRecord[], secrecy: 'secret' | 'open' = 'secret', voters = 5) =>
  ({ election: { secrecy }, contests, roll: { count: voters } }) as unknown as ElectionDetail;

describe('demo election wording', () => {
  it('names the voting length in the largest whole unit', () => {
    expect([10, 15, 60, 120, 1440].map(votingLength)).toEqual(['10 minutes', '15 minutes', '1 hour', '2 hours', '1 day']);
  });

  it('sums up what a demo holds', () => {
    expect(demoSummary(detail([irv, irv, irv, committee, measure]))).toBe('3 offices, 1 committee and 1 ballot measure · secret ballot · 5 test voters');
    expect(demoSummary(detail([irv, irv, measure, measure], 'open'))).toBe('2 offices and 2 ballot measures · roll-call ballot · 5 test voters');
    expect(demoSummary(detail([irv, irv], 'secret', 1))).toBe('2 offices · secret ballot · 1 test voter');
  });

  it('gives the window as times today, with the day otherwise', () => {
    const now = new Date(2026, 9, 28, 16, 0);
    const today = demoWindow({ opensAt: new Date(2026, 9, 28, 16, 1).toISOString(), closesAt: new Date(2026, 9, 28, 16, 16).toISOString() }, now);
    expect(today).toMatch(/^Voting opens at 4:01\s?PM and closes at 4:16\s?PM\.$/);
    const tomorrow = demoWindow({ opensAt: new Date(2026, 9, 28, 16, 1).toISOString(), closesAt: new Date(2026, 9, 29, 16, 1).toISOString() }, now);
    expect(tomorrow).toMatch(/closes at Thu, Oct 29, 4:01\s?PM\.$/);
  });
});
