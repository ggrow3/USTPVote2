/**
 * The body of a news post (design §10.7): plain text, never HTML. Blank lines separate blocks; a line starting `## ` is a
 * heading, lines starting `- ` (or `* `) a list, lines starting `> ` a quotation, anything else a paragraph whose line
 * breaks are kept. `https://` addresses become links. The web app and the news feeds both read it through these, so a
 * post looks the same everywhere and nothing a Communications Admin types can become markup.
 */

export type NewsBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

const HEADING = /^##\s+/;
const ITEM = /^[-*]\s+/;
const QUOTE = /^>\s?/;

/** The body's blocks, in order. */
export function newsBlocks(body: string): NewsBlock[] {
  const blocks: NewsBlock[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    if (quote.length) blocks.push({ kind: 'quote', text: quote.join('\n') });
    if (items.length) blocks.push({ kind: 'list', items });
    paragraph = [];
    quote = [];
    items = [];
  };
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (HEADING.test(line)) {
      flush();
      blocks.push({ kind: 'heading', text: line.replace(HEADING, '') });
    } else if (ITEM.test(line)) {
      if (!items.length) flush();
      items.push(line.replace(ITEM, ''));
    } else if (QUOTE.test(line)) {
      if (!quote.length) flush();
      quote.push(line.replace(QUOTE, ''));
    } else {
      if (!paragraph.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

export type TextSegment = { readonly text: string } | { readonly url: string };

/** An address up to the next space, without punctuation that more likely ends the sentence than the address. */
const URL_PATTERN = /https:\/\/[^\s<>"]+/g;
const TRAILING = /[.,;:!?)\]'’”]+$/;

/** A line of text split into plain text and `https://` links. */
export function textSegments(line: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let at = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING, '');
    const start = match.index;
    if (url.length <= 'https://'.length) continue;
    if (start > at) segments.push({ text: line.slice(at, start) });
    segments.push({ url });
    at = start + url.length;
  }
  if (at < line.length) segments.push({ text: line.slice(at) });
  return segments;
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function inlineHtml(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      textSegments(line)
        .map((s) => ('url' in s ? `<a href="${escapeHtml(s.url)}">${escapeHtml(s.url)}</a>` : escapeHtml(s.text)))
        .join(''),
    )
    .join('<br>');
}

/** The body as HTML for the news feeds: escaped text in `h2`, `p`, `blockquote` and `ul`, and links. */
export function newsHtml(body: string): string {
  return newsBlocks(body)
    .map((b) => {
      switch (b.kind) {
        case 'heading':
          return `<h2>${inlineHtml(b.text)}</h2>`;
        case 'paragraph':
          return `<p>${inlineHtml(b.text)}</p>`;
        case 'quote':
          return `<blockquote><p>${inlineHtml(b.text)}</p></blockquote>`;
        case 'list':
          return `<ul>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</ul>`;
      }
    })
    .join('\n');
}

/** The body as plain text: the blocks with their markers removed, a blank line between them. */
export function newsText(body: string): string {
  return newsBlocks(body)
    .map((b) => (b.kind === 'list' ? b.items.map((i) => `• ${i}`).join('\n') : b.text))
    .join('\n\n');
}
