import { describe, expect, it } from 'vitest';
import { isPublicLedgerEvent } from '../ledger.js';
import { checkRoleChange, conflictingRoles } from '../roles.js';
import {
  addBot,
  botCheckDue,
  checkBot,
  publicBots,
  updateBot,
  type BotRecord,
  type CreateBotInput,
} from './bots.js';
import { calendarItemOverdue, calendarStatusSchema, createCalendarItem, createCalendarItemSchema, setCalendarStatus } from './calendar.js';
import { absoluteUrl, addressProblem, hashtagsSchema, slugFrom } from './common.js';
import { jsonFeed, rssFeed } from './feeds.js';
import { newsBlocks, newsHtml, newsText, textSegments } from './news-body.js';
import {
  checkDeleteNews,
  createNews,
  createNewsSchema,
  publicNewsPost,
  publishedNews,
  publishNews,
  updateNews,
  withdrawNews,
  type NewsPostRecord,
} from './news.js';
import { checkPressAssets, EMPTY_PRESS_KIT, pressFileName, pressKitSchema, publicPressKit, savePressKit } from './press-kit.js';
import { kitItem, newsItem, parseShareItem } from './share-counts.js';
import {
  archiveSharePost,
  checkDeleteSharePost,
  createSharePost,
  createSharePostSchema,
  publishSharePost,
  sharePostOffered,
  updateSharePost,
} from './share-kit.js';
import { mastodonHost, shareLength, shareProblem, shareText, shareUrl, type Shareable } from './share.js';
import {
  checkSuggestionLimits,
  isTrapped,
  newSuggestion,
  SUGGESTIONS_PER_DAY,
  SUGGESTIONS_PER_SENDER_PER_DAY,
  suggestionSchema,
  suggestionsExpireBefore,
  triageSuggestion,
} from './suggestions.js';

const AT = '2026-10-28T12:00:00.000Z';
const LATER = '2026-10-29T09:30:00.000Z';
const ADMIN = '01900000-0000-7000-8000-000000000001';
const POST_ID = '01900000-0000-7000-8000-0000000000aa';

const draft = (overrides: Partial<Parameters<typeof createNewsSchema.parse>[0]> = {}): NewsPostRecord => {
  const input = createNewsSchema.parse({
    kind: 'press_release',
    title: 'USTP  announces\nits platform',
    summary: 'The party publishes its platform for 2028.',
    body: 'Today the party published its platform.\n\n- Science\n- Health',
    dateline: 'Washington, D.C.',
    hashtags: ['#USTP', 'Transhumanism', 'ustp'],
    slug: 'platform-2028',
    ...overrides,
  });
  const outcome = createNews(input, POST_ID, false, ADMIN, AT);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.value;
};

function ok<T>(outcome: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.value;
}

describe('the Communications Admin role', () => {
  it('cannot be held with Auditor, and counts towards the two roles a person may hold', () => {
    expect(conflictingRoles(['auditor'], 'communications_admin')).toEqual(['auditor']);
    expect(checkRoleChange(['course_admin'], 'grant', 'communications_admin').ok).toBe(true);
    expect(checkRoleChange(['membership_admin', 'election_admin'], 'grant', 'communications_admin').ok).toBe(false);
  });

  it('makes ledger entries Auditors read, none of them public', () => {
    for (const type of ['news.published', 'news.changed', 'news.withdrawn', 'press_kit.changed', 'share_post.changed', 'bot.changed'] as const) {
      expect(isPublicLedgerEvent(type)).toBe(false);
    }
  });
});

