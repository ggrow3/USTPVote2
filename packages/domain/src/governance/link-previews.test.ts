import { describe, expect, it } from 'vitest';
import { cardAlt, clippedPreview, clipText, headWithPreview, matchPreviewPage, PREVIEW_PAGES, siteNameOf, type PreviewHead } from './link-previews.js';

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="description"
      content="The site's description."
    />
    <meta name="theme-color" content="#bd4e00" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="USTP &amp; Vote" />
    <meta property="og:title" content="USTP Vote · U.S. Transhumanist Party" />
    <meta property="og:image" content="https://site.example/icons/share-card.png" />
    <meta property="og:image:width" content="1200" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <title>USTP Vote</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;

const HEAD: PreviewHead = {
  documentTitle: 'Hello "world" · USTP Vote',
  title: 'Hello "world"',
  description: 'A <b>bold</b> & brave post',
  url: 'https://site.example/news/hello',
  siteName: 'USTP Vote',
  type: 'article',
  image: { url: 'https://site.example/v1/public/link-cards?path=%2Fnews%2Fhello&v=abc', alt: "News: Hello 'world'" },
  listed: true,
};

describe('matchPreviewPage', () => {
  it('matches each preview page and decodes its parameters', () => {
    expect(matchPreviewPage('/news/hello-world')).toEqual({ page: '/news/:slug', params: { slug: 'hello-world' } });
    expect(matchPreviewPage('/candidates/abc123/')).toEqual({ page: '/candidates/:id', params: { id: 'abc123' } });
    expect(matchPreviewPage('/course/transhumanism')).toEqual({ page: '/course/:courseId', params: { courseId: 'transhumanism' } });
    expect(matchPreviewPage('/results/e%20x')).toEqual({ page: '/results/:id', params: { id: 'e x' } });
    expect(matchPreviewPage('/legislation')).toEqual({ page: '/legislation', params: {} });
    expect(matchPreviewPage('/legislation/119-hr-10538')).toEqual({ page: '/legislation/:billId', params: { billId: '119-hr-10538' } });
    expect(matchPreviewPage('/scorecard/')).toEqual({ page: '/scorecard', params: {} });
    expect(matchPreviewPage('/scorecard/A000370')).toEqual({ page: '/scorecard/:memberId', params: { memberId: 'A000370' } });
    expect(matchPreviewPage('/races/ca')).toEqual({ page: '/races/:state', params: { state: 'ca' } });
    expect(matchPreviewPage('/races/ca/12')).toEqual({ page: '/races/:state/:district', params: { state: 'ca', district: '12' } });
    expect(matchPreviewPage('/races/wy/at-large/')).toEqual({ page: '/races/:state/:district', params: { state: 'wy', district: 'at-large' } });
    expect(matchPreviewPage('/people/H8CA49058')).toEqual({ page: '/people/:id', params: { id: 'H8CA49058' } });
  });

  it('matches a page with two fixed segments before its parameter, apart from the one-segment page beside it', () => {
    const id = '019a7b2c-1d2e-7f00-8a00-0123456789ab';
    expect(matchPreviewPage(`/course/certificates/${id}`)).toEqual({ page: '/course/certificates/:id', params: { id } });
    expect(matchPreviewPage(`/course/certificates/${id}/`)).toEqual({ page: '/course/certificates/:id', params: { id } });
    // One segment fewer is the course page, as the router has it: there is no course called "certificates".
    expect(matchPreviewPage('/course/certificates')).toEqual({ page: '/course/:courseId', params: { courseId: 'certificates' } });
  });

  it('matches nothing else', () => {
    for (const path of [
      '/',
      '/news',
      '/news/a/b',
      '/legislation/a/b',
      '/course/certificates/abc/more',
      '/course/other/abc',
      '/course/certificates/a%2Fb',
      '/candidates/a%2Fb',
      '/news/%E0%A4%A',
      '/news/a%5Cb',
      '/results/%00',
      '/other/x',
      '/races',
      '/races/ca/12/x',
      '/races/ca/%2F',
      '/people',
    ]) {
      expect(matchPreviewPage(path), path).toBeNull();
    }
  });

  it('every page is fixed lower-case segments, with at most two parameters after them', () => {
    for (const page of PREVIEW_PAGES) expect(page).toMatch(/^(?:\/[a-z]+)+(?:\/:[A-Za-z]+){0,2}$/);
  });
});

