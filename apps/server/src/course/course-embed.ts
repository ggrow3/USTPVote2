import { createHash } from 'node:crypto';
import type { Embed } from 'ustp-domain';

/**
 * The course embed's page (design §10.17, "The course embed"): one small HTML file with its data, one script and one
 * style, which the Partners page offers allied groups to frame on their own sites. It is no part of the web app: no
 * sign-in, no app code, nothing it reads but the published course it shows, given here in the page. Everything is
 * built as text nodes, never as markup, and its Content-Security-Policy runs only this script and loads only this
 * site's videos, the course's portraits (here, or open-licence images elsewhere, as its own page shows them), and
 * YouTube's privacy-enhanced player once a viewer presses play.
 */

const STYLE = `
:root { --ink: #1b2430; --muted: #5b6676; --line: #d9dee5; --page: #f6f7f9; --card: #fff; --accent: #0b4f8a; --good: #1f7a3d; --bad: #a3271f; color-scheme: light dark; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #e8ecf1; --muted: #a3adbb; --line: #333c48; --page: #12161c; --card: #1a2029; --accent: #7fb4ea; --good: #6cc68a; --bad: #f08a80; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.4rem; margin: 0 0 4px; }
h2 { font-size: 1.15rem; margin: 24px 0 8px; }
h3 { font-size: 1.05rem; margin: 12px 0 4px; }
a { color: var(--accent); }
a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
p { margin: 8px 0; }
.muted { color: var(--muted); font-size: 0.9rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 12px 0; }
details.card > summary { cursor: pointer; font-weight: 600; }
.list { list-style: none; padding: 0; margin: 0; }
.badge { display: inline-block; font-size: 0.8rem; border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; margin-left: 6px; }
fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 10px 0; padding: 8px 12px; }
legend { font-weight: 600; padding: 0 4px; }
label { display: block; margin: 4px 0; }
.right { color: var(--good); }
.wrong { color: var(--bad); }
.player { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.player iframe, .player video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.profiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.profiles img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: var(--line); }
figure { margin: 0; }
figcaption { font-size: 0.8rem; color: var(--muted); }
blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid var(--line); }
button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--card); cursor: pointer; }
.player button { font-size: 1.05rem; padding: 10px 18px; }
footer { margin: 24px 0 8px; }
`.trim();