describe('addresses and hashtags', () => {
  it('make a slug from a title', () => {
    expect(slugFrom('USTP Announces: Its 2028 Platform & Candidates!')).toBe('ustp-announces-its-2028-platform-and-candidates');
    expect(slugFrom('Café Ümlaut')).toBe('cafe-umlaut');
    expect(slugFrom('a'.repeat(70)).length).toBe(60);
  });

  it('take https addresses and, where allowed, pages of this site', () => {
    expect(addressProblem('https://example.org/x', false)).toBeNull();
    expect(addressProblem('/news/x', true)).toBeNull();
    expect(addressProblem('/news/x', false)).toMatch(/https/);
    expect(addressProblem('//evil.example', true)).toMatch(/https/);
    expect(addressProblem('http://example.org', true)).toBe('use the https:// address');
    expect(addressProblem('javascript:alert(1)', true)).toMatch(/https/);
    expect(absoluteUrl('/news/x', 'https://vote.example/')).toBe('https://vote.example/news/x');
    expect(absoluteUrl('https://a.example', 'https://vote.example')).toBe('https://a.example');
  });

  it('keep hashtags without their #, once each', () => {
    expect(hashtagsSchema.parse(['#USTP', 'ustp', 'Future_2028'])).toEqual(['USTP', 'Future_2028']);
    expect(hashtagsSchema.safeParse(['two words']).success).toBe(false);
    expect(hashtagsSchema.safeParse(['a', 'b', 'c', 'd', 'e', 'f']).success).toBe(false);
  });
});

describe('news posts', () => {
  it('start as drafts, with tidied text', () => {
    const post = draft();
    expect(post).toMatchObject({ status: 'draft', version: 1, title: 'USTP announces its platform', hashtags: ['USTP', 'Transhumanism'], publishedAt: null });
    expect(createNews(createNewsSchema.parse({ kind: 'news', title: 'x', slug: 'platform-2028' }), POST_ID, true, ADMIN, AT)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/already uses/),
    });
  });

  it('are published with a summary and text, once, and ledgered', () => {
    expect(publishNews(draft({ summary: '' }), 1, ADMIN, AT)).toMatchObject({ ok: false, reason: expect.stringMatching(/summary/) });
    expect(publishNews(draft({ body: '' }), 1, ADMIN, AT)).toMatchObject({ ok: false, reason: expect.stringMatching(/text/) });
    expect(publishNews(draft(), 2, ADMIN, AT)).toMatchObject({ ok: false, refusal: 'conflict' });
    const { post, event } = ok(publishNews(draft(), 1, ADMIN, LATER));
    expect(post).toMatchObject({ status: 'published', version: 2, publishedAt: LATER, publishedBy: ADMIN });
    expect(event).toMatchObject({ type: 'news.published', actor: ADMIN, subject: POST_ID, payload: { slug: 'platform-2028', version: 2 } });
    expect(publishNews(post, 2, ADMIN, LATER)).toMatchObject({ ok: false, reason: 'it is already published' });
  });

  it('change quietly as drafts, and with a ledger entry once published; the address is fixed once published', () => {
    const d = draft();
    const edited = ok(updateNews(d, { ...d, title: 'New title', slug: 'new-title' }, 1, false, ADMIN, LATER));
    expect(edited).toMatchObject({ post: { title: 'New title', slug: 'new-title', version: 2, editedAt: null }, event: null });
    const published = ok(publishNews(edited.post, 2, ADMIN, LATER)).post;
    expect(updateNews(published, { ...published, slug: 'other' }, 3, false, ADMIN, LATER)).toMatchObject({ ok: false, reason: expect.stringMatching(/keeps its address/) });
    const changed = ok(updateNews(published, { ...published, summary: 'Better.' }, 3, false, ADMIN, LATER));
    expect(changed.post).toMatchObject({ version: 4, editedAt: LATER });
    expect(changed.event).toMatchObject({ type: 'news.changed', payload: { fields: ['summary'] } });
    expect(updateNews(published, { ...published }, 3, false, ADMIN, LATER)).toEqual({ ok: true, value: { post: published, event: null } });
    expect(updateNews(published, { ...published, body: '' }, 3, false, ADMIN, LATER)).toMatchObject({ ok: false, reason: expect.stringMatching(/text/) });
  });

  it('are withdrawn, not deleted, once published; can be published again with their first date', () => {
    const published = ok(publishNews(draft(), 1, ADMIN, AT)).post;
    expect(checkDeleteNews(published)).toMatchObject({ ok: false, reason: expect.stringMatching(/withdrawn/) });
    expect(checkDeleteNews(draft()).ok).toBe(true);
    const { post: withdrawn, event } = ok(withdrawNews(published, 2, ADMIN, LATER));
    expect(withdrawn).toMatchObject({ status: 'withdrawn', withdrawnAt: LATER });
    expect(event.type).toBe('news.withdrawn');
    expect(publicNewsPost(withdrawn)).toEqual({ status: 'withdrawn', slug: 'platform-2028', title: withdrawn.title, withdrawnAt: LATER });
    expect(publicNewsPost(draft())).toBeNull();
    const again = ok(publishNews(withdrawn, 3, ADMIN, LATER)).post;
    expect(again).toMatchObject({ status: 'published', publishedAt: AT, withdrawnAt: null });
    expect(publicNewsPost(again)).not.toHaveProperty('createdBy');
  });

  it('may carry a video, shown once published; changing it is a recorded edit, and posts from before have none', () => {
    const video = { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', start: 0 } as const;
    expect(draft().video).toBeNull();
    const published = ok(publishNews(draft({ video }), 1, ADMIN, AT)).post;
    expect(publicNewsPost(published)).toMatchObject({ status: 'published', video });
    const { slug, kind, title, summary, body, dateline, hashtags } = published;
    const same = { slug, kind, title, summary, body, dateline, hashtags };
    const changed = ok(updateNews(published, { ...same, video: { kind: 'upload', videoId: POST_ID } }, 2, false, ADMIN, LATER));
    expect(changed.event?.payload).toMatchObject({ fields: ['video'] });
    const older = { ...published, video: undefined } as unknown as NewsPostRecord;
    expect(publicNewsPost(older)).toMatchObject({ video: null });
    expect(ok(updateNews(older, { ...same, video: null }, 2, false, ADMIN, LATER)).event).toBeNull();
    expect(createNewsSchema.safeParse({ ...same, video: 'https://youtu.be/dQw4w9WgXcQ' }).success).toBe(false);
  });

  it('are listed newest first, published only', () => {
    const first = ok(publishNews(draft(), 1, ADMIN, AT)).post;
    const second = ok(publishNews({ ...draft(), postId: 'b', slug: 'second' }, 1, ADMIN, LATER)).post;
    expect(publishedNews([first, draft(), second]).map((p) => p.slug)).toEqual(['second', 'platform-2028']);
  });
});

