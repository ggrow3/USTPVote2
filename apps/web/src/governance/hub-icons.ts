import {
  fabBluesky,
  fabDiscord,
  fabFacebook,
  fabInstagram,
  fabLinkedin,
  fabMastodon,
  fabRedditAlien,
  fabTelegram,
  fabThreads,
  fabTiktok,
  fabXTwitter,
  fabYoutube,
} from '@quasar/extras/fontawesome-v7';
import type { HubIcon, LinkSymbol, SocialNetwork } from 'ustp-domain';

/**
 * The hub's icons (design §10.6), as QIcon names. Networks are their marks from Font Awesome Free's brand set (icons
 * CC BY 4.0, Fonticons, Inc.), bundled with @quasar/extras as SVG paths, so only these twelve reach the build and no
 * icon font or third-party request is added; they take the text colour, so they stay monochrome. Symbols are Material
 * Icons, the font the app already loads.
 */
const NETWORK_ICONS: Readonly<Record<SocialNetwork, string>> = {
  discord: fabDiscord,
  x: fabXTwitter,
  reddit: fabRedditAlien,
  facebook: fabFacebook,
  telegram: fabTelegram,
  instagram: fabInstagram,
  youtube: fabYoutube,
  tiktok: fabTiktok,
  linkedin: fabLinkedin,
  threads: fabThreads,
  bluesky: fabBluesky,
  mastodon: fabMastodon,
};

const SYMBOL_ICONS: Readonly<Record<LinkSymbol, string>> = {
  vote: 'how_to_vote',
  register: 'person_add',
  events: 'event',
  donate: 'volunteer_activism',
  forum: 'forum',
  chat: 'chat',
  news: 'article',
  website: 'language',
  email: 'mail',
  video: 'smart_display',
  link: 'link',
};

export function hubIcon(icon: HubIcon): string {
  return (NETWORK_ICONS as Record<string, string>)[icon] ?? SYMBOL_ICONS[icon as LinkSymbol];
}
