import type { AnthropicKeyStatus } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { asSentence, keyStatusText, savedAnnouncement, switchText, triedText } from './claude-key-text.js';

const status = (fields: Partial<AnthropicKeyStatus>): AnthropicKeyStatus => ({
  set: true,
  addedAt: '2026-10-27T12:00:00.000Z',
  addedBy: { accountId: 'a1', name: 'Ada Admin' },
  hint: 'AAAA',
  checks: { bylaws: 'claude', consistency: 'off' },
  tried: true,
  ...fields,
});

describe('Admin › Claude wording', () => {
  it('says whether a key is set, which, and who added it, never more of it', () => {
    expect(keyStatusText(status({}), 'en-US')).toBe('A key is set. It ends in AAAA and was added on Oct 27, 2026 by Ada Admin.');
    expect(keyStatusText(status({ addedBy: null, hint: null }), 'en-US')).toBe(
      'A key is set. It was added on Oct 27, 2026 outside this app, so who added it is not known here.',
    );
    expect(keyStatusText(status({ set: false, addedAt: null, addedBy: null, hint: null }))).toBe('No key is set, so neither Claude check can run.');
    expect(savedAnnouncement(status({}))).toBe('Key saved. It ends in AAAA.');
  });

  it("says where each check stands, naming the deployment's switch when it is off", () => {
    expect(switchText('bylaws', 'claude', true)).toBe('On: it runs with this key.');
    expect(switchText('bylaws', 'claude', false)).toBe('On, but it cannot run until a key is added.');
    expect(switchText('consistency', 'off', true)).toMatch(/^Off in this deployment's settings \(consistency_check_enabled in Terraform\)/);
    expect(switchText('consistency', 'stub', false)).toMatch(/stand-in/);
    expect(triedText(false)).toMatch(/without being tried/);
  });

  it('turns a reason into the sentence under the field', () => {
    expect(asSentence('anthropic did not accept this key')).toBe('Anthropic did not accept this key.');
    expect(asSentence('Paste the key.')).toBe('Paste the key.');
  });
});