describe('a post body', () => {
  const body = '## Heading\nFirst line\nsecond line\n\n- one\n* two\n\n> A quote\n\nSee https://example.org/a. <b>not bold</b>';

  it('is headings, paragraphs, lists and quotations', () => {
    expect(newsBlocks(body)).toEqual([
      { kind: 'heading', text: 'Heading' },
      { kind: 'paragraph', text: 'First line\nsecond line' },
      { kind: 'list', items: ['one', 'two'] },
      { kind: 'quote', text: 'A quote' },
      { kind: 'paragraph', text: 'See https://example.org/a. <b>not bold</b>' },
    ]);
  });

  it('links https addresses, leaving punctuation after them', () => {
    expect(textSegments('See https://example.org/a. or (https://x.example)')).toEqual([
      { text: 'See ' },
      { url: 'https://example.org/a' },
      { text: '. or (' },
      { url: 'https://x.example' },
      { text: ')' },
    ]);
    expect(textSegments('http://plain.example javascript:x')).toEqual([{ text: 'http://plain.example javascript:x' }]);
  });

  it('becomes escaped HTML for the feeds, and plain text', () => {
    const html = newsHtml(body);
    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('<p>First line<br>second line</p>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<a href="https://example.org/a">https://example.org/a</a>. &lt;b&gt;not bold&lt;/b&gt;');
    expect(newsText(body)).toContain('• one\n• two');
  });
});

describe('the news feeds', () => {
  const site = { origin: 'https://vote.example', name: 'US Transhumanist Party', description: 'News & press releases' };
  const post = ok(publishNews(draft({ title: 'Science & <Health>' }), 1, ADMIN, AT)).post;

  it('are RSS 2.0 with each post escaped', () => {
    const xml = rssFeed(site, [post]);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<title>Science &amp; &lt;Health&gt;</title>');
    expect(xml).toContain('<link>https://vote.example/news/platform-2028</link>');
    expect(xml).toContain(`<pubDate>${new Date(AT).toUTCString()}</pubDate>`);
    expect(xml).toContain('<category>Press release</category>');
    expect(xml).toContain('&lt;ul&gt;&lt;li&gt;Science&lt;/li&gt;');
    expect(xml).toContain('<description>News &amp; press releases</description>');
    expect(rssFeed(site, [{ ...post, title: 'bad\u0001char' }])).toContain('<title>badchar</title>');
  });

  it('are JSON Feed 1.1', () => {
    const feed = jsonFeed(site, [post]);
    expect(feed).toMatchObject({ version: 'https://jsonfeed.org/version/1.1', feed_url: 'https://vote.example/v1/news/feed.json' });
    expect(feed.items[0]).toMatchObject({ id: 'https://vote.example/news/platform-2028', date_published: AT, tags: ['Press release', 'USTP', 'Transhumanism'] });
    expect(feed.items[0]).not.toHaveProperty('date_modified');
  });
});

