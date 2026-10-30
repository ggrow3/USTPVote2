import { searchWords, type RoomModelKind } from 'ustp-domain';
import { idToken } from '../infra/google-identity.js';

/**
 * The members' room's model (design §5.10): it embeds text for the assistant's search and answers questions from the
 * sources the search found. Self-hosted (Ollama on the project's own GPU, spec rule 3), the emulator-only stand-in, or
 * none. Nothing from the room ever goes to an AI company.
 */
export interface RoomModel {
  readonly kind: RoomModelKind;
  /** Which embedding model makes the vectors, stored with each so vectors of different models are never compared. */
  readonly embedder: string;
  /**
   * One vector per text. A question is embedded as a query, messages and memory as documents. `until` (epoch ms) is
   * when the run must have its answer, so a slow call gives up in time to say so.
   */
  embed(texts: readonly string[], as: 'query' | 'document', until?: number): Promise<number[][]>;
  /** The answer to `question` from `sources`, citing them as `[n]` (1-based). */
  answer(question: AskQuestion, sources: readonly AskSource[], until?: number): Promise<string>;
}

export const ROOM_MODEL = Symbol('RoomModel');

export interface AskQuestion {
  readonly text: string;
  /** Who asked, by name. */
  readonly by: string;
  /** Today, YYYY-MM-DD, so "this week" means something. */
  readonly today: string;
}

/** A numbered source as the model sees it. */
export interface AskSource {
  readonly kind: 'message' | 'decision' | 'action';
  readonly at: string;
  /** For a message, who posted it; for an action item, its owner. */
  readonly who: string | null;
  readonly text: string;
  /** For an action item: its due date and whether it is done. */
  readonly detail: string | null;
}

/** Vectors are this long (EmbeddingGemma's full size; the stand-in matches it). */
export const ROOM_VECTOR_DIMENSION = 768;

/** How much of each source the prompt holds, so 40 of them stay well inside the model's 16K-token context. */
const SOURCE_CHARS = 800;

/**
 * What the model is told (spec rule 6): answer only from the numbered sources and cite them, say when they do not
 * answer, mark uncertainty, keep to the group's work, never characterize what a member thinks, no small talk.
 */
export const ASK_SYSTEM_PROMPT = [
  'You are the assistant in the members’ room of the United States Transhumanist Party: a tool for the group’s internal',
  'work, not a companion and not a public voice.',
  'Answer the member’s question only from the numbered sources you are given: messages posted in the room, decisions the',
  'group logged, and action items. Cite every source you use with its number in square brackets, like [3], right after',
  'the statement it supports. Never cite a number you were not given.',
  'If the sources do not answer the question, say so plainly in one sentence; do not guess and do not fill gaps from',
  'outside knowledge. Mark anything uncertain or disputed in the sources as uncertain.',
  'Describe decisions as the group’s. Never describe, guess or summarize what any member personally thinks, believes or',
  'supports politically; name people only as the owners of action items, or as who said something when the question asks',
  'who.',
  'Keep it short: a few sentences or a short list. No greetings, no small talk, no opinions of your own.',
].join(' ');

/** The user turn: the numbered sources, then the question. */
export function askPrompt(question: AskQuestion, sources: readonly AskSource[]): string {
  const lines = sources.map((s, i) => {
    const head = [s.kind, s.at.slice(0, 10), s.who && (s.kind === 'action' ? `owner ${s.who}` : s.who), s.detail].filter(Boolean).join(', ');
    const text = s.text.length > SOURCE_CHARS ? `${s.text.slice(0, SOURCE_CHARS)}…` : s.text;
    return `[${i + 1}] (${head}) ${text.replace(/\s+/g, ' ')}`;
  });
  return [
    `Today is ${question.today}.`,
    '',
    'Sources:',
    ...(lines.length ? lines : ['(none: the room has nothing on this yet)']),
    '',
    `Question from ${question.by}: ${question.text}`,
  ].join('\n');
}

