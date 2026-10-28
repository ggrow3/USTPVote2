import { describe, expect, it } from 'vitest';
import {
  checkHub,
  clickCount,
  clickDay,
  clickTargets,
  DEFAULT_HUB,
  effectiveAccent,
  HUB_LIMITS,
  hubChanges,
  hubInitials,
  hubSchema,
  isHubId,
  newHubId,
  publicHub,
  resolveHub,
  urlProblem,
  type Hub,
  type HubLink,
  type HubSection,
} from './hub.js';

const hub = (change: Partial<Hub>): Hub => ({ ...DEFAULT_HUB, ...change });
const profile = (change: Partial<Hub['profile']>) => hub({ profile: { ...DEFAULT_HUB.profile, ...change } });
const discord = (change: Partial<Hub['discord']>) => hub({ discord: { ...DEFAULT_HUB.discord, ...change } });
const section = (id: string, links: HubLink[], change: Partial<HubSection> = {}): HubSection => ({ id, title: id, shown: true, links, ...change });
const link = (id: string, change: Partial<HubLink> = {}): HubLink => ({
  id,
  title: id,
  subtitle: '',
  url: `https://example.org/${id}`,
  icon: 'link',
  shown: true,
  iconRow: false,
  featured: false,
  ...change,
});
const reason = (h: Hub) => {
  const check = checkHub(h);
  return check.ok ? null : check.reason;
};
const INVITE = 'https://discord.gg/abc123';
const GUILD = '123456789012345678';

describe('the default hub', () => {
  it("is the party's, with the tagline from its site, its orange and the dark theme", () => {
    expect(DEFAULT_HUB.profile).toEqual({
      name: 'U.S. Transhumanist Party',
      tagline: 'Putting science, health & technology at the forefront of American politics',
      bio: 'Vote on proposals, join the conversation on Discord, and follow USTP everywhere.',
      logo: null,
      accent: '',
      theme: 'dark',
    });
    expect(effectiveAccent(DEFAULT_HUB.profile)).toBe('#bd4e00');
    expect(checkHub(DEFAULT_HUB)).toEqual({ ok: true });
    expect(resolveHub(DEFAULT_HUB)).toEqual(DEFAULT_HUB);
  });

  it('shows only addresses checked on the party site, and keeps every other one as a hidden draft', () => {
    const shown = publicHub(DEFAULT_HUB, 0);
    const external = DEFAULT_HUB.sections.flatMap((s) => s.links).filter((l) => l.url.startsWith('https://'));
    expect(external.map((l) => l.url)).toEqual([
      'https://transhumanist-party.org/',
      'https://twitter.com/USTranshumanist',
      'https://www.facebook.com/USTranshumanistParty/',
      'https://www.linkedin.com/groups/13502241',
    ]);
    expect(DEFAULT_HUB.sections.flatMap((s) => s.links).filter((l) => !l.url).every((l) => !l.shown)).toBe(true);
    expect(shown.icons.map((i) => i.icon)).toEqual(['x', 'facebook', 'linkedin']);
    expect(shown.discord).toBeNull();
  });

  it('leads with the voting app, starred, at its sign-in page', () => {
    const shown = publicHub(DEFAULT_HUB, 0);
    expect(shown.sections.map((s) => [s.title, s.links.map((l) => l.title)])).toEqual([
      ['Apps', ['USTP Vote', 'Become a member', 'Official website']],
      ['Follow us', ['X / Twitter', 'Facebook', 'LinkedIn']],
    ]);
    expect(shown.sections[0]!.links[0]).toMatchObject({ url: '/vote', icon: 'vote', featured: true });
  });

  it('has every network ready for the icon row once its address is filled in', () => {
    const drafts = DEFAULT_HUB.sections.flatMap((s) => s.links).filter((l) => l.iconRow && !l.shown);
    expect(drafts.map((l) => l.icon)).toEqual(['discord', 'reddit', 'telegram', 'instagram', 'youtube', 'tiktok', 'threads', 'bluesky', 'mastodon']);
  });
});

