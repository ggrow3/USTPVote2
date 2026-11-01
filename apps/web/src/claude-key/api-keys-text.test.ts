import type { ApiKeyStatus } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { apiKeyHintText, apiKeyStatusText, removeConfirmText } from './api-keys-text.js';

const status = (fields: Partial<ApiKeyStatus>): ApiKeyStatus => ({
  name: 'fec',
  source: 'app',
  addedAt: '2026-11-01T12:00:00.000Z',
  addedBy: { accountId: 'a1', name: 'Ada Admin' },
  hint: 'wxyz',
  deploymentKey: false,
  ...fields,
});

describe('Admin › API keys wording: the public-records keys', () => {
  it('says which key is in use, and what having none means for each service', () => {
    expect(apiKeyStatusText(status({}), 'en-US')).toBe('A key is set. It ends in wxyz and was added on Nov 1, 2026 by Ada Admin.');
    expect(apiKeyStatusText(status({ addedBy: null, hint: null }), 'en-US')).toBe('A key is set. It was added on Nov 1, 2026 outside this app, so who added it is not known here.');
    expect(apiKeyStatusText(status({ source: 'deployment', addedAt: null, addedBy: null, hint: null }))).toMatch(/deployment’s own key is in use/);
    expect(apiKeyStatusText(status({ source: 'none' }))).toMatch(/^No key is set, so the FEC’s shared demo key is used/);
    expect(apiKeyStatusText(status({ name: 'openstates', source: 'none' }))).toBe('No key is set, so state legislators are left out of the Your area page.');
    expect(apiKeyStatusText(status({ name: 'civic', source: 'none' }))).toMatch(/ballot’s contests are left out/);
  });

  it('says what each key looks like and whether it is tried', () => {
    expect(apiKeyHintText('civic', true)).toBe('Starts with AIza. A key is tried with its service before it is saved, and one the service does not accept is not kept.');
    expect(apiKeyHintText('fec', false)).toMatch(/^40 letters and digits\. With the emulators/);
  });

  it('says before removing one what is used instead', () => {
    expect(removeConfirmText(status({ name: 'civic', deploymentKey: true }))).toMatch(/^The deployment’s own key is used again\. The key stays valid/);
    expect(removeConfirmText(status({ name: 'openstates' }))).toMatch(/^Without a key, state legislators are left out/);
  });
});