describe('share buttons', () => {
  const item: Shareable = { text: 'Read our platform', url: 'https://vote.example/news/p', hashtags: ['USTP'], title: 'Our platform' };

  it('put the hashtags after the text, and the address too where the site has no place for it', () => {
    expect(shareText('x', item)).toBe('Read our platform #USTP');
    expect(shareText('bluesky', item)).toBe('Read our platform #USTP https://vote.example/news/p');
    expect(shareText('email', item)).toBe('Read our platform\n\n#USTP\n\nhttps://vote.example/news/p');
  });

  it('open each composer with the text filled in', () => {
    expect(shareUrl('x', item)).toBe('https://x.com/intent/tweet?text=Read%20our%20platform%20%23USTP&url=https%3A%2F%2Fvote.example%2Fnews%2Fp');
    expect(shareUrl('facebook', item)).toBe('https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fvote.example%2Fnews%2Fp');
    expect(shareUrl('facebook', { ...item, url: null })).toBeNull();
    expect(shareUrl('linkedin', { ...item, url: null })).toMatch(/^https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true&text=/);
    expect(shareUrl('bluesky', item)).toMatch(/^https:\/\/bsky\.app\/intent\/compose\?text=/);
    expect(shareUrl('mastodon', item)).toBeNull();
    expect(shareUrl('mastodon', item, '@me@Mastodon.Social')).toMatch(/^https:\/\/mastodon\.social\/share\?text=/);
    expect(shareUrl('email', item)).toMatch(/^mailto:\?subject=Our%20platform&body=/);
    expect(shareUrl('telegram', { ...item, url: null })).toBe('https://t.me/share/url?url=Read%20our%20platform%20%23USTP');
  });

  it('know a Mastodon server when they see one', () => {
    expect(mastodonHost('https://fosstodon.org/@me')).toBe('fosstodon.org');
    expect(mastodonHost('not a host')).toBeNull();
    expect(mastodonHost('localhost')).toBeNull();
  });

  it('count as each site does, and say when a post is too long', () => {
    expect(shareLength('x', item)).toBe('Read our platform #USTP'.length + 24);
    expect(shareLength('mastodon', item)).toBe('Read our platform #USTP '.length + 23);
    const long = { ...item, text: 'a'.repeat(260) };
    expect(shareProblem('x', long)).toMatch(/of 280 characters on X/);
    expect(shareProblem('bluesky', long)).toBeNull();
    expect(shareProblem('facebook', { ...item, url: null })).toMatch(/only a link/);
  });
});

describe('share counts', () => {
  it('name news posts by address and kit posts by ID, and nothing else', () => {
    expect(parseShareItem(newsItem('platform-2028'))).toEqual({ kind: 'news', slug: 'platform-2028' });
    expect(parseShareItem(kitItem(POST_ID))).toEqual({ kind: 'kit', shareId: POST_ID });
    expect(parseShareItem('kit-123')).toBeNull();
    expect(parseShareItem('link-x')).toBeNull();
  });
});