describe('clipText', () => {
  it('leaves short text alone but squeezes its spaces', () => {
    expect(clipText('  a   b\n c ', 10)).toBe('a b c');
  });

  it('cuts long text at a word with an ellipsis', () => {
    expect(clipText('The quick brown fox jumps over the lazy dog', 20)).toBe('The quick brown fox…');
    expect(clipText('Supercalifragilisticexpialidocious', 10)).toBe('Supercali…');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(clipText('😀😀😀😀', 4)).toBe('😀😀😀😀');
  });
});

describe('clippedPreview', () => {
  it('holds every text and bar to the limits', () => {
    const long = 'word '.repeat(200);
    const clipped = clippedPreview({
      title: long,
      description: long,
      card: {
        kicker: long,
        title: long,
        lines: [long, 'b', 'c', 'd'],
        bars: [
          { label: 'A', value: '1', share: 2 },
          { label: 'B', value: '2', share: -1 },
          { label: 'C', value: '3', share: Number.NaN, highlight: true },
          { label: 'D', value: '4', share: 0.5 },
          { label: 'E', value: '5', share: 0.5 },
        ],
      },
    });
    expect(clipped.title.length).toBeLessThanOrEqual(120);
    expect(clipped.description.length).toBeLessThanOrEqual(300);
    expect(clipped.card.kicker.length).toBeLessThanOrEqual(60);
    expect(clipped.card.lines).toHaveLength(3);
    expect(clipped.card.bars?.map((b) => b.share)).toEqual([1, 0, 0, 0.5]);
    expect(clipped.card.bars?.[2]?.highlight).toBe(true);
  });
});

describe('headWithPreview', () => {
  it("replaces the site's title, description and preview tags with the page's, escaped", () => {
    const html = headWithPreview(INDEX, HEAD);
    expect(html).toContain('<title>Hello &quot;world&quot; · USTP Vote</title>');
    expect(html).not.toContain('<title>USTP Vote</title>');
    expect(html).toContain('<meta name="description" content="A &lt;b&gt;bold&lt;/b&gt; &amp; brave post" />');
    expect(html).not.toContain("The site's description.");
    expect(html).not.toContain('share-card.png');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/name="twitter:card"/g)).toHaveLength(1);
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('<link rel="canonical" href="https://site.example/news/hello" />');
    expect(html).toContain('<meta property="og:image" content="https://site.example/v1/public/link-cards?path=%2Fnews%2Fhello&amp;v=abc" />');
    expect(html).toContain('<meta property="og:image:alt" content="News: Hello &#39;world&#39;" />');
    expect(html).not.toContain('name="robots"');
  });

  it('keeps everything else as built', () => {
    const html = headWithPreview(INDEX, HEAD);
    for (const kept of ['<meta charset="UTF-8" />', 'name="theme-color"', '<link rel="manifest"', '<script type="module" crossorigin src="/assets/index-abc.js"></script>', '<div id="app"></div>']) {
      expect(html).toContain(kept);
    }
    expect(html.indexOf('</head>')).toBeGreaterThan(html.indexOf('og:image:alt'));
  });

  it('marks a page kept out of search results', () => {
    expect(headWithPreview(INDEX, { ...HEAD, listed: false })).toContain('<meta name="robots" content="noindex" />');
  });

  it('refuses a file with no head', () => {
    expect(() => headWithPreview('<html></html>', HEAD)).toThrow();
  });
});

describe('siteNameOf', () => {
  it("reads the site's name from index.html", () => {
    expect(siteNameOf(INDEX)).toBe('USTP & Vote');
    expect(siteNameOf('<head></head>')).toBeNull();
  });
});

describe('cardAlt', () => {
  it('says what the card is, then its title', () => {
    expect(cardAlt({ kicker: 'News', title: 'Hello' })).toBe('News: Hello');
  });
});
