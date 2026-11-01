import { DEFAULT_HUB, VIDEO_UPLOAD, uuidv7, type Hub, type HubLink } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HubService } from './administration/hub.js';
import { resetEmulators, TestApi } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());
/** A System Admin, made afresh for each test. */
let sa: Awaited<ReturnType<TestApi['systemAdmins']>>[number];
beforeEach(async () => {
  await resetEmulators();
  [sa] = await api.systemAdmins();
});

const PART = VIDEO_UPLOAD.partBytes;
const SIZE = PART + 1000;

/** An "MP4" of SIZE bytes: a real `ftyp` box, then a pattern that shows which bytes came back. */
function mp4(size = SIZE): Buffer {
  const file = Buffer.alloc(size);
  for (let i = 0; i < size; i++) file[i] = i % 251;
  Buffer.from([0, 0, 0, 0x18]).copy(file, 0);
  Buffer.from('ftypmp42\0\0\0\0mp42isom', 'latin1').copy(file, 4);
  return file;
}

/** A member made Course Administrator, after the courses have been seeded. */
async function courseAdmin(email: string) {
  await api.call('GET', '/v1/public/courses/transhumanism');
  const editor = await api.member(email);
  await api.grant(editor.accountId, 'course_admin', sa);
  return editor;
}

type Editor = Awaited<ReturnType<typeof courseAdmin>>;
const videos = '/v1/admin/courses/transhumanism/videos';
const part = (videoId: string, index: number) => `${videos}/${videoId}/parts/${index}`;

/** Uploads the file whole, a part at a time, where `base` takes uploads, and gives its ID. */
async function upload(editor: Editor, file: Buffer, contentType = 'video/mp4', base = videos, fileName = ''): Promise<string> {
  const started = await api.call('POST', base, editor, { contentType, size: file.length, fileName });
  expect(started.status).toBe(201);
  const { videoId, parts } = started.body as { videoId: string; parts: number };
  for (let index = 0; index < parts; index++) {
    expect((await api.upload(`${base}/${videoId}/parts/${index}`, editor, file.subarray(index * PART, (index + 1) * PART), contentType)).status).toBe(200);
  }
  return videoId;
}

const play = (videoId: string, range?: string) =>
  api.app.inject({ method: 'GET', url: `/v1/public/videos/${videoId}`, headers: range ? { range } : {} });

const lesson = {
  order: 50,
  title: 'Watch first',
  summary: 'A lesson with a video.',
  body: 'The video comes before this text.',
  estimatedMinutes: 5,
  questions: [{ prompt: 'Did you watch it?', choices: ['Yes', 'No'], correctIndex: 0, explanation: 'Good.' }],
};

