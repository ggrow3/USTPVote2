import { describe, expect, it } from 'vitest';
import type { BylawsCheckReference, BylawsFinding } from 'ustp-domain';
import { findingsLabel, flaggedLines, linesLabel, referenceNote, stillReads } from './bylaws-check-text.js';

const finding = (lines: number[]): BylawsFinding => ({
  lines,
  source: 'ustp-constitution',
  provision: 'Article V',
  severity: 'medium',
  explanation: 'Conflicts.',
});

describe('bylaws check wording', () => {
  it('names lines and findings in words', () => {
    expect(linesLabel([4])).toBe('line 4');
    expect(linesLabel([4, 5, 6, 9])).toBe('lines 4–6 and 9');
    expect(linesLabel([1, 3, 7])).toBe('lines 1, 3 and 7');
    expect(findingsLabel([2])).toBe('Finding 2');
    expect(findingsLabel([1, 3, 4])).toBe('Findings 1, 3 and 4');
  });

  it('says which text of each reference was used', () => {
    const ref: BylawsCheckReference = {
      id: 'ustp-constitution',
      title: 'Constitution',
      url: 'https://transhumanist-party.org/constitution/',
      retrievedAt: '2026-10-22T12:00:00.000Z',
      modifiedAt: '2026-09-14T07:05:22.000Z',
      sha256: 'ab'.repeat(32),
    };
    expect(referenceNote(ref, 'en-GB')).toBe('read 22 Oct 2026, page updated 14 Sept 2026');
    expect(referenceNote({ ...ref, id: 'us-constitution', modifiedAt: null }, 'en-GB')).toBe('National Archives transcription, snapshot of 22 Oct 2026');
    expect(referenceNote({ ...ref, retrievedAt: null })).toBe('not read by the stand-in');
  });
});

describe('flaggedLines', () => {
  const checked = ['Article I.', 'Officers may amend without a vote of the members.', 'Article II.', 'Opposes life extension.'];

  it('maps each named line to its findings', () => {
    const flags = flaggedLines([finding([2, 4]), finding([4])], checked, checked);
    expect([...flags]).toEqual([
      [2, [1]],
      [4, [1, 2]],
    ]);
  });

  it('drops lines edited since the check, and lines past the end of the draft', () => {
    const now = [...checked.slice(0, 3)];
    now[1] = 'Officers may amend with a vote of the members.';
    expect([...flaggedLines([finding([2, 4])], checked, now)]).toEqual([]);
    expect(stillReads(1, checked, now)).toBe(true);
    expect(stillReads(0, checked, now)).toBe(false);
  });
});
