import { describe, expect, it } from 'vitest';
import { congressOption, congressOptions, day, keySourceText, latestActionLine, totalLine, unwatchConfirmText } from './bill-text.js';

describe('Bills page wording (design §5.14)', () => {
  it('names each Congress with its years, newest first, back to the 103rd', () => {
    expect(congressOption(119)).toBe('119th Congress (2025–2026)');
    expect(congressOption(103)).toBe('103rd Congress (1993–1994)');
    const options = congressOptions(119);
    expect(options[0]).toEqual({ label: '119th Congress (2025–2026)', value: 119 });
    expect(options.at(-1)!.value).toBe(103);
    expect(options).toHaveLength(17);
  });

  it('writes dates and latest actions plainly', () => {
    expect(day('2026-09-24', 'en-US')).toBe('Sep 24, 2026');
    expect(day('2026-10-14T18:28:57Z', 'en-US')).toBe('Oct 14, 2026');
    expect(day(null)).toBe('');
    expect(latestActionLine({ date: '2026-09-24', text: 'Referred to committee.' }, 'en-US')).toBe('Sep 24, 2026: Referred to committee.');
    expect(latestActionLine(null)).toBe('No action recorded yet');
  });

  it('counts versions as GovInfo does, and bills on the page', () => {
    expect(totalLine(0, 0)).toBe('No bills match.');
    expect(totalLine(1, 1)).toBe('1 printed version matches; one bill is on this page.');
    expect(totalLine(1610, 18)).toBe('1,610 printed versions match; 18 bills are on this page.');
  });

  it('says which key is in use and what removing a bill loses', () => {
    expect(keySourceText('demo')).toMatch(/30 requests an hour/);
    expect(keySourceText('fec')).toMatch(/FEC key/);
    expect(unwatchConfirmText('H.R. 1', 0)).toBe('H.R. 1 comes off the team’s watchlist for everyone. It has no notes.');
    expect(unwatchConfirmText('H.R. 1', 3)).toBe('H.R. 1 comes off the team’s watchlist for everyone. Its 3 notes are deleted with it.');
  });
});
