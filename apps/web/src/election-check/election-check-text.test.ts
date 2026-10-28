import type { ElectionFinding } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { changesLabel, finishedAnnouncement, noteSource, notesFor, pointerText, quotedLine, statusText } from './election-check-text.js';

const note = (contestId: string | null, line: number): ElectionFinding => ({
  contestId,
  bylawsLines: [line],
  topic: 'quorum',
  severity: 'medium',
  explanation: 'x',
});

describe('election check notes', () => {
  const check = {
    findings: [note('plank', 2), note(null, 3), note('plank', 4), note('chair', 2)],
    quotedLines: [{ line: 2, text: 'Amendments need two-thirds.' }],
    checker: 'claude' as const,
  };

  it('are shown beside their own contest, or the election as a whole', () => {
    expect(notesFor(check, 'plank').map((f) => f.bylawsLines[0])).toEqual([2, 4]);
    expect(notesFor(check, null).map((f) => f.bylawsLines[0])).toEqual([3]);
    expect(notesFor(check, 'board')).toEqual([]);
    expect(notesFor(null, 'plank')).toEqual([]);
  });

  it('quote the bylaws lines as they read when checked', () => {
    expect(quotedLine(check, 2)).toBe('Amendments need two-thirds.');
    expect(quotedLine(check, 9)).toBeNull();
  });

  it('say they come from an automated check that can be wrong, or from the test stand-in', () => {
    expect(noteSource(check)).toMatch(/Claude, an AI model\. It can be wrong/);
    expect(noteSource({ checker: 'stub' })).toMatch(/not an AI review/);
  });

  it('name what changed since the check', () => {
    expect(changesLabel(['election'])).toBe('the election');
    expect(changesLabel(['election', 'bylaws', 'offices'])).toBe('the election, the bylaws and an office it fills');
  });
});

describe('the check in the editor', () => {
  const done = (n: number, changedSince: ('election' | 'bylaws' | 'offices')[] = []) => ({
    status: 'done' as const,
    findings: Array.from({ length: n }, (_, i) => note(null, i + 1)),
    changedSince,
  });

  it('says where it stands, and announces how it ended', () => {
    expect(statusText(null, true)).toBe('Asking for a check…');
    expect(statusText({ status: 'queued', findings: [] })).toMatch(/^Waiting/);
    expect(statusText({ status: 'running', findings: [] })).toMatch(/minute or two/);
    expect(statusText(done(2))).toBe('2 notes.');
    expect(statusText(done(0))).toBe('Nothing found to note.');
    expect(statusText({ status: 'failed', findings: [] })).toBe('');
    expect(finishedAnnouncement(done(1))).toBe('Check against the bylaws finished: 1 note.');
    expect(finishedAnnouncement(done(0))).toBe('Check against the bylaws finished: nothing found to note.');
  });

  it('points to the check at the top of the page, saying when it is out of date', () => {
    expect(pointerText(done(1), true)).toBe('Bylaws check: 1 note (advisory).');
    expect(pointerText(done(0, ['bylaws']), false)).toBe('Bylaws check: nothing to note (advisory), out of date.');
    expect(pointerText(null, true)).toBe('Not checked against the bylaws yet.');
    expect(pointerText(null, false)).toBe('');
    expect(pointerText({ status: 'running', findings: [], changedSince: [] }, true)).toBe('');
  });
});
