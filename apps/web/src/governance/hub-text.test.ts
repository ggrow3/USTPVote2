import { describe, expect, it } from 'vitest';
import { clicksText, describeHubChange, iconLabel, liveText } from './hub-text.js';

const titles: Record<string, string> = { apps: 'Apps', community: 'Community' };
const say = (change: Parameters<typeof describeHubChange>[0]) => describeHubChange(change, (id) => titles[id] ?? '');

describe('hub wording', () => {
  it('names icons as their networks write themselves', () => {
    expect(iconLabel('youtube')).toBe('YouTube');
    expect(iconLabel('x')).toBe('X');
    expect(iconLabel('donate')).toBe('Donations');
  });

  it('says how many are online only when Discord says', () => {
    expect(liveText(null)).toBe('Live on Discord');
    expect(liveText(1234)).toBe('Live on Discord · 1,234 online');
  });

  it('gives the last 30 days first, then the total', () => {
    expect(clicksText(undefined)).toBe('0 in the last 30 days, 0 in all');
    expect(clicksText({ total: 1200, recent: 40 })).toBe('40 in the last 30 days, 1,200 in all');
  });

  it('lists each unsaved change in words', () => {
    expect(say({ part: 'profile', field: 'tagline', to: 'Science first' })).toBe('Tagline: Science first');
    expect(say({ part: 'profile', field: 'bio', to: '' })).toBe('Bio: left empty');
    expect(say({ part: 'profile', field: 'accent', to: '' })).toBe('Accent colour: the USTP orange');
    expect(say({ part: 'profile', field: 'theme', to: 'device' })).toBe("Default theme: The device's setting");
    expect(say({ part: 'profile', field: 'logo', to: null })).toBe('Remove the logo: the initials show instead');
    expect(say({ part: 'profile', field: 'cover', to: 'a'.repeat(64) })).toBe('A new cover banner');
    expect(say({ part: 'profile', field: 'cover', to: null })).toBe('Remove the cover banner');
    expect(say({ part: 'profile', field: 'background', to: 'b'.repeat(64) })).toBe('A new background photo behind the pages');
    expect(say({ part: 'profile', field: 'background', to: null })).toBe('Page background: the sunrise instead of the photo');
    expect(say({ part: 'discord', field: 'widget', to: true })).toBe('Show the live member widget');
    expect(say({ part: 'section', id: 'x', title: '', change: 'added' })).toBe('New section an untitled section');
    expect(say({ part: 'link', id: 'chat', title: 'Chat', section: 'community', change: 'moved' })).toBe('Move “Chat” to Community');
    expect(say({ part: 'link', id: 'x', title: 'X / Twitter', section: 'follow', change: 'into_icon_row' })).toBe('Put “X / Twitter” in the icon row');
    expect(say({ part: 'link', id: 'vote', title: 'Member voting', section: 'apps', change: 'edited', fields: ['url', 'icon'] })).toBe(
      'Change the address and icon of “Member voting”',
    );
    expect(say({ part: 'link_order', section: 'apps', to: ['register', 'vote'] })).toBe('A new order for the links in Apps');
  });
});
