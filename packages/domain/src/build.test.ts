import { describe, expect, it } from 'vitest';
import { buildCommit } from './build.js';

describe('buildCommit', () => {
  it('accepts a full or abbreviated SHA, lowercased and trimmed', () => {
    expect(buildCommit('6743983ABCDEF0123456789abcdef0123456789a')).toBe('6743983abcdef0123456789abcdef0123456789a');
    expect(buildCommit(' 6743983\n')).toBe('6743983');
  });

  it('treats anything else as unknown', () => {
    for (const value of [undefined, null, '', '   ', 'main', '674398', 'g743983', '6743983 extra', 42]) {
      expect(buildCommit(value)).toBeNull();
    }
  });
});
