import { absoluteUrl, choiceShare, percent, type PollCount, type PublicPoll, type Shareable } from 'ustp-domain';

/**
 * What the issue poll pages share (design §10.16): this browser's token, the answers it remembers, and what share
 * buttons and the card show.
 */

const TOKEN_KEY = 'ustp-poll-voter';
const ANSWERS_KEY = 'ustp-poll-answers';

/** Storage that may refuse (a private window, site data blocked): then nothing is kept past this page. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function localStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let unkept: string | null = null;

/** 22 random URL-safe characters (16 bytes). */
export function newVoterToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * This browser's poll token: made once and kept, so the api can tell this browser answered (one answer per browser)
 * and show it the results. It says nothing about who uses the browser, and the api keeps only a hash of it per poll.
 */
export function pollVoter(store: KeyValueStore | null = localStore()): string {
  try {
    const kept = store?.getItem(TOKEN_KEY);
    if (kept && /^[A-Za-z0-9_-]{16,64}$/.test(kept)) return kept;
    const made = newVoterToken();
    store?.setItem(TOKEN_KEY, made);
    if (store) return made;
  } catch {
    // Not kept: one token for as long as this page is open.
  }
  unkept ??= newVoterToken();
  return unkept;
}

function answers(store: KeyValueStore | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(ANSWERS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The choice this browser answered a poll with: kept only here, since the api counts an answer without keeping it. */
export function rememberedAnswer(pollId: string, store: KeyValueStore | null = localStore()): string | null {
  const choice = answers(store)[pollId];
  return typeof choice === 'string' ? choice : null;
}

export function rememberAnswer(pollId: string, choiceId: string, store: KeyValueStore | null = localStore()): void {
  try {
    store?.setItem(ANSWERS_KEY, JSON.stringify({ ...answers(store), [pollId]: choiceId }));
  } catch {
    // Not kept: the page still shows the results; only "you chose" is lost.
  }
}

/** A poll's page. */
export const pollPath = (pollId: string) => `/polls/${encodeURIComponent(pollId)}`;

/** What a poll's share buttons share: the question, and an invitation to answer or its result, and its page here. */
export function pollShareable(poll: Pick<PublicPoll, 'pollId' | 'question' | 'state' | 'hashtags' | 'choices' | 'results'>, origin = location.origin): Shareable {
  const url = absoluteUrl(pollPath(poll.pollId), origin);
  const lead = poll.state === 'closed' && poll.results ? leadText(poll.choices, poll.results.everyone) : null;
  const text = lead ? `${poll.question} ${lead}` : `${poll.question} Answer the poll and see what others think.`;
  return { text, url, hashtags: poll.hashtags, title: `Poll: ${poll.question}` };
}

/** "Most chose “Yes” (62%)." / "A tie: “Yes” and “No”." / null before anyone answered. */
export function leadText(choices: PublicPoll['choices'], count: PollCount): string | null {
  const top = Math.max(0, ...choices.map((c) => count.counts[c.choiceId] ?? 0));
  if (top === 0) return null;
  const leaders = choices.filter((c) => (count.counts[c.choiceId] ?? 0) === top);
  if (leaders.length > 1) return `A tie: ${leaders.map((c) => `“${c.label}”`).join(' and ')}.`;
  return `Most chose “${leaders[0]!.label}” (${percent(choiceShare(count, leaders[0]!.choiceId), 0)}).`;
}

/** "1 answer", "1,204 answers". */
export const answersText = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'answer' : 'answers'}`;
