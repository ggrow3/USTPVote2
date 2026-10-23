import type { Firestore } from 'firebase-admin/firestore';
import { sha256Hex } from 'ustp-audit';
import { Collections, type BylawsCheckReference, type BylawsCheckReferenceId } from 'ustp-domain';
import { US_CONSTITUTION_SHA256, US_CONSTITUTION_TEXT } from './us-constitution.js';

/** A reference with the text the check sends. */
export interface ReferenceText extends BylawsCheckReference {
  readonly text: string;
}

/** `bylaws_check_references/{id}`: the last copy read from the party's site. */
interface CachedReference extends ReferenceText {
  readonly retrievedAt: string;
}

const US_CONSTITUTION: ReferenceText = {
  id: 'us-constitution',
  title: 'The Constitution of the United States, with Amendments I-XXVII',
  url: 'https://www.archives.gov/founding-docs/constitution-transcript',
  retrievedAt: '2026-10-22T00:00:00.000Z',
  modifiedAt: null,
  sha256: US_CONSTITUTION_SHA256,
  text: US_CONSTITUTION_TEXT,
};

/**
 * The party's own texts, read from transhumanist-party.org at check time rather than copied into this repository: the
 * party amends them (the constitution last in March 2025), and the site marks them "All Rights Reserved". Each is a
 * WordPress page, read through the site's REST API, which returns the page body without the theme around it.
 */
export const PARTY_REFERENCES: readonly { id: BylawsCheckReferenceId; title: string; url: string; slug: string }[] = [
  {
    id: 'ustp-constitution',
    title: 'Constitution of the United States Transhumanist Party',
    url: 'https://transhumanist-party.org/constitution/',
    slug: 'constitution',
  },
  {
    id: 'transhumanist-bill-of-rights',
    title: 'Transhumanist Bill of Rights, Version 3.0',
    url: 'https://transhumanist-party.org/tbr-3/',
    slug: 'tbr-3',
  },
];

const PARTY_SITE_API = 'https://transhumanist-party.org/wp-json/wp/v2/pages';
/** A copy younger than this is used without asking the site again. */
export const REFERENCE_MAX_AGE_HOURS = 24;
/** Less text than this means the page came back empty or as something else (a challenge page, an error). */
const MIN_REFERENCE_LENGTH = 5_000;
const FETCH_TIMEOUT_MS = 20_000;

/**
 * The three references: the US Constitution from the snapshot in this repository, the party's pages from the cache
 * when fresh, else from the site (falling back to an older cached copy if the site cannot be read).
 */
export class ReferenceLibrary {
  constructor(
    private readonly db: Firestore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<ReferenceText[]> {
    return [US_CONSTITUTION, ...(await Promise.all(PARTY_REFERENCES.map((r) => this.party(r))))];
  }

  /** What the references are, without reading them (the stand-in's record). */
  static unread(): BylawsCheckReference[] {
    const { text: _, ...us } = US_CONSTITUTION;
    return [us, ...PARTY_REFERENCES.map(({ id, title, url }) => ({ id, title, url, retrievedAt: null, modifiedAt: null, sha256: null }))];
  }

  private async party(ref: (typeof PARTY_REFERENCES)[number]): Promise<ReferenceText> {
    const doc = this.db.collection(Collections.bylawsCheckReferences).doc(ref.id);
    const cached = (await doc.get()).data() as CachedReference | undefined;
    const ageMs = cached ? this.now().getTime() - Date.parse(cached.retrievedAt) : Infinity;
    if (cached && ageMs < REFERENCE_MAX_AGE_HOURS * 3_600_000) return cached;
    try {
      const fresh = await this.fetchPage(ref);
      await doc.set(fresh);
      return fresh;
    } catch (e) {
      if (cached) return cached;
      throw new Error(`could not read the ${ref.title} from ${ref.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async fetchPage(ref: (typeof PARTY_REFERENCES)[number]): Promise<CachedReference> {
    const url = `${PARTY_SITE_API}?slug=${encodeURIComponent(ref.slug)}&_fields=link,modified_gmt,content`;
    const res = await this.fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'USTPVote2 bylaws check' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pages = (await res.json()) as { link?: string; modified_gmt?: string; content?: { rendered?: string } }[];
    const page = Array.isArray(pages) ? pages[0] : undefined;
    const text = htmlToText(page?.content?.rendered ?? '');
    if (text.length < MIN_REFERENCE_LENGTH) throw new Error(`the page has ${text.length} characters of text, expected more`);
    return {
      id: ref.id,
      title: ref.title,
      url: ref.url,
      retrievedAt: this.now().toISOString(),
      modifiedAt: page?.modified_gmt ? new Date(`${page.modified_gmt}Z`).toISOString() : null,
      sha256: sha256Hex(text),
      text,
    };
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  sect: '§',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * Plain text from a page body (WordPress content): one paragraph, heading or list item per line, blank lines between
 * blocks, list items marked "-" or numbered as the list numbers them (`<ol start>` included), inline markup dropped.
 */
export function htmlToText(html: string): string {
  const lists: { ordered: boolean; next: number }[] = [];
  let out = '';
  const breakLine = (blank: boolean) => {
    out = out.replace(/[ \t]+$/, '');
    if (!out) return;
    out += blank ? (out.endsWith('\n\n') ? '' : out.endsWith('\n') ? '\n' : '\n\n') : out.endsWith('\n') ? '' : '\n';
  };
  const body = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const part of body.split(/(<[^>]*>)/)) {
    const tag = /^<(\/?)([a-z][a-z0-9]*)\b([^>]*)>$/i.exec(part);
    if (!tag) {
      if (!part.startsWith('<')) out += decodeEntities(part).replace(/\s+/g, ' ');
      continue;
    }
    const [, closing, rawName, attrs] = tag;
    const name = rawName!.toLowerCase();
    if (name === 'br') {
      breakLine(false);
    } else if (name === 'ol' || name === 'ul') {
      if (closing) lists.pop();
      else lists.push({ ordered: name === 'ol', next: Number(/\bstart="(\d+)"/i.exec(attrs ?? '')?.[1] ?? 1) });
      breakLine(true);
    } else if (name === 'li') {
      breakLine(false);
      if (!closing) {
        const list = lists.at(-1);
        out += `${list?.ordered ? `${list.next++}.` : '-'} `;
      }
    } else if (/^(p|div|h[1-6]|blockquote|section|article|table|tr|hr)$/.test(name)) {
      breakLine(true);
    }
  }
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