const SCRIPT = `
'use strict';
(function () {
  var data = JSON.parse(document.getElementById('embed-data').textContent);
  var main = document.getElementById('main');
  if (!data) return;

  /** An element with its attributes and children; text is always set as text, never as markup. */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value !== null && value !== undefined && value !== false) el.setAttribute(key, value === true ? '' : String(value));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else el.append(child);
  }
  /** Puts these in the element, in place of what was there. */
  function fill(el) {
    el.replaceChildren();
    for (var i = 1; i < arguments.length; i++) append(el, arguments[i]);
  }
  /** A link out of the frame, to the course site or a source. */
  function out(href, text) {
    return href ? h('a', { href: href, target: '_blank', rel: 'noopener noreferrer' }, text) : null;
  }
  var host = new URL(data.site.origin).host;

  function video(v, title) {
    if (!v) return null;
    if (v.kind === 'upload') return h('div', { class: 'player' }, h('video', { controls: true, preload: 'none', src: v.src, title: title }));
    var play = h('button', { type: 'button', 'aria-label': 'Play the video: ' + title }, '\\u25B6 Play the video');
    var box = h('div', { class: 'player' }, play);
    play.addEventListener('click', function () {
      box.replaceChildren(h('iframe', {
        src: v.embedSrc,
        title: title,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    });
    return h('div', {}, box, h('p', { class: 'muted' }, 'It plays from YouTube once you press play. ', out(v.watchUrl, 'Watch on YouTube')));
  }

  function quiz(lesson, n) {
    if (!lesson.questions.length) return null;
    var result = h('p', { role: 'status', 'aria-live': 'polite' });
    var items = lesson.questions.map(function (q, k) {
      var feedback = h('p', { class: 'muted' });
      var box = h('fieldset', {},
        h('legend', {}, (k + 1) + '. ' + q.prompt),
        q.choices.map(function (choice, i) {
          return h('label', {}, h('input', { type: 'radio', name: 'l' + n + 'q' + k, value: String(i) }), ' ', choice);
        }),
        feedback);
      return { q: q, box: box, feedback: feedback };
    });
    var form = h('form', { novalidate: true }, items.map(function (x) { return x.box; }), h('button', { type: 'submit' }, 'Check my answers'), result);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var right = 0;
      items.forEach(function (x) {
        var picked = x.box.querySelector('input:checked');
        var correct = picked !== null && Number(picked.value) === x.q.correctIndex;
        if (correct) right++;
        x.feedback.className = correct ? 'right' : 'wrong';
        x.feedback.textContent = (correct ? 'Right. ' : picked ? 'Not quite. ' : 'No answer. ') + x.q.explanation;
      });
      var score = Math.round((100 * right) / items.length);
      fill(result,
        right + ' of ' + items.length + ' right (' + score + '%): ' + (score >= data.passPercent ? 'passed. ' : data.passPercent + '% passes. '),
        out(data.pageUrl, 'Take it on ' + host + ' for a certificate'));
    });
    return h('div', {}, h('h3', {}, 'Quiz'), form);
  }

  function profile(p) {
    var portrait = p.portrait;
    var figure = portrait && (portrait.src
      ? h('figure', {}, h('img', { src: portrait.src, alt: portrait.alt, loading: 'lazy' }), h('figcaption', {}, portrait.credit, portrait.link ? ' \\u00B7 ' : '', out(portrait.link, 'Source')))
      : h('p', { class: 'muted' }, out(portrait.link, 'Portrait'), portrait.credit ? ' \\u00B7 ' + portrait.credit : ''));
    return h('article', { class: 'card' },
      figure,
      h('h3', {}, p.name),
      h('p', {}, p.biography),
      p.ideas.length ? h('ul', {}, p.ideas.map(function (idea) { return h('li', {}, idea); })) : null,
      p.quote ? h('blockquote', {}, p.quote, ' ', p.quoteUrl ? out(p.quoteUrl, p.quoteSource || 'Source') : p.quoteSource) : null,
      out(p.furtherReadingUrl, 'Further reading'));
  }

  function showCourse() {
    var c = data.course;
    document.title = c.title + ' \\u00B7 ' + data.site.name;
    fill(main,
      h('p', { class: 'muted' }, h('a', { href: data.listPath }, '\\u2190 All courses')),
      h('h1', {}, c.title),
      h('p', {}, c.summary),
      h('p', { class: 'muted' }, 'A free course from ' + data.site.name + '. ', out(data.pageUrl, 'Take it on ' + host + ' for a certificate')),
      data.lessons.map(function (lesson, n) {
        return h('details', { class: 'card', open: n === 0 },
          h('summary', {}, 'Lesson ' + (n + 1) + ': ' + lesson.title, h('span', { class: 'badge' }, lesson.minutes + ' min')),
          lesson.summary ? h('p', { class: 'muted' }, lesson.summary) : null,
          video(lesson.video, lesson.title),
          lesson.paragraphs.map(function (p) { return h('p', {}, p); }),
          quiz(lesson, n));
      }),
      data.profiles.length ? h('h2', {}, 'Futurists') : null,
      data.profiles.length ? h('div', { class: 'profiles' }, data.profiles.map(profile)) : null,
      h('footer', { class: 'muted' }, 'Version ' + c.version + ', published ' + c.publishedAt.slice(0, 10) + '. Portraits keep their credits and licences. ', out(data.pageUrl, 'Open on ' + host)));
  }

  function showList() {
    document.title = 'Courses \\u00B7 ' + data.site.name;
    fill(main,
      h('h1', {}, 'Courses from ' + data.site.name),
      h('p', { class: 'muted' }, 'Free lessons with quizzes. Certificates are earned on ' + host + '.'),
      data.courses.length
        ? h('ul', { class: 'list' }, data.courses.map(function (c) {
            return h('li', { class: 'card' },
              h('a', { href: c.embedPath }, c.title),
              h('span', { class: 'badge' }, c.lessonCount + (c.lessonCount === 1 ? ' lesson' : ' lessons')),
              c.summary ? h('p', {}, c.summary) : null);
          }))
        : h('p', {}, 'No courses are published yet.'),
      h('footer', { class: 'muted' }, out(data.pageUrl, 'All courses on ' + host)));
  }

  if (data.view === 'course') showCourse();
  else showList();
})();
`.trim();

const hash = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/**
 * The embed's policy: this script and style only; this site's videos and https images; YouTube's privacy-enhanced player;
 * no forms sent anywhere; and any site may frame it, which is what it is for.
 */
export const EMBED_CSP = [
  "default-src 'none'",
  `script-src ${hash(SCRIPT)}`,
  `style-src ${hash(STYLE)}`,
  "img-src 'self' https:",
  "media-src 'self'",
  'frame-src https://www.youtube-nocookie.com',
  "base-uri 'none'",
  "form-action 'none'",
  'frame-ancestors *',
].join('; ');

/** The headers the embed is served with: the site's own, but framing allowed, and kept briefly by caches. */
export const EMBED_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': EMBED_CSP,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'public, max-age=300',
};

const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const html = (text: string) => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

const UNSAFE_IN_SCRIPT = new RegExp(`[<${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/**
 * JSON safe inside a `<script type="application/json">`: no `<` (so no `</script>` or `<!--`), and the two line
 * separators written as escapes.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE_IN_SCRIPT, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The page: its data, or, for no such course, a line saying so and where the site's courses are. */
export function embedPage(embed: Embed | null, missing?: { readonly siteName: string; readonly coursesUrl: string }): string {
  const title = embed ? (embed.view === 'course' ? `${embed.course.title} · ${embed.site.name}` : `Courses · ${embed.site.name}`) : 'Course not found';
  const fallback = embed
    ? '<p class="muted">Loading…</p>'
    : `<h1>Course not found</h1><p>There is no published course at this address.${
        missing ? ` <a href="${html(missing.coursesUrl)}" target="_blank" rel="noopener noreferrer">See the courses of ${html(missing.siteName)}</a>.` : ''
      }</p>`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${html(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    `<main id="main">${fallback}</main>`,
    `<script type="application/json" id="embed-data">${scriptJson(embed)}</script>`,
    `<script>${SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