describe('resolving what was saved', () => {
  it('fills missing parts from the default and puts each text on one line', () => {
    const resolved = resolveHub({ profile: { name: '  U.S.\n Transhumanist   Party ', accent: '#BD4E00', theme: 'sepia' } });
    expect(resolved.profile).toEqual({ ...DEFAULT_HUB.profile, name: 'U.S. Transhumanist Party', accent: '#bd4e00' });
    expect(resolved.sections).toEqual(DEFAULT_HUB.sections);
    expect(resolved.discord).toEqual(DEFAULT_HUB.discord);
  });

  it('gives an unknown icon the plain link icon, and missing flags off', () => {
    const resolved = resolveHub({ sections: [{ id: 'a', title: 'A', shown: true, links: [{ id: 'l', title: 'L', url: '/verify', icon: 'myspace', shown: true }] }] });
    expect(resolved.sections[0]!.links[0]).toMatchObject({ icon: 'link', iconRow: false, featured: false });
  });

  it('keeps saved sections as they are, even none', () => {
    expect(resolveHub({ sections: [] }).sections).toEqual([]);
  });
});

describe('checking', () => {
  it('needs a name, and keeps each text within its limit', () => {
    expect(reason(profile({ name: '' }))).toBe('the hub needs a name');
    expect(reason(profile({ tagline: 'x'.repeat(HUB_LIMITS.tagline + 1) }))).toBe('the tagline can be at most 160 characters');
    expect(reason(profile({ bio: 'x'.repeat(HUB_LIMITS.bio) }))).toBeNull();
  });

  it('takes an empty accent as the party orange, and refuses one white text cannot be read on', () => {
    expect(reason(profile({ accent: '' }))).toBeNull();
    expect(reason(profile({ accent: '#ff6900' }))).toMatch(/^white text on the accent needs 4.5:1 contrast; this colour gives 2.89:1/);
    expect(reason(profile({ accent: 'orange' }))).toBe('the accent is a colour as #rrggbb, or empty for the party orange');
    expect(reason(profile({ accent: '#1565c0' }))).toBeNull();
    expect(effectiveAccent({ accent: '#1565c0' })).toBe('#1565c0');
  });

  it('takes only an uploaded logo ID', () => {
    expect(reason(profile({ logo: 'a'.repeat(64) }))).toBeNull();
    expect(reason(profile({ logo: '../etc/passwd' }))).toBe('that logo is not one uploaded here');
  });

  it('needs a title and address for a link that is shown, and lets hidden ones wait', () => {
    expect(reason(hub({ sections: [section('a', [link('l', { url: '' })])] }))).toBe('l needs an address before it can be shown');
    expect(reason(hub({ sections: [section('a', [link('l', { title: '' })])] }))).toBe('a link in a needs a title before it can be shown');
    expect(reason(hub({ sections: [section('a', [link('l', { url: '', title: '', shown: false })])] }))).toBeNull();
  });

  it("takes a Discord invite only, and the live widget only with the server's ID", () => {
    expect(reason(discord({ invite: INVITE, guildId: GUILD, widget: true }))).toBeNull();
    expect(reason(discord({ invite: INVITE, widget: true }))).toBe("the live widget needs the Discord server's ID");
    expect(reason(discord({ invite: INVITE, guildId: '1234' }))).toMatch(/^a Discord server ID is 17 to 20 digits/);
    expect(reason(discord({ invite: 'https://evil.example/invite' }))).toBe('the Discord invite: use a Discord invite (https://discord.gg/…)');
  });

  it('gives each section and link an ID of its own', () => {
    expect(reason(hub({ sections: [section('a', []), section('a', [])] }))).toBe('each section needs an ID of its own');
    expect(reason(hub({ sections: [section('a', [link('l')]), section('b', [link('l')])] }))).toBe('each link needs an ID of its own');
    expect(reason(hub({ sections: [section('A B', [])] }))).toBe('each section needs an ID of its own');
  });

  it('limits the sections and their links', () => {
    expect(reason(hub({ sections: Array.from({ length: 13 }, (_, i) => section(`s${i}`, [])) }))).toBe('the hub can have at most 12 sections');
    expect(reason(hub({ sections: [section('a', Array.from({ length: 41 }, (_, i) => link(`l${i}`)))] }))).toBe('a can have at most 40 links');
  });
});

