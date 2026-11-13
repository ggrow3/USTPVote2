import { describe, expect, it } from 'vitest';
import type { BroadcastCounts, BroadcastPreview } from 'ustp-domain';
import { audienceText, broadcastStatusText, previewText } from './broadcast-text.js';

const NONE = { email_stopped: 0, unsubscribed: 0, not_opted_in: 0, no_address: 0, unverified: 0, undeliverable: 0 };
const counts = (over: Partial<BroadcastCounts> = {}): BroadcastCounts => ({ pending: 0, sent: 0, skipped: 0, failed: 0, delivered: 0, bounced: 0, complained: 0, ...over });

describe('emails to the newsletter’s subscribers (design §10.15)', () => {
  it('say how many subscribers get it, with the members or alone', () => {
    const withMembers: BroadcastPreview = {
      matched: 10,
      willGet: 8,
      skipped: { ...NONE, not_opted_in: 2 },
      subscribers: { listed: 32, willGet: 30, skipped: { member_copy: 2, stopped: 0, undeliverable: 0 } },
    };
    expect(previewText(withMembers)).toBe(
      'Goes to 8 of the 10 members chosen. Left out: 2 did not opt in. And to 30 of the 32 newsletter subscribers. Left out: 2 get it as members.',
    );
    const alone: BroadcastPreview = { matched: 0, willGet: 0, skipped: NONE, subscribers: { listed: 1, willGet: 1, skipped: { member_copy: 0, stopped: 0, undeliverable: 0 } } };
    expect(previewText(alone, false)).toBe('Goes to 1 of the 1 newsletter subscriber.');
    expect(previewText({ ...alone, subscribers: { listed: 0, willGet: 0, skipped: { member_copy: 0, stopped: 0, undeliverable: 0 } } }, false)).toBe(
      'Nobody has confirmed a newsletter sign-up yet.',
    );
  });

  it('name the subscribers as the audience, and count people rather than members', () => {
    expect(audienceText({ kind: 'subscribers' })).toBe('To the newsletter’s subscribers');
    expect(audienceText({ kind: 'all_active', withSubscribers: true })).toBe('To all Active members who opted in, and the newsletter’s subscribers');
    const done = (audience: Parameters<typeof broadcastStatusText>[0]['audience']) =>
      broadcastStatusText({ status: 'done', counts: counts({ sent: 2 }), held: null, preview: null, completedAt: null, approval: null, audience });
    expect(done({ kind: 'subscribers' })).toBe('Sent to 2 people.');
    expect(done({ kind: 'all_active' })).toBe('Sent to 2 members.');
  });
});