describe('Lesson video uploads', () => {
  it('take an MP4 a part at a time, in order, from Course Administrators only', async () => {
    const editor = await courseAdmin('video-editor@example.test');
    const learner = await api.member('video-learner@example.test');
    expect((await api.call('POST', videos, learner, { contentType: 'video/mp4', size: SIZE })).status).toBe(403);
    expect((await api.call('POST', videos, editor, { contentType: 'video/quicktime', size: SIZE })).status).toBe(400);
    expect((await api.call('POST', videos, editor, { contentType: 'video/mp4', size: VIDEO_UPLOAD.maxBytes + 1 })).status).toBe(400);
    expect((await api.call('POST', '/v1/admin/courses/no-such-course/videos', editor, { contentType: 'video/mp4', size: SIZE })).status).toBe(404);

    const started = await api.call('POST', videos, editor, { contentType: 'video/mp4', size: SIZE });
    expect(started.status).toBe(201);
    expect(started.body).toEqual({ videoId: expect.any(String), parts: 2, partBytes: PART, received: 0, ready: false });
    const { videoId } = started.body as { videoId: string };
    const file = mp4();
    const first = file.subarray(0, PART);
    const second = file.subarray(PART);

    expect((await api.upload(part(videoId, 0), learner, first, 'video/mp4')).status).toBe(403);
    expect((await api.upload(part(videoId, 1), editor, second, 'video/mp4')).body.detail).toBe('send part 0 first');
    expect((await api.upload(part(videoId, 0), editor, second, 'video/mp4')).body.detail).toBe(`part 0 must be ${PART} bytes`);
    expect((await api.upload(part(videoId, 0), editor, first, 'video/webm')).body.detail).toBe('this upload is an MP4 video');
    expect((await api.upload(part(videoId, 0), editor, Buffer.alloc(PART), 'video/mp4')).body.detail).toMatch(/not an MP4 video/);
    expect((await api.upload(part(videoId, 2), editor, second, 'video/mp4')).status).toBe(404);
    expect((await api.upload(`/v1/admin/courses/allies/videos/${videoId}/parts/0`, editor, first, 'video/mp4')).status).toBe(404);
    expect((await api.upload(part(uuidv7(), 0), editor, first, 'video/mp4')).status).toBe(404);
    expect((await api.upload(part(videoId, 0), editor, first.subarray(0, 1000), 'image/png')).body.detail).toBe('this upload is an MP4 video');

    expect((await api.upload(part(videoId, 0), editor, first, 'video/mp4')).body).toMatchObject({ received: 1, ready: false });
    // Resent, as when its answer was lost: kept as it was.
    expect((await api.upload(part(videoId, 0), editor, first, 'video/mp4')).body).toMatchObject({ received: 1, ready: false });
    expect((await play(videoId, 'bytes=0-')).statusCode).toBe(404);
    expect((await api.upload(part(videoId, 1), editor, second, 'video/mp4')).body).toMatchObject({ received: 2, ready: true });
    expect((await api.upload(part(videoId, 1), editor, second, 'video/mp4')).body).toMatchObject({ received: 2, ready: true });
  });

  it('refuse a file that is not the kind of video it said', async () => {
    const editor = await courseAdmin('video-kinds@example.test');
    const started = await api.call('POST', videos, editor, { contentType: 'video/webm', size: 1000 });
    const { videoId } = started.body as { videoId: string };
    expect((await api.upload(part(videoId, 0), editor, mp4(1000), 'video/webm')).body.detail).toMatch(/not a WebM video/);
  });

  it('play back to anyone by byte range, a part at most per answer, and whole without one', async () => {
    const editor = await courseAdmin('video-player@example.test');
    const file = mp4();
    const videoId = await upload(editor, file);

    const opening = await play(videoId, 'bytes=0-');
    expect(opening.statusCode).toBe(206);
    expect(opening.headers).toMatchObject({
      'content-type': 'video/mp4',
      'content-range': `bytes 0-${PART - 1}/${SIZE}`,
      'content-length': String(PART),
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=31536000, immutable',
    });
    expect(opening.rawPayload.equals(file.subarray(0, PART))).toBe(true);

    const across = await play(videoId, `bytes=${PART - 10}-${PART + 9}`);
    expect(across.headers['content-range']).toBe(`bytes ${PART - 10}-${PART - 1}/${SIZE}`);
    expect(across.rawPayload.equals(file.subarray(PART - 10, PART))).toBe(true);

    const rest = await play(videoId, `bytes=${PART + 5}-`);
    expect(rest.headers['content-range']).toBe(`bytes ${PART + 5}-${SIZE - 1}/${SIZE}`);
    expect(rest.rawPayload.equals(file.subarray(PART + 5))).toBe(true);

    const tail = await play(videoId, 'bytes=-100');
    expect(tail.rawPayload.equals(file.subarray(SIZE - 100))).toBe(true);

    const whole = await play(videoId);
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['transfer-encoding']).toBe('chunked');
    expect(whole.rawPayload.equals(file)).toBe(true);

    const past = await play(videoId, `bytes=${SIZE}-`);
    expect(past.statusCode).toBe(416);
    expect(past.headers['content-range']).toBe(`bytes */${SIZE}`);

    expect((await play(uuidv7(), 'bytes=0-')).statusCode).toBe(404);
    expect((await play('..%2Fsecret', 'bytes=0-')).statusCode).toBe(404);
  });
});

