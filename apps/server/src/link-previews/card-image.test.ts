import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { LinkCard } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { cardSvg, renderCard, type CardSite } from './card-image.js';

const SITE: CardSite = { name: 'USTP Vote', party: 'U.S. Transhumanist Party', host: 'vote.example.org' };

const CARDS: Readonly<Record<string, LinkCard>> = {
  news: {
    kicker: 'News · Press release',
    title: 'The Transhumanist Party nominates its 2028 presidential ticket after a record vote',
    lines: ['Washington, D.C. · November 9, 2026'],
  },
  candidate: { kicker: 'Candidate · U.S. Representative', title: 'Ada Brooks', lines: ['Congressional District 12, California', 'General election · Nov 3, 2026'] },
  results: {
    kicker: 'Election results · Certified',
    title: 'Officer election 2026',
    bars: [
      { label: 'Chair: Ada Brooks', value: '62.5%', share: 0.625, highlight: true },
      { label: 'Ben Cruz', value: '37.5%', share: 0.375 },
      { label: 'Proposal 1: Adopt the platform', value: 'Passed', share: 0.81, highlight: true },
    ],
  },
  long: {
    kicker: 'A very long kicker that goes on and on and on past the edge of the card for sure',
    title: 'Ünïcödé, “quotes”, łódź and 😀 emoji in a title so long that it has to wrap onto more lines than fit, then be cut short with an ellipsis at the end',
    lines: ['A line', 'Another line that is also far too long to fit on one line of the card so it must be cut with an ellipsis somewhere', 'Third', 'Fourth'],
  },
};

describe('card images', () => {
  it('draws every letter as an outline: no text, font or markup from the card reaches the SVG', () => {
    const svg = cardSvg({ kicker: '<script>', title: '</svg><text>hi</text>', lines: ['&amp; "q"'] }, SITE);
    expect(svg).not.toMatch(/<text|<script|font-family|&amp;|"q"/);
    expect(svg.match(/<path /g)!.length).toBeGreaterThan(5);
  });

  it('draws whole outlines, with no NaN cutting a line short', () => {
    for (const [name, card] of Object.entries(CARDS)) expect(cardSvg(card, SITE), name).not.toContain('NaN');
  });

  it('renders a 1200 × 630 PNG for each kind of card', async () => {
    const out = process.env.CARD_OUT;
    if (out) mkdirSync(out, { recursive: true });
    for (const [name, card] of Object.entries(CARDS)) {
      const png = await renderCard(card, SITE);
      const meta = await sharp(png).metadata();
      expect([meta.format, meta.width, meta.height], name).toEqual(['png', 1200, 630]);
      if (out) writeFileSync(join(out, `${name}.png`), png);
    }
  });
});