/** No model on this deployment: the room works, the assistant does not. */
export class NoRoomModel implements RoomModel {
  readonly kind = 'off' as const;
  readonly embedder = 'none';

  embed(): Promise<number[][]> {
    return Promise.reject(new Error('the room has no model on this deployment'));
  }

  answer(): Promise<string> {
    return Promise.reject(new Error('the room has no model on this deployment'));
  }
}

/**
 * The emulator-only stand-in: word vectors hashed into `ROOM_VECTOR_DIMENSION` buckets, and answers that quote the
 * sources sharing the most words with the question, cited, or say the room's memory does not say. Deterministic, so
 * tests can expect what it answers.
 */
export class LocalRoomModel implements RoomModel {
  readonly kind = 'stand-in' as const;
  readonly embedder = 'stand-in';

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(ROOM_VECTOR_DIMENSION).fill(0);
      const words = searchWords(text);
      for (const word of words) v[hash(word) % ROOM_VECTOR_DIMENSION]! += 1;
      // A text with no words gets a vector of its own rather than zeros, which cosine distance cannot compare.
      if (!words.length) v[0] = 1;
      const norm = Math.hypot(...v);
      return v.map((x) => x / norm);
    });
  }

  async answer(question: AskQuestion, sources: readonly AskSource[]): Promise<string> {
    const words = searchWords(question.text);
    const scored = sources
      .map((s, i) => ({ i, score: searchWords(s.text).filter((w) => words.includes(w)).length }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, 3);
    if (!scored.length) return 'The room’s memory does not say.';
    return `From the room’s memory: ${scored.map(({ i }) => `“${sources[i]!.text.slice(0, 200)}” [${i + 1}]`).join('; ')}.`;
  }
}

function hash(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The self-hosted model: an Ollama server's OpenAI-compatible API, at the private `room-model` Cloud Run service (called
 * with the account's ID token) or, for a developer, a local one over http. The first call after the service scaled to
 * zero waits while it starts and loads the models, a minute or two, so calls may take up to `timeoutMs`.
 */
export class OllamaRoomModel implements RoomModel {
  readonly kind = 'self-hosted' as const;

  get embedder(): string {
    return this.embedModel;
  }

  constructor(
    private readonly url: string,
    private readonly chatModel: string,
    private readonly embedModel: string,
    private readonly timeoutMs = 270_000,
  ) {}

  async embed(texts: readonly string[], as: 'query' | 'document', until?: number): Promise<number[][]> {
    // EmbeddingGemma's task prompts: queries and the documents they should find are embedded differently.
    const input = texts.map((t) => (as === 'query' ? `task: search result | query: ${t}` : `title: none | text: ${t}`));
    const body = (await this.post('/v1/embeddings', { model: this.embedModel, input }, until)) as { data?: { index: number; embedding: number[] }[] };
    if (!Array.isArray(body.data)) throw new Error('the model’s vectors could not be read');
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== texts.length) throw new Error(`the model returned ${vectors.length} vectors for ${texts.length} texts`);
    return vectors;
  }

  async answer(question: AskQuestion, sources: readonly AskSource[], until?: number): Promise<string> {
    const body = (await this.post('/v1/chat/completions', {
      model: this.chatModel,
      stream: false,
      temperature: 0.2,
      max_tokens: 800,
      messages: [
        { role: 'system', content: ASK_SYSTEM_PROMPT },
        { role: 'user', content: askPrompt(question, sources) },
      ],
    }, until)) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('the model gave no answer');
    return content;
  }

  private async post(path: string, payload: unknown, until?: number): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.url.startsWith('https://')) headers.authorization = `Bearer ${await idToken(this.url)}`;
    const timeout = Math.max(1000, Math.min(this.timeoutMs, (until ?? Infinity) - Date.now()));
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      throw new Error(e instanceof Error && e.name === 'TimeoutError' ? 'the model took too long to start or answer' : 'the model could not be reached');
    }
    // Never the body, in an error or a log: the model's server could echo what it was sent.
    if (!res.ok) throw new Error(`the model answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new Error('the model’s answer could not be read');
    }
  }
}