describe('the share kit', () => {
  const input = createSharePostSchema.parse({ title: 'Debate night', text: 'Watch tonight', url: '/news/debate', hashtags: ['USTP'], until: '2026-11-01' });
  const draftPost = createSharePost(input, POST_ID, ADMIN, AT);

  it('offers members published posts until their last day', () => {
    expect(sharePostOffered(draftPost, '2026-10-28')).toBe(false);
    const { post, event } = ok(publishSharePost(draftPost, 1, ADMIN, AT));
    expect(event).toMatchObject({ type: 'share_post.changed', payload: { change: 'published' } });
    expect(sharePostOffered(post, '2026-11-01')).toBe(true);
    expect(sharePostOffered(post, '2026-11-02')).toBe(false);
  });

  it('ledgers changes members can see, and keeps archived posts as they were', () => {
    expect(ok(updateSharePost(draftPost, { ...input, text: 'Changed' }, 1, ADMIN, AT)).event).toBeNull();
    const published = ok(publishSharePost(draftPost, 1, ADMIN, AT)).post;
    expect(ok(updateSharePost(published, { ...input, text: 'Changed' }, 2, ADMIN, AT)).event).toMatchObject({ payload: { change: 'updated', fields: ['text'] } });
    expect(checkDeleteSharePost(published).ok).toBe(false);
    const archived = ok(archiveSharePost(published, 2, ADMIN, AT)).post;
    expect(updateSharePost(archived, input, 3, ADMIN, AT)).toMatchObject({ ok: false, reason: expect.stringMatching(/archived/) });
    expect(archiveSharePost(draftPost, 1, ADMIN, AT).ok).toBe(false);
  });

  it('takes only https addresses and pages of this site', () => {
    expect(createSharePostSchema.safeParse({ ...input, url: 'http://x.example' }).success).toBe(false);
    expect(createSharePostSchema.safeParse({ ...input, text: '' }).success).toBe(false);
  });
});

describe('the social media calendar', () => {
  const input = createCalendarItemSchema.parse({ network: 'x', scheduledFor: '2026-10-30T18:00:00-04:00', text: 'Tonight!' });
  const item = createCalendarItem(input, POST_ID, ADMIN, AT);

  it('keeps times in UTC and says when a planned post is overdue', () => {
    expect(item.scheduledFor).toBe('2026-10-30T22:00:00.000Z');
    expect(calendarItemOverdue(item, '2026-10-30T22:00:01.000Z')).toBe(true);
    expect(calendarItemOverdue(item, AT)).toBe(false);
  });

  it('records who posted it and where, and forgets it when planned again', () => {
    const posted = ok(setCalendarStatus(item, calendarStatusSchema.parse({ basedOn: 1, status: 'posted', postedUrl: 'https://x.com/USTP/status/1' }), ADMIN, LATER));
    expect(posted).toMatchObject({ status: 'posted', postedAt: LATER, postedBy: ADMIN, version: 2 });
    expect(calendarItemOverdue(posted, '2027-01-01T00:00:00.000Z')).toBe(false);
    const again = ok(setCalendarStatus(posted, calendarStatusSchema.parse({ basedOn: 2, status: 'planned' }), ADMIN, LATER));
    expect(again).toMatchObject({ status: 'planned', postedUrl: '', postedAt: null });
    expect(setCalendarStatus(posted, calendarStatusSchema.parse({ basedOn: 1, status: 'skipped' }), ADMIN, LATER).ok).toBe(false);
  });
});

describe('suggestions', () => {
  const base = { topic: 'policy', message: 'Please write a policy on longevity research.' };

  it('need consent to keep a name or email, and a real message', () => {
    expect(suggestionSchema.safeParse(base).success).toBe(true);
    expect(suggestionSchema.safeParse({ ...base, email: 'a@example.org' }).error?.issues[0]).toMatchObject({ path: ['consent'] });
    expect(suggestionSchema.safeParse({ ...base, email: 'a@example.org', consent: true }).success).toBe(true);
    expect(suggestionSchema.safeParse({ ...base, email: 'not-an-email', consent: true }).success).toBe(false);
    expect(suggestionSchema.safeParse({ ...base, message: 'hi' }).success).toBe(false);
  });

  it('are kept without what was left empty, and flagged with many links', () => {
    const s = newSuggestion(suggestionSchema.parse({ ...base, name: ' Ada\nB ', email: 'Ada@Example.org', consent: true }), POST_ID, AT);
    expect(s).toMatchObject({ name: 'Ada B', email: 'ada@example.org', status: 'new', flagged: false });
    const spam = suggestionSchema.parse({ ...base, message: 'buy https://a.example https://b.example www.c.example https://d.example' });
    expect(newSuggestion(spam, POST_ID, AT).flagged).toBe(true);
    expect(newSuggestion(suggestionSchema.parse(base), POST_ID, AT)).toMatchObject({ name: null, email: null });
  });

  it('drop what a form filler sends', () => {
    expect(isTrapped(suggestionSchema.parse({ ...base, website: 'https://spam.example' }))).toBe(true);
    expect(isTrapped(suggestionSchema.parse(base))).toBe(false);
  });

  it('are limited per sender and per day', () => {
    expect(checkSuggestionLimits(null, 'h').ok).toBe(true);
    expect(checkSuggestionLimits({ total: 1, senders: { h: SUGGESTIONS_PER_SENDER_PER_DAY } }, 'h')).toMatchObject({ ok: false, refusal: 'rate_limited' });
    expect(checkSuggestionLimits({ total: 1, senders: { h: SUGGESTIONS_PER_SENDER_PER_DAY } }, 'other').ok).toBe(true);
    expect(checkSuggestionLimits({ total: SUGGESTIONS_PER_DAY, senders: {} }, 'h')).toMatchObject({ ok: false, refusal: 'rate_limited' });
  });

  it('record who handled them, and expire after a year', () => {
    const s = newSuggestion(suggestionSchema.parse(base), POST_ID, AT);
    expect(triageSuggestion(s, { status: 'answered', note: 'Replied.' }, ADMIN, LATER)).toMatchObject({ status: 'answered', handledBy: ADMIN, handledAt: LATER });
    expect(triageSuggestion(s, { status: 'new', note: '' }, ADMIN, LATER)).toBe(s);
    expect(suggestionsExpireBefore(new Date('2026-10-28T00:00:00Z'))).toBe('2025-10-28T00:00:00.000Z');
  });
});