describe('addresses', () => {
  it('may be a page of this app, https or mailto', () => {
    expect(urlProblem('/ballot', 'link')).toBeNull();
    expect(urlProblem('https://www.facebook.com/USTranshumanistParty/', 'link')).toBeNull();
    expect(urlProblem('mailto:info@example.org', 'link')).toBeNull();
    expect(urlProblem('mailto:nobody', 'link')).toBe('a mailto: address needs an email address');
  });

  it('never run script, leave for another origin by //, or use http', () => {
    expect(urlProblem('javascript:alert(1)', 'link')).toBe('use an https:// address');
    expect(urlProblem('data:text/html,hi', 'link')).toBe('use an https:// address');
    expect(urlProblem('//evil.example', 'link')).toBe('use a page of this site (/ballot), an https:// address or mailto:');
    expect(urlProblem('http://example.org', 'link')).toBe('use the https:// address');
    expect(urlProblem('/ballot now', 'link')).toBe('an address cannot contain spaces');
  });

  it('are Discord invites for the Discord card', () => {
    expect(urlProblem('https://discord.com/invite/abc', 'discord')).toBeNull();
    expect(urlProblem('/ballot', 'discord')).toBe('use a Discord invite (https://discord.gg/…)');
  });
});

describe('what visitors see', () => {
  it('leaves out hidden sections, hidden or unfinished links, empty sections and the flags only the settings use', () => {
    const shown = publicHub(
      hub({
        sections: [
          section('a', [link('one', { featured: true }), link('two', { shown: false })]),
          section('b', [link('three')], { shown: false }),
          section('c', [link('four', { shown: false })]),
        ],
      }),
      7,
    );
    expect(shown.version).toBe(7);
    expect(shown.sections).toEqual([
      { id: 'a', title: 'a', links: [{ id: 'one', title: 'one', subtitle: '', url: 'https://example.org/one', icon: 'link', featured: true }] },
    ]);
  });

  it('puts networks in the icon row in their order, then other icons, even from a hidden section', () => {
    const shown = publicHub(
      hub({
        sections: [
          section('a', [link('site', { icon: 'website', iconRow: true }), link('yt', { icon: 'youtube', iconRow: true })]),
          section('b', [link('dc', { icon: 'discord', iconRow: true }), link('no', { icon: 'x' })], { shown: false }),
          section('c', [link('tg', { icon: 'telegram', iconRow: true, shown: false })]),
        ],
      }),
      1,
    );
    expect(shown.icons.map((i) => i.id)).toEqual(['dc', 'yt', 'site']);
    expect(shown.sections.map((s) => s.id)).toEqual(['a']);
  });

  it('shows the Discord card once it has an invite, live when switched on with a server ID', () => {
    expect(publicHub(discord({ invite: INVITE }), 1).discord).toEqual({ invite: INVITE, live: false });
    expect(publicHub(discord({ invite: INVITE, guildId: GUILD, widget: true }), 1).discord).toEqual({ invite: INVITE, live: true });
    expect(publicHub(discord({ guildId: GUILD, widget: true }), 1).discord).toBeNull();
  });
});

describe('initials', () => {
  it('are the first letters of the first two words', () => {
    expect(hubInitials('U.S. Transhumanist Party')).toBe('UT');
    expect(hubInitials('transhumanists')).toBe('T');
    expect(hubInitials('  ')).toBe('');
  });
});

describe('IDs', () => {
  it('are made of lower-case letters and digits', () => {
    const id = newHubId();
    expect(id).toMatch(/^[a-z0-9]{10}$/);
    expect(isHubId(id)).toBe(true);
    expect(isHubId('Bad ID')).toBe(false);
  });
});

