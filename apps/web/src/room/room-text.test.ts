import { describe, expect, it } from 'vitest';
import { answerParts, assistantLine, changedLine, commandHints, dayLabel, dueLabel, overdue, peopleLine, serverLine } from './room-text.js';

const NOW = new Date(2026, 9, 29, 15, 0);
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe('room wording', () => {
  it('labels days the way a chat does', () => {
    expect(dayLabel(local(2026, 10, 29, 9), NOW)).toBe('Today');
    expect(dayLabel(local(2026, 10, 28, 23), NOW)).toBe('Yesterday');
    expect(dayLabel(local(2026, 10, 20), NOW)).toBe('Tuesday, October 20');
    expect(dayLabel(local(2025, 12, 31), NOW)).toBe('Wednesday, December 31, 2025');
  });

  it('reads due dates as calendar days, overdue from the day after', () => {
    expect(dueLabel('2026-11-05')).toBe('Nov 5, 2026');
    expect(overdue('2026-10-29', NOW)).toBe(false);
    expect(overdue('2026-10-28', NOW)).toBe(true);
    expect(overdue(null, NOW)).toBe(false);
  });

  it('suggests the commands that start with what was typed, the switch only to Membership Admins', () => {
    expect(commandHints('/', false).map((h) => h.command)).toEqual(['ask', 'decide', 'todo', 'memory', 'forget', 'leave-room']);
    expect(commandHints('/', true).map((h) => h.command)).toContain('assistant');
    expect(commandHints('/de', false).map((h) => h.command)).toEqual(['decide']);
    expect(commandHints('/ask what', false)).toEqual([]);
    expect(commandHints('hello', false)).toEqual([]);
  });

  it('links an answer’s citations to its sources, and only those it has', () => {
    expect(answerParts('Plan v2 [1], north first [2]. Odd [5].', 2)).toEqual([
      { text: 'Plan v2 ' },
      { text: '[1]', cite: 1 },
      { text: ', north first ' },
      { text: '[2]', cite: 2 },
      { text: '. Odd [5].' },
    ]);
  });

  it('names who is in the room briefly', () => {
    expect(peopleLine([])).toBe('Nobody yet');
    expect(peopleLine(['Ada', 'Bo'])).toBe('Ada and Bo');
    expect(peopleLine(['Ada', 'Bo', 'Cy'])).toBe('Ada, Bo, Cy');
    expect(peopleLine(['Ada', 'Bo', 'Cy', 'Di', 'Ed'])).toBe('Ada, Bo and 3 others');
  });

  it('says how the assistant runs, or why it does not', () => {
    const base = { on: true, server: true, model: 'self-hosted' as const, switchedAt: null, switchedBy: null, pending: [] };
    expect(assistantLine(base)).toMatchObject({ label: 'Assistant on', on: true, caption: expect.stringContaining('nothing said here goes to an AI company') });
    expect(assistantLine({ ...base, on: false, switchedBy: { accountId: 'm', name: 'Morgan' } })).toMatchObject({ label: 'Assistant off', caption: expect.stringContaining('Morgan switched it off') });
    expect(assistantLine({ ...base, model: 'off' })).toMatchObject({ label: 'Assistant not set up', on: false });
    expect(assistantLine({ ...base, server: false })).toMatchObject({ label: 'Assistant’s server off', on: false });
  });

  it('describes the admins’ switches', () => {
    expect(changedLine(null, null)).toBe('');
    expect(changedLine({ accountId: 'a', name: 'Ada' }, local(2026, 10, 29, 9), NOW)).toMatch(/^by Ada, \d{1,2}:\d{2} AM$/);
    expect(serverLine({ on: true, changedAt: null, changedBy: null, model: 'off' })).toMatchObject({ title: 'No model server yet', running: false });
    expect(serverLine({ on: false, changedAt: null, changedBy: null, model: 'self-hosted' })).toMatchObject({ title: 'The model server is off', running: false });
    expect(serverLine({ on: true, changedAt: null, changedBy: null, model: 'self-hosted' })).toMatchObject({ running: true, caption: expect.stringContaining('$1.05') });
  });
});
