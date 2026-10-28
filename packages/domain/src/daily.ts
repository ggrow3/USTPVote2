import { z } from 'zod';

/**
 * The daily quote and joke (design §4.1): a transhumanist or humanist quote and a light joke, the same for everyone on
 * a given day, shown only to people who turn it on in their account. Off until they do.
 */

export interface DailyQuote {
  readonly text: string;
  readonly author: string;
  /** Where it was written or said, so a reader can look it up. */
  readonly source: string;
}

export interface DailyJoke {
  readonly setup: string;
  readonly punchline: string;
}

/** 21 quotes: coprime with the 22 jokes, so a quote and a joke pair up again only every 462 days. */
export const DAILY_QUOTES: readonly DailyQuote[] = [
  {
    text: 'The human species can, if it wishes, transcend itself — not just sporadically, an individual here in one way, an individual there in another way, but in its entirety, as humanity.',
    author: 'Julian Huxley',
    source: '“Transhumanism”, in New Bottles for New Wine (1957)',
  },
  {
    text: 'Transhumanists view human nature as a work-in-progress, a half-baked beginning that we can learn to remold in desirable ways.',
    author: 'Nick Bostrom',
    source: '“Transhumanist Values” (2005)',
  },
  {
    text: 'Nature has set no term to the perfection of human faculties; the perfectibility of man is truly indefinite.',
    author: 'Nicolas de Condorcet',
    source: 'Sketch for a Historical Picture of the Progress of the Human Mind (1795)',
  },
  { text: 'Human knowledge and human power meet in one.', author: 'Francis Bacon', source: 'Novum Organum (1620)' },
  { text: 'I am human, and I think nothing human is alien to me.', author: 'Terence', source: 'The Self-Tormentor (163 BCE)' },
  { text: 'We are a way for the cosmos to know itself.', author: 'Carl Sagan', source: 'Cosmos (1980)' },
  {
    text: 'Any sufficiently advanced technology is indistinguishable from magic.',
    author: 'Arthur C. Clarke',
    source: 'Profiles of the Future (1973 edition)',
  },
  {
    text: 'The saddest aspect of life right now is that science gathers knowledge faster than society gathers wisdom.',
    author: 'Isaac Asimov',
    source: 'Isaac Asimov’s Book of Science and Nature Quotations (1988)',
  },
  {
    text: 'If I have seen further it is by standing on the shoulders of Giants.',
    author: 'Isaac Newton',
    source: 'letter to Robert Hooke (1675)',
  },
  { text: 'The good life is one inspired by love and guided by knowledge.', author: 'Bertrand Russell', source: 'What I Believe (1925)' },
  {
    text: 'Happiness is the only good. The place to be happy is here. The time to be happy is now. The way to be happy is to make others so.',
    author: 'Robert G. Ingersoll',
    source: 'his creed, from his lectures (1880s)',
  },
  { text: 'My country is the world, and my religion is to do good.', author: 'Thomas Paine', source: 'Rights of Man, Part 2 (1792)' },
  {
    text: 'For a successful technology, reality must take precedence over public relations, for nature cannot be fooled.',
    author: 'Richard Feynman',
    source: 'appendix to the Rogers Commission report (1986)',
  },
  {
    text: 'The chemical or physical inventor is always a Prometheus.',
    author: 'J. B. S. Haldane',
    source: 'Daedalus, or Science and the Future (1924)',
  },
  { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay', source: 'at Xerox PARC (1971)' },
  {
    text: 'The real problem of humanity is the following: we have Paleolithic emotions, medieval institutions, and god-like technology.',
    author: 'E. O. Wilson',
    source: 'debate at Harvard (2009)',
  },
  { text: 'Man is the measure of all things.', author: 'Protagoras', source: 'as quoted in Plato’s Theaetetus' },
  { text: 'Look again at that dot. That’s here. That’s home. That’s us.', author: 'Carl Sagan', source: 'Pale Blue Dot (1994)' },
  {
    text: 'Science is not only compatible with spirituality; it is a profound source of spirituality.',
    author: 'Carl Sagan',
    source: 'The Demon-Haunted World (1995)',
  },
  {
    text: 'Equipped with his five senses, man explores the universe around him and calls the adventure Science.',
    author: 'Edwin Hubble',
    source: 'The Nature of Science (1954)',
  },
  {
    text: 'Education is the most powerful weapon which you can use to change the world.',
    author: 'Nelson Mandela',
    source: 'speech at the launch of the Mindset Network (2003)',
  },
];

/** 22 jokes, written for USTP Vote: gentle, about science and the future, never about people or politics. */
export const DAILY_JOKES: readonly DailyJoke[] = [
  { setup: 'Why don’t longevity researchers tell short jokes?', punchline: 'They’re in it for the long run.' },
  { setup: 'How many futurists does it take to change a light bulb?', punchline: 'None. They’re waiting for one that changes itself.' },
  { setup: 'I asked my cryonics provider about their cancellation policy.', punchline: 'They said they’d get back to me in a century or two.' },
  { setup: 'Why does a telomere avoid arguments?', punchline: 'It doesn’t want to get any shorter.' },
  { setup: 'What did the DNA say to the gene editor?', punchline: '“Go ahead, but please edit for clarity.”' },
  { setup: 'Why did the AI go back to school?', punchline: 'To work on its learning rate.' },
  { setup: 'Knock, knock. Who’s there? Moore. Moore who?', punchline: 'Moore transistors next year!' },
  { setup: 'My grandmother said I’d never live to 150.', punchline: 'I told her, “Not with that attitude.”' },
  { setup: 'I told my robot vacuum about the singularity.', punchline: 'It’s been going in circles ever since.' },
  { setup: 'Why did the cyborg get a library card?', punchline: 'To expand its memory the old-fashioned way.' },
  { setup: 'My exoskeleton and I get along great.', punchline: 'We really support each other.' },
  { setup: 'Why did the nanobot get promoted?', punchline: 'It did great work on a very small budget.' },
  { setup: 'The future called.', punchline: 'It’s running a little late, but it’s bringing better batteries.' },
  { setup: 'I’m not procrastinating.', punchline: 'I’m waiting for life extension, so I’ll have time to do it properly.' },
  { setup: 'Why did the brain–computer interface leave the keyboard?', punchline: 'It wanted a more direct connection.' },
  { setup: 'What did the stem cell say about its career plans?', punchline: '“I’m keeping my options open.”' },
  { setup: 'Why did the solar panel get top marks?', punchline: 'It always absorbed the material.' },
  { setup: 'Why don’t robots panic?', punchline: 'They have nerves of steel.' },
  { setup: 'Why did the scientist put a knocker on the lab door?', punchline: 'To win the No-bell Prize.' },
  { setup: 'Why are mitochondria so popular at parties?', punchline: 'They know how to power a room.' },
  { setup: 'How does a humanist fix a broken lab?', punchline: 'With reason, evidence and a lot of duct tape.' },
  { setup: 'What’s a robot’s favourite kind of music?', punchline: 'Heavy metal, played on repeat.' },
];

/** The day's number in the reader's own calendar (days since 1 January 1970), so it turns over at their midnight. */
export function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** The quote and joke for a day: everyone sees the same pair on the same date. */
export function dailyPick(date: Date): { readonly quote: DailyQuote; readonly joke: DailyJoke } {
  const day = dayNumber(date);
  return { quote: DAILY_QUOTES[day % DAILY_QUOTES.length]!, joke: DAILY_JOKES[day % DAILY_JOKES.length]! };
}

/** An account's own display choices (`accounts/{accountId}.preferences`). Not ledgered: they decide nothing. */
export interface AccountPreferences {
  /** Show the daily quote and joke. Off until the person turns it on. */
  readonly dailyQuote: boolean;
}

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = { dailyQuote: false };

/** `PUT /v1/me/preferences` */
export const accountPreferencesSchema = z.object({ dailyQuote: z.boolean() }).strict();
export type AccountPreferencesInput = z.infer<typeof accountPreferencesSchema>;

/** The stored choices with defaults for any not yet made (accounts made before preferences have none). */
export function preferencesOf(account: { readonly preferences?: Partial<AccountPreferences> } | null | undefined): AccountPreferences {
  return { ...DEFAULT_ACCOUNT_PREFERENCES, ...account?.preferences };
}
