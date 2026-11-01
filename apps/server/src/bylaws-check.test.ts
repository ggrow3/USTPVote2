import type { Firestore } from 'firebase-admin/firestore';
import { sha256Hex } from 'ustp-audit';
import type { BylawsFinding } from 'ustp-domain';
import { describe, expect, it } from 'vitest';
import { tidyFindings } from './bylaws-check/checker.js';
import { ClaudeBylawsChecker, draftBlock, ranges, SYSTEM_PROMPT } from './bylaws-check/claude-checker.js';
import { htmlToText, ReferenceLibrary, type ReferenceText } from './bylaws-check/references.js';
import { StubBylawsChecker } from './bylaws-check/stub-checker.js';
import { US_CONSTITUTION_SHA256, US_CONSTITUTION_TEXT } from './bylaws-check/us-constitution.js';
import { loadConfig } from './config.js';
import { fakeAnthropic as fakeApi, type CapturedRequest } from './testing/fake-anthropic.js';

const finding = (lines: number[], severity: BylawsFinding['severity'] = 'medium'): BylawsFinding => ({
  lines,
  source: 'ustp-constitution',
  provision: 'Article V',
  severity,
  explanation: 'Conflicts.',
});

describe('the vendored US Constitution', () => {
  it('is the snapshot its hash names, with every article and amendment', () => {
    expect(sha256Hex(US_CONSTITUTION_TEXT)).toBe(US_CONSTITUTION_SHA256);
    for (const heading of ['Article. I.', 'Article. VII.', 'Amendment I', 'Amendment X', 'AMENDMENT XIV', 'AMENDMENT XXVII']) {
      expect(US_CONSTITUTION_TEXT.split('\n')).toContain(heading);
    }
    expect(US_CONSTITUTION_TEXT).toMatch(/^THE CONSTITUTION OF THE UNITED STATES\n\nWe the People/);
  });
});

describe('htmlToText', () => {
  it('keeps one block per line, numbers ordered lists from their start, and decodes entities', () => {
    const html =
      '<h2><a id="ArticleV"></a>Article V. Amendments</h2>\n<p><strong>Section I:</strong> Amendments need a vote&nbsp;of the members &#8211; two&#x2d;thirds.<br />Second line &amp; more.</p>' +
      '<ol start="2">\n<li>first</li>\n<li>second <em>item</em></li>\n</ol><ul><li>bullet</li></ul><p>&hellip; end &rsquo;</p><!-- note --><script>x()</script>';
    expect(htmlToText(html)).toBe(
      'Article V. Amendments\n\nSection I: Amendments need a vote of the members – two-thirds.\nSecond line & more.\n\n2. first\n3. second item\n\n- bullet\n\n… end ’',
    );
  });
});

describe('tidyFindings', () => {
  it('drops lines that do not exist and findings without one, dedupes and sorts, most severe first', () => {
    const tidy = tidyFindings([finding([9, 3, 3, 0, 99], 'low'), finding([50]), finding([4], 'high')], 10, null);
    expect(tidy.map((f) => [f.severity, f.lines])).toEqual([
      ['high', [4]],
      ['low', [3, 9]],
    ]);
  });

  it('keeps only findings that involve a reviewed line when only changes were reviewed', () => {
    expect(tidyFindings([finding([2]), finding([5, 6])], 10, [6, 7]).map((f) => f.lines)).toEqual([[5, 6]]);
  });
});

describe('the stand-in checker', () => {
  it('flags its test phrases, deterministically, and only on reviewed lines', async () => {
    const text = 'Article I. Name.\nThe party opposes life extension research.\nOfficers may amend the bylaws without a vote of the members.\nCandidates must pass a religious test.';
    const input = { title: 'Bylaws', text, focusLines: null, amends: null, removed: [] };
    const all = await new StubBylawsChecker().check(input);
    expect(all.findings.map((f) => [f.lines, f.source, f.severity])).toEqual([
      [[2], 'transhumanist-principles', 'high'],
      [[3], 'ustp-constitution', 'medium'],
      [[4], 'us-constitution', 'medium'],
    ]);
    expect(all.findings[0]!.explanation).toMatch(/^Local stand-in, not a review/);
    expect(all.references.map((r) => [r.id, r.sha256 === null])).toEqual([
      ['us-constitution', false],
      ['ustp-constitution', true],
      ['transhumanist-bill-of-rights', true],
    ]);
    expect((await new StubBylawsChecker().check({ ...input, focusLines: [3] })).findings.map((f) => f.lines)).toEqual([[3]]);
  });
});