describe('Lessons with videos', () => {
  it('keep a YouTube video or a finished upload, and show it once the course is published', async () => {
    const editor = await courseAdmin('video-lessons@example.test');
    const save = (body: object) => api.call('POST', '/v1/admin/courses/transhumanism/lessons', editor, body);
    const youtube = { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', start: 42 };

    expect((await save({ ...lesson, video: { kind: 'youtube', youtubeId: 'nope', start: 0 } })).status).toBe(400);
    expect((await save({ ...lesson, video: { kind: 'upload', videoId: uuidv7() } })).body.detail).toMatch(/not one uploaded here/);
    const started = await api.call('POST', videos, editor, { contentType: 'video/mp4', size: SIZE });
    expect((await save({ ...lesson, video: { kind: 'upload', videoId: started.body.videoId } })).body.detail).toMatch(/not finished uploading/);

    const watched = await save({ ...lesson, video: youtube });
    expect(watched.status).toBe(201);
    expect(watched.body.video).toEqual(youtube);
    const videoId = await upload(editor, mp4());
    const uploaded = await save({ ...lesson, order: 51, title: 'Our own video', video: { kind: 'upload', videoId } });
    expect(uploaded.status).toBe(201);
    const plain = await save({ ...lesson, order: 52, title: 'No video' });
    expect(plain.body.video).toBeNull();

    const draft = (await api.call('GET', '/v1/admin/courses/transhumanism', editor)).body.lessons as { lessonId: string; video: unknown }[];
    expect(draft.find((l) => l.lessonId === watched.body.lessonId)!.video).toEqual(youtube);
    // Seeded lessons were saved before videos, and read as having none.
    expect(draft.find((l) => l.lessonId === 'foundations')!.video).toBeNull();
    const before = (await api.call('GET', '/v1/public/courses/transhumanism')).body.lessons as { lessonId: string }[];
    expect(before.some((l) => l.lessonId === watched.body.lessonId)).toBe(false);

    expect((await api.call('POST', '/v1/admin/courses/transhumanism/publish', editor)).status).toBe(201);
    const published = (await api.call('GET', '/v1/public/courses/transhumanism')).body.lessons as { lessonId: string; video: unknown }[];
    expect(published.find((l) => l.lessonId === watched.body.lessonId)!.video).toEqual(youtube);
    expect(published.find((l) => l.lessonId === uploaded.body.lessonId)!.video).toEqual({ kind: 'upload', videoId });
    expect(published.find((l) => l.lessonId === plain.body.lessonId)!.video).toBeNull();
    expect(published.find((l) => l.lessonId === 'foundations')!.video).toBeNull();
    const learner = await api.member('video-watcher@example.test');
    const view = (await api.call('GET', '/v1/courses/transhumanism', learner)).body.lessons as { lessonId: string; video: unknown }[];
    expect(view.find((l) => l.lessonId === uploaded.body.lessonId)!.video).toEqual({ kind: 'upload', videoId });

    const pkg = (await api.call('GET', '/v1/admin/courses/transhumanism/package?version=draft', editor)).body;
    expect(pkg.lessons.find((l: { lessonId: string }) => l.lessonId === watched.body.lessonId).video).toEqual(youtube);
  });
});

/** A Communications Admin, who uploads for news and the press kit, and may edit the hub. */
async function communicationsAdmin(email: string) {
  const comms = await api.member(email);
  await api.grant(comms.accountId, 'communications_admin', sa);
  return comms;
}

const commsVideos = '/v1/admin/communications/videos';
const hubVideos = '/v1/admin/hub/videos';
const youtube = { kind: 'youtube', youtubeId: 'dQw4w9WgXcQ', start: 0 } as const;
const NEWS = {
  kind: 'news',
  title: 'The convention, on video',
  summary: 'Watch the opening speech.',
  body: 'The opening speech is above.',
  slug: 'convention-video',
};

describe('Videos for news, the press kit and the hub', () => {
  it('are uploaded by each area’s own admins, and a part goes only where its upload began', async () => {
    const comms = await communicationsAdmin('video-comms@example.test');
    const editor = await courseAdmin('video-course@example.test');
    const start = (base: string, by: Editor) => api.call('POST', base, by, { contentType: 'video/mp4', size: 1000 });
    expect((await start(commsVideos, editor)).status).toBe(403);
    expect((await start(videos, comms)).status).toBe(403);
    expect((await start(hubVideos, editor)).status).toBe(403);
    expect((await start(hubVideos, sa)).status).toBe(201);
    const { videoId } = (await start(commsVideos, comms)).body as { videoId: string };
    expect((await api.upload(`${hubVideos}/${videoId}/parts/0`, comms, mp4(1000), 'video/mp4')).status).toBe(404);
    expect((await api.upload(`${commsVideos}/${videoId}/parts/0`, comms, mp4(1000), 'video/mp4')).body).toMatchObject({ ready: true });
  });

  it('go on a news post, as a YouTube video or a finished upload, and show once it is published', async () => {
    const comms = await communicationsAdmin('video-news@example.test');
    const news = (body: object) => api.call('POST', '/v1/admin/communications/news', comms, { ...NEWS, ...body });
    expect((await news({ video: { kind: 'upload', videoId: uuidv7() } })).body.detail).toMatch(/not one uploaded here/);
    const videoId = await upload(comms, mp4(1000), 'video/mp4', commsVideos);
    const post = await news({ video: { kind: 'upload', videoId } });
    expect(post.status).toBe(201);
    expect(post.body.video).toEqual({ kind: 'upload', videoId });
    const { postId, version, slug, kind, title, summary, body, dateline, hashtags } = post.body;
    const edited = await api.call('PUT', `/v1/admin/communications/news/${postId}`, comms, { slug, kind, title, summary, body, dateline, hashtags, video: youtube, basedOn: version });
    expect(edited.body.video).toEqual(youtube);
    expect((await api.call('POST', `/v1/admin/communications/news/${postId}/publish`, comms, { basedOn: edited.body.version })).status).toBe(201);
    expect((await api.call('GET', `/v1/news/${slug}`)).body).toMatchObject({ status: 'published', video: youtube });
  });

  it('are listed in the press kit, to play or download under their own name', async () => {
    const comms = await communicationsAdmin('video-press@example.test');
    const kit = { basedOn: 0, about: 'The USTP.', contact: {}, facts: [], assets: [] };
    const save = (videos: object[]) => api.call('PUT', '/v1/admin/communications/press-kit', comms, { ...kit, videos });
    expect((await save([{ videoId: uuidv7(), title: 'Missing' }])).body.detail).toMatch(/not one uploaded here/);
    const file = mp4(1000);
    const videoId = await upload(comms, file, 'video/mp4', commsVideos, 'Convention speech (2026).mp4');
    expect((await save([{ videoId, title: 'Convention speech', description: 'The opening, in full.' }])).status).toBe(200);
    const press = (await api.call('GET', '/v1/press')).body;
    expect(press.kit.videos).toEqual([
      { videoId, title: 'Convention speech', description: 'The opening, in full.', contentType: 'video/mp4', bytes: 1000, fileName: 'Convention-speech-2026.mp4' },
    ]);
    const download = await api.app.inject({ method: 'GET', url: `/v1/public/videos/${videoId}?download=1` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toBe('attachment; filename="Convention-speech-2026.mp4"');
    expect(download.rawPayload.equals(file)).toBe(true);
    expect((await play(videoId, 'bytes=0-')).headers['content-disposition']).toBeUndefined();
  });

  it('play from a hub link, which then needs no address, once the upload is finished', async () => {
    api.app.get(HubService).invalidate();
    const link = (video: object | null, url = ''): HubLink =>
      ({ id: 'opening', title: 'Watch the opening', subtitle: '', url, video, icon: 'video', shown: true, iconRow: false, featured: true }) as HubLink;
    const put = (links: HubLink[]) =>
      api.call('PUT', '/v1/admin/hub', sa, { basedOn: 0, ...DEFAULT_HUB, sections: [{ id: 'watch', title: 'Watch', shown: true, links }] } satisfies Hub & { basedOn: number });
    expect((await put([link(null)])).body.detail).toMatch(/needs an address or a video/);
    const started = await api.call('POST', hubVideos, sa, { contentType: 'video/mp4', size: 1000 });
    expect((await put([link({ kind: 'upload', videoId: started.body.videoId })])).body.detail).toMatch(/not finished uploading/);
    const videoId = await upload(sa, mp4(1000), 'video/mp4', hubVideos);
    expect((await put([link({ kind: 'upload', videoId })])).status).toBe(200);
    const hub = (await api.call('GET', '/v1/hub')).body;
    expect(hub.sections[0].links[0]).toMatchObject({ id: 'opening', url: '', video: { kind: 'upload', videoId } });
  });
});