describe('the press kit', () => {
  const ID = 'a'.repeat(64);
  const input = pressKitSchema.parse({
    basedOn: 0,
    about: 'The USTP is…',
    contact: { name: 'A Person', email: 'press@example.org', phone: '+1 (555) 010-0100' },
    facts: [{ label: 'Founded', value: '2014' }],
    assets: [{ id: ID, title: 'Logo' }],
  });

  it('is saved from the version it was edited from, with a ledger entry naming what changed', () => {
    const { kit, event } = ok(savePressKit(EMPTY_PRESS_KIT, input, ADMIN, AT));
    expect(kit).toMatchObject({ version: 1, updatedBy: ADMIN, contact: { role: '', note: '' } });
    expect(event).toMatchObject({ type: 'press_kit.changed', payload: { version: 1, fields: ['about', 'contact', 'facts', 'assets'], assetsAdded: [ID], assetsRemoved: [] } });
    expect(savePressKit(kit, input, ADMIN, AT)).toMatchObject({ ok: false, refusal: 'conflict' });
    expect(ok(savePressKit(kit, { ...input, basedOn: 1 }, ADMIN, AT)).event).toBeNull();
    const removed = ok(savePressKit(kit, { ...input, assets: [], basedOn: 1 }, ADMIN, AT));
    expect(removed.event?.payload).toMatchObject({ fields: ['assets'], assetsRemoved: [ID] });
  });

  it('lists only files uploaded here, under safe names', () => {
    expect(checkPressAssets(input, new Set())).toMatchObject({ ok: false, reason: expect.stringMatching(/Logo/) });
    expect(checkPressAssets(input, new Set([ID])).ok).toBe(true);
    expect(pressFileName('USTP logo (final).PNG', 'image/png')).toBe('USTP-logo-final.png');
    expect(pressFileName('../../etc/passwd', 'application/pdf')).toBe('etc-passwd.pdf');
    expect(pressFileName('', 'image/jpeg')).toBe('ustp-press.jpg');
    const kit = ok(savePressKit(EMPTY_PRESS_KIT, input, ADMIN, AT)).kit;
    const file = { id: ID, contentType: 'image/png' as const, bytes: 10, width: 100, height: 50, fileName: 'logo.png', uploadedAt: AT, uploadedBy: ADMIN };
    expect(publicPressKit(kit, new Map([[ID, file]])).assets).toEqual([{ id: ID, title: 'Logo', description: '', contentType: 'image/png', bytes: 10, width: 100, height: 50, fileName: 'logo.png' }]);
    expect(publicPressKit(kit, new Map()).assets).toEqual([]);
  });

  it('lists videos uploaded here, each once, with their type, size and name, and records those added and removed', () => {
    const VIDEO = '01900000-0000-7000-8000-0000000000bb';
    const withVideo = pressKitSchema.parse({ ...input, videos: [{ videoId: VIDEO, title: 'Convention speech' }] });
    expect(input.videos).toEqual([]);
    expect(pressKitSchema.safeParse({ ...withVideo, videos: [withVideo.videos[0], withVideo.videos[0]] }).success).toBe(false);
    expect(pressKitSchema.safeParse({ ...withVideo, videos: [{ videoId: '../x', title: 'Bad' }] }).success).toBe(false);
    const { kit, event } = ok(savePressKit(EMPTY_PRESS_KIT, withVideo, ADMIN, AT));
    expect(event?.payload).toMatchObject({ fields: ['about', 'contact', 'facts', 'assets', 'videos'], videosAdded: [VIDEO], videosRemoved: [] });
    const record = {
      videoId: VIDEO,
      area: 'communications' as const,
      courseId: null,
      contentType: 'video/mp4' as const,
      size: 1234,
      parts: 1,
      received: 1,
      ready: true,
      fileName: 'speech.mp4',
      uploadedAt: AT,
      uploadedBy: ADMIN,
    };
    expect(publicPressKit(kit, new Map(), new Map([[VIDEO, record]])).videos).toEqual([
      { videoId: VIDEO, title: 'Convention speech', description: '', contentType: 'video/mp4', bytes: 1234, fileName: 'speech.mp4' },
    ]);
    expect(publicPressKit(kit, new Map()).videos).toEqual([]);
    const removed = ok(savePressKit(kit, { ...withVideo, videos: [], basedOn: 1 }, ADMIN, AT));
    expect(removed.event?.payload).toMatchObject({ fields: ['videos'], videosRemoved: [VIDEO] });
  });

  it('refuses a bad email or phone, and a file listed twice', () => {
    expect(pressKitSchema.safeParse({ ...input, contact: { email: 'nope' } }).success).toBe(false);
    expect(pressKitSchema.safeParse({ ...input, contact: { phone: 'call me' } }).success).toBe(false);
    expect(pressKitSchema.safeParse({ ...input, assets: [input.assets[0], input.assets[0]] }).success).toBe(false);
  });
});

