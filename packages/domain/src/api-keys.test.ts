import { describe, expect, it } from 'vitest';
import { apiKeyHint, apiKeyNameSchema, apiKeySchema, checkApiKey } from './api-keys.js';

// Made up, in each service's shape; never real keys.
const FEC = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789wxyz';
const OPEN_STATES = '1b2c3d4e-5f60-4a1b-8c2d-0123456789ab';
const CIVIC = `AIzaSy${'x'.repeat(28)}_wxyz`;

describe('the public-records services’ keys', () => {
  it('takes each service’s own shape, trimmed of what a paste brings along', () => {
    expect(checkApiKey('fec', FEC)).toEqual({ ok: true });
    expect(checkApiKey('openstates', OPEN_STATES)).toEqual({ ok: true });
    expect(checkApiKey('civic', CIVIC)).toEqual({ ok: true });
    expect(apiKeySchema.parse({ key: `  ${FEC}\n` }).key).toBe(FEC);
    expect(apiKeySchema.safeParse({ key: '  ' }).success).toBe(false);
    expect(apiKeySchema.safeParse({ key: FEC, other: 1 }).success).toBe(false);
    expect(apiKeyNameSchema.safeParse('anthropic').success).toBe(false);
  });

  it('refuses a key pasted into the wrong card before anything is sent, without repeating it', () => {
    const refusals = [
      ['fec', `${FEC.slice(0, 20)} ${FEC.slice(20)}`, /no spaces or line breaks/],
      ['fec', `sk-ant-api03-${'x'.repeat(80)}`, /Anthropic API key card/],
      ['fec', 'DEMO_KEY', /shared demo key/],
      ['fec', CIVIC, /40 letters and digits/],
      ['openstates', FEC, /36 characters/],
      ['civic', OPEN_STATES, /start with "AIza"/],
      ['civic', `${CIVIC}x`, /39 characters/],
    ] as const;
    for (const [name, key, reason] of refusals) {
      const check = checkApiKey(name, key);
      expect(check).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
      expect(check.ok || check.reason.includes(key)).toBe(false);
    }
  });

  it('shows only its last four characters', () => {
    expect(apiKeyHint(CIVIC)).toBe('wxyz');
  });
});