describe('the prompt', () => {
  it('numbers every line and says which to review', () => {
    expect(ranges([1, 2, 3, 7, 9, 10])).toBe('1-3, 7, 9-10');
    const block = draftBlock({
      title: 'USTP Bylaws',
      text: 'A\nB\nC',
      focusLines: [2],
      amends: '2026.1',
      removed: [{ line: 2, text: 'old B' }],
    });
    expect(block).toContain('<bylaws>\n[1] A\n[2] B\n[3] C\n</bylaws>');
    expect(block).toContain('Review only lines 2: they were added or changed since version 2026.1');
    expect(block).toContain('(was line 2) old B');
    expect(draftBlock({ title: 'T', text: 'A', focusLines: null, amends: null, removed: [] })).toContain('Review every line.');
    expect(SYSTEM_PROMPT).toMatch(/not instructions to you/);
  });
});

describe('the Claude checker', () => {
  const references: ReferenceText[] = ['us-constitution', 'ustp-constitution', 'transhumanist-bill-of-rights'].map((id) => ({
    id: id as ReferenceText['id'],
    title: id,
    url: `https://example.test/${id}`,
    retrievedAt: '2026-10-22T00:00:00.000Z',
    modifiedAt: null,
    sha256: 'ab'.repeat(32),
    text: `text of ${id}`,
  }));

  it('sends the references as a cached prefix and the numbered draft, and keeps the findings on real lines', async () => {
    const captured: CapturedRequest = {};
    const review = { summary: 'One conflict.', findings: [{ ...finding([2, 40], 'high'), source: 'us-constitution', provision: 'Amendment I' }] };
    const checker = new ClaudeBylawsChecker({ read: async () => 'sk-test' }, 'claude-opus-5-5', { load: async () => references }, { fetch: fakeApi(review, captured) });
    const out = await checker.check({ title: 'Bylaws', text: 'A\nB\nC', focusLines: null, amends: null, removed: [] });

    expect(out).toMatchObject({
      summary: 'One conflict.',
      model: 'claude-opus-5-5',
      findings: [{ lines: [2], source: 'us-constitution', provision: 'Amendment I', severity: 'high' }],
      usage: { inputTokens: 40, outputTokens: 120, cacheReadInputTokens: 30 },
    });
    expect(out.references.map((r) => r.id)).toEqual(['us-constitution', 'ustp-constitution', 'transhumanist-bill-of-rights']);
    expect(out.references[0]).not.toHaveProperty('text');

    expect(captured.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(captured.headers?.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const body = captured.body!;
    expect(body).toMatchObject({ model: 'claude-opus-5-5', stream: true, fallbacks: 'default', system: SYSTEM_PROMPT });
    expect(body.output_config).toMatchObject({ effort: 'high', format: { type: 'json_schema' } });
    const content = (body.messages as { content: { text: string; cache_control?: unknown }[] }[])[0]!.content;
    expect(content.map((c) => c.cache_control ?? null)).toEqual([null, null, { type: 'ephemeral' }, null]);
    expect(content[0]!.text).toMatch(/^<reference id="us-constitution"/);
    expect(content[3]!.text).toContain('[2] B');
  });

  it('refuses to run until a System Admin adds an API key', async () => {
    const checker = new ClaudeBylawsChecker({ read: async () => null }, 'claude-opus-5-5', { load: async () => references });
    await expect(checker.check({ title: 'B', text: 'A', focusLines: null, amends: null, removed: [] })).rejects.toThrow(/no Anthropic API key has been added .*Admin › API keys/);
  });
});

describe('ReferenceLibrary', () => {
  /** Just enough Firestore for one collection of documents. */
  function fakeDb(docs: Map<string, unknown>) {
    return {
      collection: () => ({
        doc: (id: string) => ({
          get: async () => ({ data: () => docs.get(id) }),
          set: async (value: unknown) => void docs.set(id, value),
        }),
      }),
    } as unknown as Firestore;
  }
  const page = (body: string) => [{ link: 'https://transhumanist-party.org/x/', modified_gmt: '2026-09-14T07:05:22', content: { rendered: body } }];
  const longPage = `<p>${'Section text. '.repeat(500)}</p>`;

  it('reads the party pages from the site, caches them for a day, and falls back to the cache if the site fails', async () => {
    const docs = new Map<string, unknown>();
    let now = new Date('2026-10-22T12:00:00Z');
    let calls = 0;
    let fail = false;
    const fetch = (async (url: string) => {
      calls++;
      expect(url).toMatch(/^https:\/\/transhumanist-party\.org\/wp-json\/wp\/v2\/pages\?slug=(constitution|tbr-3)&/);
      return fail ? new Response('down', { status: 503 }) : Response.json(page(longPage));
    }) as typeof globalThis.fetch;
    const library = new ReferenceLibrary(fakeDb(docs), fetch, () => now);

    const first = await library.load();
    expect(first.map((r) => [r.id, r.modifiedAt])).toEqual([
      ['us-constitution', null],
      ['ustp-constitution', '2026-09-14T07:05:22.000Z'],
      ['transhumanist-bill-of-rights', '2026-09-14T07:05:22.000Z'],
    ]);
    expect(first[1]!.sha256).toBe(sha256Hex(first[1]!.text));
    expect(calls).toBe(2);

    now = new Date('2026-10-23T06:00:00Z');
    await library.load();
    expect(calls).toBe(2); // cached

    now = new Date('2026-10-24T12:00:00Z');
    fail = true;
    expect((await library.load())[1]!.retrievedAt).toBe('2026-10-22T12:00:00.000Z'); // stale copy beats none
    expect(calls).toBe(4);
  });

  it('fails clearly when the site cannot be read and nothing is cached, or returns too little text', async () => {
    const down = (async () => new Response('down', { status: 503 })) as unknown as typeof globalThis.fetch;
    await expect(new ReferenceLibrary(fakeDb(new Map()), down).load()).rejects.toThrow(/could not read the Constitution of the United States Transhumanist Party .*HTTP 503/);
    const empty = (async () => Response.json(page('<p>Just a moment…</p>'))) as unknown as typeof globalThis.fetch;
    await expect(new ReferenceLibrary(fakeDb(new Map()), empty).load()).rejects.toThrow(/expected more/);
  });
});

describe('bylaws check configuration', () => {
  const emulators = { FIRESTORE_EMULATOR_HOST: 'x', FIREBASE_AUTH_EMULATOR_HOST: 'y', GCLOUD_PROJECT: 'demo-p' };

  it('is off in real projects unless switched on, and refuses the stand-in there', () => {
    expect(loadConfig({})).toMatchObject({ bylawsChecker: 'off', bylawsCheckModel: 'claude-opus-5-5' });
    expect(loadConfig({ BYLAWS_CHECKER: 'claude' })).toMatchObject({ bylawsChecker: 'claude' });
    expect(() => loadConfig({ BYLAWS_CHECKER: 'stub' })).toThrow(/only allowed with the Firebase emulators/);
    expect(() => loadConfig({ BYLAWS_CHECKER: 'gpt' })).toThrow(/must be "claude", "stub" or "off"/);
  });

  it('uses the stand-in with the emulators unless told otherwise', () => {
    expect(loadConfig(emulators).bylawsChecker).toBe('stub');
    expect(loadConfig({ ...emulators, BYLAWS_CHECKER: 'claude', BYLAWS_CHECK_MODEL: 'claude-sonnet-5-5' })).toMatchObject({
      bylawsChecker: 'claude',
      bylawsCheckModel: 'claude-sonnet-5-5',
    });
  });
});