describe('the bot registry', () => {
  const input: CreateBotInput = {
    name: 'News bot',
    site: 'bluesky',
    handle: '@news.ustp.example',
    url: 'https://bsky.app/profile/news.ustp.example',
    purpose: 'Posts each news release from the feed.',
    operator: 'Communications team',
    runsOn: 'IFTTT',
    status: 'active',
    public: true,
    notes: 'Token held by the director.',
  };

  it('ledgers each change, with the fields that changed', () => {
    const { bot, event } = addBot(input, POST_ID, ADMIN, AT);
    expect(event).toMatchObject({ type: 'bot.changed', payload: { change: 'added', name: 'News bot', site: 'bluesky' } });
    expect(ok(updateBot(bot, { ...input, status: 'paused' }, 1, ADMIN, AT)).event).toMatchObject({ payload: { change: 'updated', fields: ['status'] } });
    expect(ok(updateBot(bot, input, 1, ADMIN, AT)).event).toBeNull();
    expect(ok(checkBot(bot, 1, ADMIN, LATER)).bot).toMatchObject({ checkedAt: LATER, version: 2 });
  });

  it('is due a check after 30 days', () => {
    const bot: BotRecord = addBot(input, POST_ID, ADMIN, AT).bot;
    expect(botCheckDue(bot, new Date('2026-11-20T00:00:00Z'))).toBe(false);
    expect(botCheckDue(bot, new Date('2026-12-01T00:00:00Z'))).toBe(true);
    expect(botCheckDue({ ...bot, status: 'paused' }, new Date('2027-12-01T00:00:00Z'))).toBe(false);
  });

  it('lists in public only bots marked public and not retired, without the team’s notes', () => {
    const shown = addBot(input, 'a', ADMIN, AT).bot;
    const hidden = addBot({ ...input, public: false }, 'b', ADMIN, AT).bot;
    const retired = addBot({ ...input, status: 'retired' }, 'c', ADMIN, AT).bot;
    expect(publicBots([shown, hidden, retired])).toEqual([
      { botId: 'a', name: 'News bot', site: 'bluesky', handle: '@news.ustp.example', url: input.url, purpose: input.purpose, status: 'active' },
    ]);
  });
});
