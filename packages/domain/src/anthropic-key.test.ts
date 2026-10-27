import { describe, expect, it } from 'vitest';
import { anthropicKeyHint, anthropicKeySchema, checkAnthropicKey } from './anthropic-key.js';

// Made up, in the shape of an Anthropic API key; never a real one.
const KEY = `sk-ant-api03-${'x'.repeat(80)}-abcd`;

describe('the Anthropic API key', () => {
  it('takes an ordinary API key, trimmed of what a paste brings along', () => {
    expect(checkAnthropicKey(KEY)).toEqual({ ok: true });
    expect(anthropicKeySchema.parse({ key: `  ${KEY}\n` }).key).toBe(KEY);
    expect(anthropicKeySchema.safeParse({ key: '   ' }).success).toBe(false);
    expect(anthropicKeySchema.safeParse({ key: KEY, other: 1 }).success).toBe(false);
  });

  it('refuses what is not one before anything is sent, without repeating it', () => {
    const refusals = [
      [`${KEY.slice(0, 30)} ${KEY.slice(30)}`, /no spaces or line breaks/],
      [`sk-ant-admin01-${'x'.repeat(80)}`, /Admin API key/],
      [`sk-proj-${'x'.repeat(80)}`, /start with "sk-ant-"/],
      ['sk-ant-api03-short', /too short/],
    ] as const;
    for (const [key, reason] of refusals) {
      const check = checkAnthropicKey(key);
      expect(check).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
      expect(check.ok || check.reason.includes(key)).toBe(false);
    }
  });

  it('shows only its last four characters', () => {
    expect(anthropicKeyHint(KEY)).toBe('abcd');
  });
});
