import { describe, expect, it } from 'vitest';
import { publishBylawsSchema } from './api.js';
import { bylawsInForce, nextBylawsVersion, publishedBylawsText } from './bylaws.js';

describe('bylaws in force', () => {
  it('are the newest version unless none is published or its text is blank', () => {
    const v2 = { version: '2', text: 'Article I. Name.\n' };
    expect(bylawsInForce(v2)).toBe(v2);
    expect(bylawsInForce(null)).toBeNull();
    expect(bylawsInForce(undefined)).toBeNull();
    expect(bylawsInForce({ version: '3', text: '' })).toBeNull();
    expect(bylawsInForce({ version: '3', text: ' \n\t' })).toBeNull();
  });

  it('are published blank when the field holds only whitespace, and exactly as written otherwise', () => {
    expect(publishedBylawsText('  \n ')).toBe('');
    expect(publishedBylawsText(' Article I.\n')).toBe(' Article I.\n');
    const blank = publishBylawsSchema.parse({ version: '3', title: 'USTP Bylaws', text: '\n\n', amends: '2' });
    expect(blank.text).toBe('');
    expect(publishBylawsSchema.safeParse({ version: '3', title: 'USTP Bylaws', text: 'x'.repeat(500_001) }).success).toBe(false);
  });
});

describe('the next bylaws version', () => {
  it('raises the last number of the current version, or starts at 1', () => {
    expect(nextBylawsVersion(null)).toBe('1');
    expect(nextBylawsVersion(undefined)).toBe('1');
    expect(nextBylawsVersion('2')).toBe('3');
    expect(nextBylawsVersion('2026.1')).toBe('2026.2');
    expect(nextBylawsVersion('v9')).toBe('v10');
    expect(nextBylawsVersion('draft')).toBe('draft.1');
  });
});
