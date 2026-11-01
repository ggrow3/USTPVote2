import { NETWORK_NAMES, RECENT_DAYS, type HubChange, type HubClickCount, type HubIcon, type HubTheme, type LinkSymbol } from 'ustp-domain';

/** Wording for the home page hub and its settings (design §10.6). */

const SYMBOL_LABELS: Readonly<Record<LinkSymbol, string>> = {
  vote: 'Voting',
  register: 'Membership',
  course: 'Course',
  events: 'Events',
  donate: 'Donations',
  forum: 'Discussion board',
  chat: 'Chat',
  news: 'News',
  website: 'Website',
  email: 'Email',
  video: 'Video',
  link: 'Link',
};

/** An icon's name in the settings' icon list. */
export function iconLabel(icon: HubIcon): string {
  return (NETWORK_NAMES as Record<string, string>)[icon] ?? SYMBOL_LABELS[icon as LinkSymbol];
}

export const THEME_LABELS: Readonly<Record<HubTheme, string>> = {
  dark: 'Dark',
  light: 'Light',
  device: "The device's setting",
};

/** "Live on Discord", with how many are online when Discord says. */
export function liveText(online: number | null): string {
  return online === null ? 'Live on Discord' : `Live on Discord · ${online.toLocaleString('en-US')} online`;
}

const number = (n: number) => n.toLocaleString('en-US');

/** "5 in the last 30 days, 12 in all": a link's clicks in words, for screen readers and the tooltip. */
export function clicksText(count: Pick<HubClickCount, 'total' | 'recent'> | undefined): string {
  const total = count?.total ?? 0;
  const recent = count?.recent ?? 0;
  return `${number(recent)} in the last ${RECENT_DAYS} days, ${number(total)} in all`;
}

const FIELD_NAMES = { title: 'title', subtitle: 'subtitle', url: 'address', video: 'video', icon: 'icon' } as const;

const and = (words: readonly string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? ''));

/**
 * One unsaved change in words: "Tagline: Science first", "Hide “Subreddit”", "Move “Chat” to Community". `sectionTitle`
 * names a section by its ID, from the hub as it will be saved.
 */
export function describeHubChange(change: HubChange, sectionTitle: (id: string) => string): string {
  switch (change.part) {
    case 'profile':
      switch (change.field) {
        case 'logo':
          return change.to ? 'A new logo' : 'Remove the logo: the initials show instead';
        case 'cover':
          return change.to ? 'A new cover banner' : 'Remove the cover banner';
        case 'background':
          return change.to ? 'A new background photo behind the pages' : 'Page background: the sunrise instead of the photo';
        case 'accent':
          return `Accent colour: ${change.to || 'the USTP orange'}`;
        case 'theme':
          return `Default theme: ${THEME_LABELS[change.to as HubTheme]}`;
        default: {
          const label = { name: 'Name', tagline: 'Tagline', bio: 'Bio' }[change.field];
          return change.to ? `${label}: ${change.to}` : `${label}: left empty`;
        }
      }
    case 'discord':
      if (change.field === 'widget') return `${change.to ? 'Show' : 'Hide'} the live member widget`;
      if (change.field === 'invite') return change.to ? `Discord invite: ${String(change.to)}` : 'Discord invite: removed, so no Discord card';
      return change.to ? `Discord server ID: ${String(change.to)}` : 'Discord server ID: removed';
    case 'section': {
      const title = change.title ? `“${change.title}”` : 'an untitled section';
      return {
        added: `New section ${title}`,
        removed: `Remove the section ${title}`,
        renamed: `Rename a section to ${title}`,
        shown: `Show the section ${title}`,
        hidden: `Hide the section ${title}`,
      }[change.change];
    }
    case 'section_order':
      return 'A new order for the sections';
    case 'link': {
      const title = change.title ? `“${change.title}”` : 'an untitled link';
      const section = sectionTitle(change.section) || 'an untitled section';
      switch (change.change) {
        case 'added':
          return `New link ${title} in ${section}`;
        case 'removed':
          return `Remove the link ${title}`;
        case 'moved':
          return `Move ${title} to ${section}`;
        case 'shown':
          return `Show ${title}`;
        case 'hidden':
          return `Hide ${title}`;
        case 'starred':
          return `Star ${title}`;
        case 'unstarred':
          return `Unstar ${title}`;
        case 'into_icon_row':
          return `Put ${title} in the icon row`;
        case 'out_of_icon_row':
          return `Take ${title} out of the icon row`;
        case 'edited':
          return `Change the ${and(change.fields.map((f) => FIELD_NAMES[f]))} of ${title}`;
      }
      break;
    }
    case 'link_order':
      return `A new order for the links in ${sectionTitle(change.section) || 'an untitled section'}`;
  }
}