describe('clicks', () => {
  it('count against the links visitors can see, as cards or icons, and the Discord button', () => {
    expect(clickTargets(publicHub(discord({ invite: INVITE }), 1))).toEqual([
      'discord',
      'link-x',
      'link-facebook',
      'link-linkedin',
      'link-vote',
      'link-register',
      'link-website',
    ]);
  });

  it('are summed over the last 30 days, today included, beside the total', () => {
    const record = { total: 12, days: { '2026-09-27': 5, '2026-09-28': 3, '2026-10-27': 4 } };
    expect(clickCount('link-vote', record, '2026-10-27')).toEqual({ target: 'link-vote', total: 12, recent: 7, since: '2026-09-27' });
    expect(clickCount('link-vote', undefined, '2026-10-27')).toEqual({ target: 'link-vote', total: 0, recent: 0, since: null });
  });

  it('are kept per UTC day', () => {
    expect(clickDay(new Date('2026-10-27T23:30:00-05:00'))).toBe('2026-10-28');
  });
});

describe('changes', () => {
  it('list each profile and Discord field that changed', () => {
    const after = hub({
      profile: { ...DEFAULT_HUB.profile, tagline: 'Science first', theme: 'device' },
      discord: { invite: INVITE, guildId: '', widget: false },
    });
    expect(hubChanges(DEFAULT_HUB, after)).toEqual([
      { part: 'profile', field: 'tagline', to: 'Science first' },
      { part: 'profile', field: 'theme', to: 'device' },
      { part: 'discord', field: 'invite', to: INVITE },
    ]);
  });

  it('list sections and links added, removed, edited, moved, shown, hidden, starred and reordered', () => {
    const before = hub({ sections: [section('a', [link('one'), link('two')]), section('b', [link('three')])] });
    const after = hub({
      sections: [
        section('b', [link('three', { shown: false, featured: true }), link('two', { iconRow: true })], { title: 'Bee' }),
        section('c', [link('four')]),
      ],
    });
    expect(hubChanges(before, after)).toEqual([
      { part: 'section', id: 'a', title: 'a', change: 'removed' },
      { part: 'section', id: 'b', title: 'Bee', change: 'renamed' },
      { part: 'section', id: 'c', title: 'c', change: 'added' },
      { part: 'link', id: 'one', title: 'one', section: 'a', change: 'removed' },
      { part: 'link', id: 'three', title: 'three', section: 'b', change: 'hidden' },
      { part: 'link', id: 'three', title: 'three', section: 'b', change: 'starred' },
      { part: 'link', id: 'two', title: 'two', section: 'b', change: 'moved' },
      { part: 'link', id: 'two', title: 'two', section: 'b', change: 'into_icon_row' },
      { part: 'link', id: 'four', title: 'four', section: 'c', change: 'added' },
    ]);
    const swapped = hub({ sections: [section('b', [link('three')]), section('a', [link('two'), link('one', { url: '/verify' })])] });
    expect(hubChanges(before, swapped)).toEqual([
      { part: 'section_order', to: ['b', 'a'] },
      { part: 'link', id: 'one', title: 'one', section: 'a', change: 'edited', fields: ['url'] },
      { part: 'link_order', section: 'a', to: ['two', 'one'] },
    ]);
  });

  it('are none between a hub and itself', () => {
    expect(hubChanges(DEFAULT_HUB, resolveHub(DEFAULT_HUB))).toEqual([]);
  });
});

describe('the input', () => {
  it('takes the whole hub and the version it was edited from', () => {
    expect(hubSchema.safeParse({ basedOn: 0, ...DEFAULT_HUB }).success).toBe(true);
    expect(hubSchema.safeParse({ ...DEFAULT_HUB }).success).toBe(false);
    expect(hubSchema.safeParse({ basedOn: 0, ...DEFAULT_HUB, extra: 1 }).success).toBe(false);
    const sections = [{ ...DEFAULT_HUB.sections[0]!, links: [{ ...DEFAULT_HUB.sections[0]!.links[0]!, icon: 'myspace' }] }];
    expect(hubSchema.safeParse({ basedOn: 0, ...DEFAULT_HUB, sections }).success).toBe(false);
  });
});
