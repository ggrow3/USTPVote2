import sharp from 'sharp';
import { Collections, coursePackageSchema, coursesPackageSchema } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_SEED, partyCourses } from './course/content-seed.js';
import { COMBINE_SEED, combinedCourses } from './course/course-combine-seed.js';
import { DRAFT_SUMMARY, MAP_SEED, mapCourses } from './course/course-map-seed.js';
import { resetEmulators, TestApi } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());
beforeEach(async () => resetEmulators());

const png = (width: number, height = width) =>
  sharp({ create: { width, height, channels: 3, background: { r: 11, g: 41, b: 72 } } }).png().toBuffer();

/** A member made Course Administrator, after the course has been seeded. */
async function courseAdmin(email: string) {
  await api.call('GET', '/v1/public/courses/transhumanism');
  const [sa] = await api.systemAdmins();
  const editor = await api.member(email);
  await api.grant(editor.accountId, 'course_admin', sa);
  return editor;
}

/** Marks the courses as combined already, for a test of the map as it was seeded before (design §10.8). */
const skipCombining = () => api.firebase.db.collection(Collections.courseSeeds).doc(COMBINE_SEED).create({ seed: COMBINE_SEED, seededAt: '2026-11-01T00:00:00.000Z' });

const draftProfile = {
  order: 100,
  name: 'Draft only',
  category: 'ethical_technology_thinker',
  biography: 'A profile that intentionally lacks a portrait while it is being drafted.',
  ideas: ['Careful attribution'],
  quote: 'Draft quote.',
  quoteSource: 'Draft source',
  quoteUrl: 'https://example.test/quote',
  portraitImage: null,
  portraitUrl: null,
  portraitAlt: '',
  portraitCredit: null,
  portraitLicense: null,
  portraitSourceUrl: null,
  furtherReadingUrl: 'https://example.test/read',
};

describe('Transhumanism course', () => {
  it('keeps lessons public, awards a private certificate after all passing quizzes, and supports public verification', async () => {
    const publicCourse = await api.call('GET', '/v1/public/courses/transhumanism');
    expect(publicCourse.status).toBe(200);
    expect(publicCourse.body.lessons).toHaveLength(6);
    expect(publicCourse.body.lessons[0].questions).toHaveLength(5);
    expect(publicCourse.body.lessons[0].questions[0]).not.toHaveProperty('correctIndex');
    expect(publicCourse.body.profiles.length).toBeGreaterThanOrEqual(18);

    const learner = await api.member('learner@example.test');
    expect((await api.call('GET', '/v1/courses/transhumanism', learner)).body.progress).toBeNull();
    expect((await api.call('POST', '/v1/courses/transhumanism/lessons/foundations/attempts', learner, { answers: [0, 0, 0, 0, 0] })).body.attempt).toMatchObject({ passed: false, score: 20 });

    const [sa] = await api.systemAdmins();
    const editor = await api.member('course-editor@example.test');
    await api.grant(editor.accountId, 'course_admin', sa);
    expect((await api.call('GET', '/v1/admin/courses/transhumanism', learner)).status).toBe(403);
    const admin = await api.call('GET', '/v1/admin/courses/transhumanism', editor);
    expect(admin.status).toBe(200);
    expect(admin.body.lessons[0].questions[0]).toHaveProperty('correctIndex');

    for (const lesson of admin.body.lessons) {
      const answers = lesson.questions.map((question: { correctIndex: number }) => question.correctIndex);
      expect((await api.call('POST', `/v1/courses/transhumanism/lessons/${lesson.lessonId}/attempts`, learner, { answers })).body.attempt).toMatchObject({ passed: true, score: 100 });
    }
    const view = await api.call('GET', '/v1/courses/transhumanism', learner);
    const certificateId = view.body.certificate.certificateId as string;
    expect(view.body.progress.completedLessonIds).toHaveLength(6);
    expect((await api.call('GET', '/v1/courses/transhumanism/certificate.pdf', learner)).contentType).toContain('application/pdf');

    const verified = await api.call('GET', `/v1/public/certificates/${certificateId}`);
    expect(verified.body).toMatchObject({ valid: true, courseVersion: 1 });
    expect(verified.body).not.toHaveProperty('recipientName');
    await api.call('POST', `/v1/admin/certificates/${certificateId}/revoke`, editor, { reason: 'test revocation' });
    expect((await api.call('GET', `/v1/public/certificates/${certificateId}`)).body).toEqual({ valid: false, courseId: null, courseTitle: null, courseVersion: null, issuedAt: null, holderName: null });
  });

  it('exports the draft or a published version as a ustp.course JSON file, for Course Administrators only', async () => {
    const [sa] = await api.systemAdmins();
    const editor = await api.member('exporter@example.test');
    const learner = await api.member('curious@example.test');
    await api.grant(editor.accountId, 'course_admin', sa);
    const url = (version?: string) => `/v1/admin/courses/transhumanism/package${version ? `?version=${version}` : ''}`;

    const published = await api.call('GET', url('1'), editor);
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ format: 'ustp.course', version: 1, source: { content: 'published', courseVersion: 1 } });
    expect(published.body.lessons).toHaveLength(6);
    expect(published.body.lessons[0].questions[0]).toHaveProperty('correctIndex');
    // Every lesson and profile is what the save routes take.
    expect(coursePackageSchema.safeParse(published.body).error?.issues ?? []).toEqual([]);
    expect(JSON.stringify(published.body)).not.toContain('course-seed');

    // The draft follows edits; the published version stays frozen.
    const [first] = published.body.lessons;
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/lessons', editor, { ...first, title: 'Edited title' })).status).toBe(201);
    const draft = await api.call('GET', url(), editor);
    expect(draft.body.source).toMatchObject({ content: 'draft', status: 'draft', publishedVersion: 1 });
    expect(draft.body.lessons[0].title).toBe('Edited title');
    expect(JSON.stringify(draft.body)).not.toContain(editor.accountId);
    expect((await api.call('GET', url('1'), editor)).body.lessons[0].title).toBe(first.title);

    expect((await api.call('GET', url(), learner)).status).toBe(403);
    expect((await api.call('GET', url('7'), editor)).status).toBe(404);
    expect((await api.call('GET', url('latest'), editor)).status).toBe(400);
    expect((await api.call('GET', '/v1/admin/courses/nope/package', editor)).status).toBe(404);
  });

  it('exports every course with the map as one ustp.courses JSON file, for Course Administrators only', async () => {
    const editor = await courseAdmin('export-all@example.test');
    const learner = await api.member('export-all-learner@example.test');
    const url = '/v1/admin/course-map/package';
    await api.call('POST', '/v1/admin/courses', editor, { title: 'Futures Lab', summary: 'Hands-on.' });
    expect((await api.call('PUT', '/v1/admin/courses/futures-lab/visibility', editor, { hidden: true })).status).toBe(200);
    const [first] = (await api.call('GET', '/v1/admin/courses/transhumanism/package?version=1', editor)).body.lessons;
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/lessons', editor, { ...first, title: 'Edited title' })).status).toBe(201);

    const exported = await api.call('GET', url, editor);
    expect(exported.status).toBe(200);
    const pkg = exported.body;
    expect(pkg).toMatchObject({ format: 'ustp.courses', version: 1, map: { rows: 8, columns: 6 } });
    expect(coursesPackageSchema.safeParse(pkg).error?.issues ?? []).toEqual([]);
    // Every course, hidden ones and drafts included, in the Course tab's map order, each where it sits.
    const courses = (await api.call('GET', '/v1/admin/courses', editor)).body as { courseId: string; hidden: boolean; prerequisites: string[]; position: unknown }[];
    expect(pkg.courses.map((course: { courseId: string }) => course.courseId)).toEqual(courses.map((course) => course.courseId));
    for (const [i, course] of courses.entries()) {
      expect(pkg.courses[i]).toMatchObject({ hidden: course.hidden, prerequisites: course.prerequisites, position: course.position });
    }
    const byId = new Map(pkg.courses.map((course: { courseId: string }) => [course.courseId, course]));
    expect(byId.get('futures-lab')).toMatchObject({ hidden: true, position: null, published: null, draft: { source: { content: 'draft', publishedVersion: null } } });

    // Each course's draft and current version are the files Export JSON gives for that course.
    const transhumanism = byId.get('transhumanism') as { draft: { lessons: { title: string }[] }; published: { lessons: { title: string }[] } };
    expect(transhumanism.draft.lessons[0]!.title).toBe('Edited title');
    expect(transhumanism.published.lessons[0]!.title).toBe(first.title);
    const single = async (version: string) => ({ ...(await api.call('GET', `/v1/admin/courses/transhumanism/package?version=${version}`, editor)).body, exportedAt: pkg.exportedAt });
    expect(transhumanism.draft).toEqual(await single('draft'));
    expect(transhumanism.published).toEqual(await single('1'));
    expect(JSON.stringify(pkg)).not.toContain(editor.accountId);

    expect((await api.call('GET', url, learner)).status).toBe(403);
    expect((await api.call('GET', url)).status).toBe(401);
    const fromElsewhere = await api.app.inject({ method: 'GET', url, headers: { origin: 'https://another-site.example' } });
    expect(fromElsewhere.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('gives anyone a published course as its ustp.course file, which any site may read from a browser', async () => {
    const editor = await courseAdmin('public-file@example.test');
    const url = '/v1/public/courses/transhumanism/package';
    const fromElsewhere = (path: string) => api.app.inject({ method: 'GET', url: path, headers: { origin: 'https://another-site.example' } });

    const current = await fromElsewhere(url);
    expect(current.statusCode).toBe(200);
    expect(current.headers['access-control-allow-origin']).toBe('*');
    const pkg = current.json();
    expect(pkg).toMatchObject({ format: 'ustp.course', version: 1, source: { content: 'published', courseVersion: 1 } });
    expect(pkg.lessons[0].questions[0]).toHaveProperty('correctIndex');
    expect(pkg.lessons[0].video).toBeNull();
    expect(coursePackageSchema.safeParse(pkg).error?.issues ?? []).toEqual([]);
    // The file a Course Administrator exports of that version.
    const exported = (await api.call('GET', '/v1/admin/courses/transhumanism/package?version=1', editor)).body;
    expect({ ...pkg, exportedAt: null }).toEqual({ ...exported, exportedAt: null });

    // An edit stays in the draft until it is published; then the file is the new version, and the old one stays.
    const [first] = pkg.lessons;
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/lessons', editor, { ...first, title: 'Edited title' })).status).toBe(201);
    expect((await api.call('GET', url)).body.lessons[0].title).toBe(first.title);
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/publish', editor)).status).toBe(201);
    const republished = (await api.call('GET', url)).body;
    expect(republished.source.courseVersion).toBe(2);
    expect(republished.lessons[0].title).toBe('Edited title');
    expect((await api.call('GET', `${url}?version=1`)).body.lessons[0].title).toBe(first.title);
    expect((await api.call('GET', `${url}?version=3`)).status).toBe(404);
    expect((await api.call('GET', `${url}?version=draft`)).status).toBe(400);

    // A course never published has no file; its 404 can be read from another site too.
    await api.call('POST', '/v1/admin/courses', editor, { title: 'Futures Lab', summary: 'Hands-on.' });
    const draft = await fromElsewhere('/v1/public/courses/futures-lab/package');
    expect(draft.statusCode).toBe(404);
    expect(draft.headers['access-control-allow-origin']).toBe('*');
    expect((await fromElsewhere('/v1/public/courses')).headers['access-control-allow-origin']).toBe('*');
    expect((await fromElsewhere('/v1/public/courses/transhumanism')).headers['access-control-allow-origin']).toBe('*');
    // Nothing else is open to other sites.
    for (const other of ['/v1/courses', '/v1/public/positions', '/v1/admin/courses/transhumanism/package']) {
      expect((await fromElsewhere(other)).headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('rejects publishing a profile without complete portrait attribution', async () => {
    const editor = await courseAdmin('draft-editor@example.test');
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/profiles', editor, draftProfile)).status).toBe(201);
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/publish', editor)).body.detail).toMatch(
      /credited, open-licence portrait: Draft only has no portrait yet/,
    );
  });

  it('takes quizzes of one to ten questions with two to six choices, and tells learners how each answer went', async () => {
    const editor = await courseAdmin('quiz-editor@example.test');
    const question = (prompt: string, choices: string[], correctIndex: number, questionId?: string) => ({
      ...(questionId && { questionId }),
      prompt,
      choices,
      correctIndex,
      explanation: `Why: ${prompt}`,
    });
    const save = (questions: unknown[]) =>
      api.call('POST', '/v1/admin/courses/transhumanism/lessons', editor, {
        order: 7,
        title: 'Short quiz',
        summary: 'Three questions.',
        body: 'Read this.',
        estimatedMinutes: 5,
        questions,
      });

    expect((await save([])).status).toBe(400);
    expect((await save(Array.from({ length: 11 }, (_, i) => question(`Q${i}`, ['a', 'b'], 0)))).status).toBe(400);
    expect((await save([question('One choice', ['only'], 0)])).status).toBe(400);
    expect((await save([question('Seven choices', ['1', '2', '3', '4', '5', '6', '7'], 0)])).status).toBe(400);
    expect((await save([question('Out of range', ['a', 'b'], 2)])).status).toBe(400);
    expect((await save([question('Twin', ['a', 'b'], 0, 'same'), question('Twin', ['a', 'b'], 1, 'same')])).status).toBe(400);

    const saved = await save([
      question('Yes or no?', ['Yes', 'No'], 1, 'kept'),
      question('Pick six', ['1', '2', '3', '4', '5', '6'], 5),
      question('Pick three', ['a', 'b', 'c'], 0),
    ]);
    expect(saved.status).toBe(201);
    const ids = saved.body.questions.map((q: { questionId: string }) => q.questionId);
    expect(ids[0]).toBe('kept');
    expect(new Set(ids).size).toBe(3);
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/publish', editor)).status).toBe(201);

    const learner = await api.member('quiz-learner@example.test');
    const attempt = (answers: number[]) =>
      api.call('POST', `/v1/courses/transhumanism/lessons/${saved.body.lessonId}/attempts`, learner, { answers });
    expect((await attempt([1, 5])).body.detail).toMatch(/this quiz has 3/);
    expect((await attempt([1, 5, 3])).status).toBe(400);
    const tried = await attempt([1, 5, 1]);
    expect(tried.body.attempt).toMatchObject({ score: 67, passed: false });
    expect(tried.body.feedback).toEqual([
      { questionId: 'kept', correct: true, explanation: 'Why: Yes or no?' },
      { questionId: ids[1], correct: true, explanation: 'Why: Pick six' },
      { questionId: ids[2], correct: false, explanation: 'Why: Pick three' },
    ]);
    expect((await attempt([1, 5, 0])).body.attempt).toMatchObject({ score: 100, passed: true });
    const lessons = (await api.call('GET', '/v1/public/courses/transhumanism')).body.lessons as { lessonId: string; questions: unknown[] }[];
    expect(lessons.find((l) => l.lessonId === saved.body.lessonId)!.questions[1]).toEqual({
      questionId: ids[1],
      prompt: 'Pick six',
      choices: ['1', '2', '3', '4', '5', '6'],
    });
  });

  it('stores uploaded portraits on this server, serves them to anyone, and publishes profiles that use them', async () => {
    const editor = await courseAdmin('photo-editor@example.test');
    const learner = await api.member('photo-learner@example.test');
    const url = '/v1/admin/courses/transhumanism/images';
    expect((await api.upload(url, learner, await png(400), 'image/png')).status).toBe(403);
    expect((await api.upload(url, editor, await png(150, 400), 'image/png')).body.detail).toMatch(/at least 200×200/);
    expect((await api.upload(url, editor, Buffer.from('not an image'), 'image/png')).status).toBe(400);

    const uploaded = await api.upload(url, editor, await png(1200, 1600), 'image/png');
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({ image: expect.stringMatching(/^[0-9a-f]{64}$/), width: 600, height: 800 });
    const { image } = uploaded.body as { image: string };
    const served = await api.app.inject({ method: 'GET', url: `/v1/public/course-images/${image}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(await sharp(served.rawPayload).metadata()).toMatchObject({ format: 'webp', width: 600, height: 800 });
    expect((await api.app.inject({ method: 'GET', url: `/v1/public/course-images/${'c'.repeat(64)}` })).statusCode).toBe(404);
    expect((await api.app.inject({ method: 'GET', url: '/v1/public/course-images/..%2Fsecret' })).statusCode).toBe(404);

    const admin = (await api.call('GET', '/v1/admin/courses/transhumanism', editor)).body;
    const brin = admin.profiles.find((p: { profileId: string }) => p.profileId === 'david-brin');
    expect(brin.portraitImage).toBeNull();
    const { courseId: _course, updatedAt: _at, updatedBy: _by, ...fields } = brin;
    const portrait = {
      portraitImage: image,
      portraitUrl: null,
      portraitAlt: 'David Brin.',
      portraitCredit: 'Photo: a friend',
      portraitLicense: 'CC BY 4.0',
      portraitSourceUrl: null,
    };
    const saveProfile = (body: object) => api.call('POST', '/v1/admin/courses/transhumanism/profiles', editor, body);
    expect((await saveProfile({ ...fields, ...portrait, portraitUrl: brin.portraitUrl })).body.errors).toContainEqual({
      path: 'portraitUrl',
      message: 'use an uploaded photo or an image link, not both',
    });
    expect((await saveProfile({ ...fields, ...portrait, portraitCredit: null })).status).toBe(400);
    expect((await saveProfile({ ...fields, ...portrait, portraitImage: 'd'.repeat(64) })).body.detail).toMatch(/not one uploaded here/);
    expect((await saveProfile({ ...fields, ...portrait })).status).toBe(201);

    expect((await api.call('GET', '/v1/public/courses/transhumanism')).body.profiles[0].portraitImage).toBeNull();
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/publish', editor)).status).toBe(201);
    const published = (await api.call('GET', '/v1/public/courses/transhumanism')).body.profiles;
    expect(published[0]).toMatchObject({ profileId: 'david-brin', ...portrait });
    expect(published[1].portraitImage).toBeNull();
  });
});

type Learner = Awaited<ReturnType<TestApi['member']>>;

/** Passes every lesson of a published course as the learner, with the answers its Course Administrator can see. */
async function passCourse(courseId: string, learner: Learner, editor: Learner) {
  const admin = await api.call('GET', `/v1/admin/courses/${courseId}`, editor);
  for (const lesson of admin.body.lessons) {
    const answers = lesson.questions.map((question: { correctIndex: number }) => question.correctIndex);
    expect((await api.call('POST', `/v1/courses/${courseId}/lessons/${lesson.lessonId}/attempts`, learner, { answers })).status).toBe(201);
  }
}

const oneQuestionLesson = {
  order: 1,
  title: 'Where the lab starts',
  summary: 'A first lesson.',
  body: 'One paragraph.',
  estimatedMinutes: 5,
  questions: [{ prompt: 'Is this the first lesson?', choices: ['Yes', 'No'], correctIndex: 0, explanation: 'It is.' }],
};

const FIRST_TITLE = 'Transhumanism: Human Flourishing and Democratic Futures';

describe('Course map, students and instructor messages', () => {
  it('lists the first course on its own and the map courses as coming soon, joined by their prerequisites', async () => {
    const map = await api.call('GET', '/v1/public/courses');
    expect(map.status).toBe(200);
    expect(map.body.status).toBeUndefined();
    const courses = map.body.courses as { courseId: string; prerequisites: string[] }[];
    // The Coalition, Why the New York Transhumanist Party? and Introduction to Left Transhumanism are combined into
    // others, and gone, as never published.
    expect(courses.map((course) => course.courseId)).toEqual([
      'transhumanism',
      'fundamental-questions',
      'allies',
      'transhumanist-party',
      'new-york-transhumanist-party',
      'figures-of-transhumanism',
      'why-the-transhumanist-party',
      'historical-applied-projects',
    ]);
    expect(courses[0]).toMatchObject({ title: FIRST_TITLE, published: true, lessonCount: 6, prerequisites: [], position: { row: 0, column: 0 } });
    expect(courses.find((course) => course.courseId === 'allies')).toMatchObject({
      title: 'Allies of the Transhumanist Party',
      summary: null,
      published: false,
      prerequisites: ['fundamental-questions'],
      position: { row: 1, column: 1 },
    });
    expect(courses.find((course) => course.courseId === 'figures-of-transhumanism')!.prerequisites).toEqual(['transhumanist-party']);
    expect((await api.call('GET', '/v1/public/courses/allies')).status).toBe(404);

    const learner = await api.member('map-learner@example.test');
    const status = (await api.call('GET', '/v1/courses', learner)).body.status as { courseId: string }[];
    expect(status.find((s) => s.courseId === 'transhumanism')).toMatchObject({ state: 'not_started', lessonsPassed: 0, lessonCount: 6, missing: [] });
    expect(status.find((s) => s.courseId === 'allies')).toMatchObject({ state: 'locked', missing: ['fundamental-questions'] });
  });

  it('lets Course Administrators add, place and delete courses, refusing loops, taken squares and published courses', async () => {
    const editor = await courseAdmin('map-editor@example.test');
    const learner = await api.member('not-an-editor@example.test');
    expect((await api.call('POST', '/v1/admin/courses', learner, { title: 'Futures Lab', summary: 'Hands-on.' })).status).toBe(403);
    expect((await api.call('PUT', '/v1/admin/courses/a%2Fb/map', editor, { prerequisites: [], position: null })).status).toBe(404);

    const created = await api.call('POST', '/v1/admin/courses', editor, { title: 'Futures Lab', summary: 'Hands-on.' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ courseId: 'futures-lab', status: 'draft', publishedVersion: null, prerequisites: [], position: null });
    expect((await api.call('POST', '/v1/admin/courses', editor, { title: 'Futures lab!', summary: 'Again.' })).body.courseId).toBe('futures-lab-2');
    const listed = async () => ((await api.call('GET', '/v1/public/courses')).body.courses as { courseId: string }[]).map((course) => course.courseId);
    expect(await listed()).not.toContain('futures-lab');
    expect((await api.call('GET', '/v1/admin/courses', editor)).body.map((course: { courseId: string }) => course.courseId)).toContain('futures-lab');

    const placed = await api.call('PUT', '/v1/admin/courses/futures-lab/map', editor, { prerequisites: ['transhumanism'], position: { row: 3, column: 0 } });
    expect(placed.status).toBe(200);
    expect(await listed()).toContain('futures-lab');
    const loop = await api.call('PUT', '/v1/admin/courses/transhumanism/map', editor, { prerequisites: ['futures-lab'], position: { row: 0, column: 0 } });
    expect(loop.status).toBe(409);
    expect(loop.body.detail).toBe(`that makes a loop nobody could finish: ${FIRST_TITLE} → Futures Lab → ${FIRST_TITLE}`);
    const taken = await api.call('PUT', '/v1/admin/courses/futures-lab/map', editor, { prerequisites: [], position: { row: 0, column: 0 } });
    expect(taken.status).toBe(409);
    expect(taken.body.detail).toBe(`${FIRST_TITLE} is already on the map at row 1, column 1`);

    expect((await api.call('DELETE', '/v1/admin/courses/fundamental-questions', editor)).status).toBe(409);
    expect((await api.call('DELETE', '/v1/admin/courses/transhumanism', editor)).status).toBe(409);
    expect((await api.call('POST', '/v1/admin/courses/futures-lab-2/lessons', editor, oneQuestionLesson)).status).toBe(201);
    expect((await api.call('DELETE', '/v1/admin/courses/futures-lab-2', editor)).status).toBe(204);
    expect((await api.call('GET', '/v1/admin/courses/futures-lab-2', editor)).status).toBe(404);
  });

  it("saves the Course tab's board at once: swaps, new lines and a whole org chart, refusing loops and shared squares", async () => {
    await skipCombining();
    const editor = await courseAdmin('board-editor@example.test');
    const learner = await api.member('board-learner@example.test');
    const save = (by: typeof editor, courses: unknown[]) => api.call('PUT', '/v1/admin/course-map', by, { courses });
    const placement = async () =>
      Object.fromEntries(
        ((await api.call('GET', '/v1/admin/courses', editor)).body as { courseId: string; prerequisites: string[]; position: unknown }[]).map(
          (course) => [course.courseId, { prerequisites: course.prerequisites, position: course.position }],
        ),
      );
    expect((await save(learner, [{ courseId: 'allies', prerequisites: [], position: null }])).status).toBe(403);

    // The Coalition and Allies swap squares in one save, and The Coalition comes after The Figures of Transhumanism too.
    const swapped = await save(editor, [
      { courseId: 'the-coalition', prerequisites: ['allies', 'figures-of-transhumanism'], position: { row: 1, column: 1 } },
      { courseId: 'allies', prerequisites: ['fundamental-questions'], position: { row: 1, column: 0 } },
    ]);
    expect(swapped.status).toBe(200);
    expect((swapped.body as { courseId: string }[]).map((course) => course.courseId)[0]).toBe('transhumanism');
    const after = await placement();
    expect(after['the-coalition']).toEqual({ prerequisites: ['allies', 'figures-of-transhumanism'], position: { row: 1, column: 1 } });
    expect(after.allies).toEqual({ prerequisites: ['fundamental-questions'], position: { row: 1, column: 0 } });
    expect(after['fundamental-questions']).toEqual({ prerequisites: [], position: { row: 0, column: 2 } });

    // Nothing is saved when any part is refused.
    const loop = await save(editor, [
      { courseId: 'allies', prerequisites: [], position: { row: 5, column: 5 } },
      { courseId: 'fundamental-questions', prerequisites: ['the-coalition'], position: { row: 0, column: 2 } },
    ]);
    expect(loop.status).toBe(409);
    expect(loop.body.detail).toMatch(/^that makes a loop nobody could finish: The Fundamental Questions of Transhumanism → /);
    const shared = await save(editor, [{ courseId: 'allies', prerequisites: ['fundamental-questions'], position: { row: 0, column: 0 } }]);
    expect(shared.status).toBe(409);
    expect(shared.body.detail).toBe(`${FIRST_TITLE} is already on the map at row 1, column 1`);
    expect((await save(editor, [{ courseId: 'nowhere', prerequisites: [], position: null }])).body.detail).toBe('there is no course "nowhere"');
    expect((await save(editor, [{ courseId: 'allies', prerequisites: [], position: { row: 8, column: 0 } }])).status).toBe(400);
    expect(await placement()).toEqual(after);

    // Learners see the saved map at once.
    const map = (await api.call('GET', '/v1/public/courses')).body.courses as { courseId: string; position: unknown }[];
    expect(map.find((course) => course.courseId === 'allies')!.position).toEqual({ row: 1, column: 0 });
  });

  it('hides a course from the Courses page and shows it again, its page still open, never before a shown course', async () => {
    const editor = await courseAdmin('hide-editor@example.test');
    const learner = await api.member('hide-learner@example.test');
    const setHidden = (by: typeof editor, courseId: string, hidden: unknown) => api.call('PUT', `/v1/admin/courses/${courseId}/visibility`, by, { hidden });
    const listed = async (by?: typeof learner) => ((await api.call('GET', by ? '/v1/courses' : '/v1/public/courses', by)).body.courses as { courseId: string }[]).map((course) => course.courseId);
    const adminCourse = async (courseId: string) =>
      ((await api.call('GET', '/v1/admin/courses', editor)).body as { courseId: string; hidden: boolean }[]).find((course) => course.courseId === courseId)!;
    expect((await setHidden(learner, 'transhumanism', true)).status).toBe(403);
    expect((await setHidden(editor, 'nowhere', true)).status).toBe(404);
    expect((await setHidden(editor, 'transhumanism', 'yes')).status).toBe(400);
    expect(await adminCourse('transhumanism')).toMatchObject({ hidden: false });

    const hidden = await setHidden(editor, 'transhumanism', true);
    expect(hidden.status).toBe(200);
    expect(hidden.body).toMatchObject({ courseId: 'transhumanism', hidden: true, hiddenChangedBy: editor.accountId, publishedVersion: 1, position: { row: 0, column: 0 } });
    expect(await listed()).not.toContain('transhumanism');
    expect(await listed(learner)).not.toContain('transhumanism');
    expect(((await api.call('GET', '/v1/courses', learner)).body.status as { courseId: string }[]).map((s) => s.courseId)).not.toContain('transhumanism');
    expect(await adminCourse('transhumanism')).toMatchObject({ hidden: true, position: { row: 0, column: 0 } });
    expect((await api.call('GET', '/v1/admin/courses/transhumanism', editor)).body.course).toMatchObject({ hidden: true });
    // Still published and open at its address: its page, its quizzes.
    expect((await api.call('GET', '/v1/public/courses/transhumanism')).status).toBe(200);
    expect((await api.call('POST', '/v1/courses/transhumanism/lessons/foundations/attempts', learner, { answers: [0, 0, 0, 0, 0] })).status).toBe(201);
    expect((await setHidden(editor, 'transhumanism', true)).body.hiddenChangedAt).toBe(hidden.body.hiddenChangedAt);

    // A course shown on the page cannot come after a hidden one, on its own or on the board.
    const shownAfter = `${FIRST_TITLE} is hidden from the Courses page, so a course shown there cannot come after it: show it first`;
    const placed = await api.call('PUT', '/v1/admin/courses/allies/map', editor, { prerequisites: ['fundamental-questions', 'transhumanism'], position: null });
    expect(placed.status).toBe(409);
    expect(placed.body.detail).toBe(shownAfter);
    const board = await api.call('PUT', '/v1/admin/course-map', editor, { courses: [{ courseId: 'allies', prerequisites: ['transhumanism'], position: null }] });
    expect(board.body.detail).toBe(shownAfter);

    // Hiding waits until no course shown there comes after it: the last course of a chain first.
    const refused = await setHidden(editor, 'figures-of-transhumanism', true);
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toBe(
      'Historical Applied Projects comes after this course and is shown on the Courses page: hide it first, or take this course off its prerequisites',
    );
    expect((await setHidden(editor, 'historical-applied-projects', true)).status).toBe(200);
    expect((await setHidden(editor, 'figures-of-transhumanism', true)).status).toBe(200);
    expect(await listed()).not.toContain('figures-of-transhumanism');

    // Shown again: back on the page, on its square.
    expect((await setHidden(editor, 'transhumanism', false)).body).toMatchObject({ hidden: false, hiddenChangedBy: editor.accountId });
    expect(await listed()).toContain('transhumanism');
    expect((await api.call('GET', '/v1/public/courses')).body.courses[0]).toMatchObject({ courseId: 'transhumanism', position: { row: 0, column: 0 } });
    expect((await api.call('PUT', '/v1/admin/courses/allies/map', editor, { prerequisites: ['transhumanism'], position: null })).status).toBe(200);
  });

  it('opens quizzes only once the prerequisites are passed, while the lessons stay readable', async () => {
    const editor = await courseAdmin('lock-editor@example.test');
    await api.call('POST', '/v1/admin/courses', editor, { title: 'Futures Lab', summary: 'Hands-on.' });
    await api.call('POST', '/v1/admin/courses/futures-lab/lessons', editor, oneQuestionLesson);
    expect((await api.call('POST', '/v1/admin/courses/futures-lab/publish', editor)).body.version).toBe(1);
    await api.call('PUT', '/v1/admin/courses/futures-lab/map', editor, { prerequisites: ['transhumanism'], position: { row: 3, column: 0 } });

    const learner = await api.member('lock-learner@example.test');
    expect((await api.call('GET', '/v1/public/courses/futures-lab')).body.prerequisites).toEqual([{ courseId: 'transhumanism', title: FIRST_TITLE }]);
    const before = await api.call('GET', '/v1/courses/futures-lab', learner);
    expect(before.body.lessons).toHaveLength(1);
    expect(before.body.missingPrerequisites).toEqual([{ courseId: 'transhumanism', title: FIRST_TITLE }]);
    const lessonId = before.body.lessons[0].lessonId as string;
    const refused = await api.call('POST', `/v1/courses/futures-lab/lessons/${lessonId}/attempts`, learner, { answers: [0] });
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toBe(`pass ${FIRST_TITLE} first: this course's quizzes open once you have`);

    await passCourse('transhumanism', learner, editor);
    expect((await api.call('GET', '/v1/courses/futures-lab', learner)).body.missingPrerequisites).toEqual([]);
    expect((await api.call('POST', `/v1/courses/futures-lab/lessons/${lessonId}/attempts`, learner, { answers: [0] })).body.attempt.passed).toBe(true);
    const status = (await api.call('GET', '/v1/courses', learner)).body.status as { courseId: string; state: string }[];
    expect(status.filter((s) => ['transhumanism', 'futures-lab'].includes(s.courseId)).map((s) => s.state)).toEqual(['passed', 'passed']);
  });

  it('shows Course Administrators how each learner stands, without their email, and switches messaging per learner', async () => {
    const editor = await courseAdmin('status-editor@example.test');
    const learner = await api.member('status-learner@example.test');
    const other = await api.member('status-other@example.test');
    expect((await api.call('POST', '/v1/courses/transhumanism/lessons/foundations/attempts', learner, { answers: [0, 0, 0, 0, 0] })).status).toBe(201);
    expect((await api.call('POST', '/v1/courses/transhumanism/lessons/foundations/attempts', learner, { answers: [1, 1, 1, 1, 1] })).status).toBe(201);

    expect((await api.call('GET', '/v1/admin/courses/transhumanism/learners', learner)).status).toBe(403);
    const rows = await api.call('GET', '/v1/admin/courses/transhumanism/learners', editor);
    expect(rows.status).toBe(200);
    expect(rows.body).toHaveLength(1);
    expect(JSON.stringify(rows.body)).not.toContain('@example.test');
    expect(rows.body[0]).toMatchObject({ accountId: learner.accountId, version: 1, attempts: 2, certificate: null, messaging: false, unread: false });
    expect(rows.body[0].name).toMatch(/^Learner /);
    expect(rows.body[0].lessons).toHaveLength(6);
    expect(rows.body[0].lessons[0]).toMatchObject({ lessonId: 'foundations', title: 'Foundations: What is transhumanism?', bestScore: expect.any(Number) });
    expect(rows.body[0].lastActivityAt).toEqual(expect.any(String));

    // Off by default: nobody can write, either way round.
    expect((await api.call('GET', '/v1/courses/transhumanism/messages', learner)).body).toEqual({ messaging: false, messages: [] });
    expect((await api.call('POST', '/v1/courses/transhumanism/messages', learner, { body: 'Hello?' })).status).toBe(403);
    const learnerPath = `/v1/admin/courses/transhumanism/learners/${learner.accountId}`;
    expect((await api.call('POST', `${learnerPath}/messages`, editor, { body: 'Hi' })).status).toBe(409);
    expect((await api.call('PUT', `${learnerPath}/messaging`, learner, { messaging: true })).status).toBe(403);
    expect((await api.call('PUT', '/v1/admin/courses/transhumanism/learners/not-an-id/messaging', editor, { messaging: true })).status).toBe(404);

    expect((await api.call('PUT', `${learnerPath}/messaging`, editor, { messaging: true })).body).toMatchObject({ messaging: true, switchedBy: editor.accountId });
    expect((await api.call('GET', '/v1/courses/transhumanism', learner)).body.messaging).toBe(true);
    expect((await api.call('GET', '/v1/courses/transhumanism', other)).body.messaging).toBe(false);
    expect((await api.call('POST', '/v1/courses/transhumanism/messages', other, { body: 'Me too?' })).status).toBe(403);

    const sent = await api.call('POST', '/v1/courses/transhumanism/messages', learner, { body: 'What does healthspan mean?' });
    expect(sent.status).toBe(201);
    expect(sent.body.messages).toEqual([expect.objectContaining({ from: 'learner', body: 'What does healthspan mean?' })]);
    expect(sent.body.messages[0]).not.toHaveProperty('authorId');
    expect((await api.call('GET', '/v1/admin/courses/transhumanism/learners', editor)).body[0].unread).toBe(true);
    expect((await api.call('GET', `${learnerPath}/messages`, editor)).body.messages).toHaveLength(1);
    expect((await api.call('GET', '/v1/admin/courses/transhumanism/learners', editor)).body[0].unread).toBe(false);

    expect((await api.call('POST', `${learnerPath}/messages`, editor, { body: 'The years lived in good health.' })).status).toBe(201);
    const seen = (await api.call('GET', '/v1/courses/transhumanism/messages', learner)).body;
    expect(seen.messages.map((message: { from: string }) => message.from)).toEqual(['learner', 'instructor']);
    expect(seen.messages[1]).toMatchObject({ body: 'The years lived in good health.', authorName: expect.any(String) });
    expect(JSON.stringify(seen)).not.toContain(editor.accountId);

    // Off again: the history stays, and nobody can add to it.
    await api.call('PUT', `${learnerPath}/messaging`, editor, { messaging: false });
    expect((await api.call('POST', '/v1/courses/transhumanism/messages', learner, { body: 'One more thing' })).status).toBe(403);
    expect((await api.call('GET', '/v1/courses/transhumanism/messages', learner)).body).toMatchObject({ messaging: false, messages: [{}, {}] });
    expect((await api.call('GET', '/v1/admin/courses/transhumanism/learners', editor)).body[0].messaging).toBe(false);
  });
});

describe("The party's curriculum on its course map", () => {
  // As seeded, before the courses were combined (below).
  beforeEach(skipCombining);
  type AdminCourse = { course: { summary: string; status: string; publishedVersion: number | null }; lessons: { lessonId: string; questions: unknown[] }[] };
  const content = async (courseId: string, editor: Learner) => (await api.call('GET', `/v1/admin/courses/${courseId}`, editor)).body as AdminCourse;
  const placement = async (editor: Learner) =>
    Object.fromEntries(
      ((await api.call('GET', '/v1/admin/courses', editor)).body as { courseId: string; prerequisites: string[]; position: unknown }[]).map((course) => [
        course.courseId,
        { prerequisites: course.prerequisites, position: course.position },
      ]),
    );

  it("fills the map's drafts and adds two courses, as drafts whose quizzes open once their prerequisites are passed", async () => {
    const editor = await courseAdmin('curriculum-editor@example.test');
    const fundamentals = await content('fundamental-questions', editor);
    expect(fundamentals.course).toMatchObject({ status: 'draft', publishedVersion: null });
    expect(fundamentals.course.summary).toMatch(/^Basics of Transhumanism 101 to 501: /);
    expect(fundamentals.lessons.map((lesson) => lesson.lessonId)).toEqual(['basics-101', 'basics-201', 'basics-301', 'basics-401', 'basics-501']);
    expect(fundamentals.lessons.every((lesson) => lesson.questions.length === 5)).toBe(true);
    expect((await content('figures-of-transhumanism', editor)).lessons).toHaveLength(5);
    expect((await content('the-coalition', editor)).lessons.map((lesson) => lesson.lessonId)).toEqual(['uspp']);
    expect((await content('historical-applied-projects', editor)).lessons).toHaveLength(5);
    expect((await content('introduction-to-left-transhumanism', editor)).lessons.map((lesson) => lesson.lessonId).at(-1)).toBe('ustp-left');
    // The courses the curriculum has nothing for are written from the party's own sources.
    for (const seed of partyCourses) {
      const written = await content(seed.courseId, editor);
      expect(written.course).toMatchObject({ summary: seed.summary, status: 'draft', publishedVersion: null });
      expect(written.lessons.map((lesson) => lesson.lessonId)).toEqual(seed.lessons.map((lesson) => lesson.lessonId));
    }
    const placed = await placement(editor);
    expect(placed['introduction-to-left-transhumanism']).toEqual({ prerequisites: ['fundamental-questions'], position: { row: 1, column: 4 } });
    expect(placed['historical-applied-projects']).toEqual({ prerequisites: ['figures-of-transhumanism'], position: { row: 3, column: 1 } });

    // Nothing reaches learners until a Course Administrator publishes.
    expect((await api.call('GET', '/v1/public/courses/fundamental-questions')).status).toBe(404);
    for (const courseId of ['fundamental-questions', 'introduction-to-left-transhumanism', 'figures-of-transhumanism']) {
      expect((await api.call('POST', `/v1/admin/courses/${courseId}/publish`, editor)).body.version).toBe(1);
    }
    const left = await api.call('GET', '/v1/public/courses/introduction-to-left-transhumanism');
    expect(left.body.lessons).toHaveLength(6);
    expect(left.body.prerequisites).toEqual([{ courseId: 'fundamental-questions', title: 'The Fundamental Questions of Transhumanism' }]);

    const learner = await api.member('curriculum-learner@example.test');
    const refused = await api.call('POST', '/v1/courses/introduction-to-left-transhumanism/lessons/left-101/attempts', learner, { answers: [1, 2, 0, 3, 1] });
    expect(refused.status).toBe(409);
    await passCourse('fundamental-questions', learner, editor);
    expect((await api.call('GET', '/v1/courses/fundamental-questions', learner)).body.certificate).not.toBeNull();
    expect((await api.call('POST', '/v1/courses/introduction-to-left-transhumanism/lessons/left-101/attempts', learner, { answers: [1, 2, 0, 3, 1] })).body.attempt.passed).toBe(true);
    // The Figures come after An Introduction into the Transhumanist Party, which is not published yet.
    expect((await api.call('GET', '/v1/courses/figures-of-transhumanism', learner)).body.missingPrerequisites).toEqual([
      { courseId: 'transhumanist-party', title: 'An Introduction into the Transhumanist Party' },
    ]);
  });

  it('leaves alone a course a Course Administrator wrote or deleted before the curriculum came, and lessons deleted after', async () => {
    const db = api.firebase.db;
    const map = new Map(mapCourses.map((course) => [course.courseId, course]));
    // As a database might stand: the map seeded, The Fundamental Questions written, The Coalition deleted, and
    // another course on the square Historical Applied Projects would take.
    await db.collection(Collections.courseSeeds).doc(MAP_SEED).create({ seed: MAP_SEED, seededAt: '2026-10-31T00:00:00.000Z' });
    for (const course of mapCourses.filter((c) => c.courseId !== 'the-coalition')) await db.collection(Collections.courses).doc(course.courseId).create(course);
    await db.collection(Collections.courses).doc('fundamental-questions').update({ summary: 'Our own summary.' });
    await db
      .collection(Collections.courseLessons)
      .doc('fundamental-questions_ours')
      .create({ ...oneQuestionLesson, courseId: 'fundamental-questions', lessonId: 'ours', questions: [{ ...oneQuestionLesson.questions[0], questionId: 'q' }], updatedAt: 'x', updatedBy: 'x' });
    await db.collection(Collections.courses).doc('futures-lab').create({ ...map.get('allies')!, courseId: 'futures-lab', title: 'Futures Lab', prerequisites: [], position: { row: 3, column: 1 } });

    const editor = await courseAdmin('curriculum-keeper@example.test');
    expect(await content('fundamental-questions', editor)).toMatchObject({ course: { summary: 'Our own summary.' }, lessons: [{ lessonId: 'ours' }] });
    expect((await api.call('GET', '/v1/admin/courses/the-coalition', editor)).status).toBe(404);
    const figures = await content('figures-of-transhumanism', editor);
    expect(figures.course.summary).toMatch(/^Historical Figures 101 to 501: /);
    expect(figures.lessons).toHaveLength(5);
    const placed = await placement(editor);
    expect(placed['historical-applied-projects']).toEqual({ prerequisites: ['figures-of-transhumanism'], position: null });
    expect(placed['introduction-to-left-transhumanism']).toEqual({ prerequisites: ['fundamental-questions'], position: { row: 1, column: 4 } });

    expect((await api.call('DELETE', '/v1/admin/courses/figures-of-transhumanism/lessons/figures-101', editor)).status).toBe(204);
    expect((await content('figures-of-transhumanism', editor)).lessons).toHaveLength(4);
  });

  it("writes the party's own courses where the curriculum was added before them, and leaves the curriculum's alone", async () => {
    const db = api.firebase.db;
    // As dev stands once the curriculum's seed has run: the map's drafts, and the curriculum's marker.
    await db.collection(Collections.courseSeeds).doc(MAP_SEED).create({ seed: MAP_SEED, seededAt: '2026-10-31T00:00:00.000Z' });
    await db.collection(Collections.courseSeeds).doc(CONTENT_SEED).create({ seed: CONTENT_SEED, seededAt: '2026-11-01T00:00:00.000Z' });
    for (const course of mapCourses) await db.collection(Collections.courses).doc(course.courseId).create(course);

    const editor = await courseAdmin('party-courses@example.test');
    expect(await content('fundamental-questions', editor)).toMatchObject({ course: { summary: DRAFT_SUMMARY }, lessons: [] });
    const allies = await content('allies', editor);
    expect(allies.course.summary).toMatch(/^Who the United States Transhumanist Party works with/);
    expect(allies.lessons.map((lesson) => lesson.lessonId)).toEqual(['allies-states', 'allies-organizations', 'allies-coalition']);
    expect((await content('why-the-new-york-transhumanist-party', editor)).lessons).toHaveLength(2);

    // Published, a course of the party's own reads like any other, its sources at the end of each lesson.
    expect((await api.call('POST', '/v1/admin/courses/transhumanist-party/publish', editor)).body.version).toBe(1);
    const intro = await api.call('GET', '/v1/public/courses/transhumanist-party');
    expect(intro.body.lessons).toHaveLength(4);
    expect(intro.body.lessons[0].body).toContain('\n\nSources\n\nUnited States Transhumanist Party, Constitution: https://transhumanist-party.org/constitution/');
  });
});

describe('Courses combined into one (design §10.8)', () => {
  type AdminCourse = {
    course: { title: string; summary: string; status: string; publishedVersion: number | null; hidden: boolean; position: unknown; prerequisites: string[] };
    lessons: { lessonId: string; order: number }[];
  };
  const content = async (courseId: string, editor: Learner) => (await api.call('GET', `/v1/admin/courses/${courseId}`, editor)).body as AdminCourse;
  const ALLIES = ['allies-states', 'allies-organizations', 'allies-coalition', 'uspp'];
  const NEW_YORK = ['nytp-what', 'nytp-reformed', 'nytp-constitution', 'nytp-aims', 'ny-election-law', 'left-101', 'left-201', 'left-301', 'left-401', 'left-501', 'ustp-left'];

  it('adds The Coalition to Allies, and Why New York and Left Transhumanism to the New York introduction, as drafts', async () => {
    const editor = await courseAdmin('combine-editor@example.test');
    const allies = await content('allies', editor);
    expect(allies.course).toMatchObject({ title: 'Allies of the Transhumanist Party', summary: combinedCourses[0]!.summary, status: 'draft', publishedVersion: null });
    expect(allies.lessons.map((lesson) => lesson.lessonId)).toEqual(ALLIES);
    expect(allies.lessons.map((lesson) => lesson.order)).toEqual([1, 2, 3, 4]);
    const newYork = await content('new-york-transhumanist-party', editor);
    expect(newYork.course).toMatchObject({ title: 'Introduction to the New York Transhumanist Party', summary: combinedCourses[1]!.summary, status: 'draft' });
    expect(newYork.course.prerequisites).toEqual(['fundamental-questions']);
    expect(newYork.lessons.map((lesson) => lesson.lessonId)).toEqual(NEW_YORK);
    expect(newYork.lessons.map((lesson) => lesson.order)).toEqual(NEW_YORK.map((_, i) => i + 1));

    // Never published, the courses combined away are deleted with their lessons.
    for (const gone of ['the-coalition', 'why-the-new-york-transhumanist-party', 'introduction-to-left-transhumanism']) {
      expect((await api.call('GET', `/v1/admin/courses/${gone}`, editor)).status).toBe(404);
      expect((await api.firebase.db.collection(Collections.courseLessons).where('courseId', '==', gone).get()).empty).toBe(true);
    }

    // Published, the New York course has all eleven lessons and quizzes.
    expect((await api.call('POST', '/v1/admin/courses/new-york-transhumanist-party/publish', editor)).body.version).toBe(1);
    const published = await api.call('GET', '/v1/public/courses/new-york-transhumanist-party');
    expect(published.body.lessons.map((lesson: { lessonId: string }) => lesson.lessonId)).toEqual(NEW_YORK);
    expect(published.body.lessons.at(-1).questions).toHaveLength(5);
  });

  it('as dev stands: hides a published course combined away, keeping its certificates, and moves the courses after it', async () => {
    const db = api.firebase.db;
    await skipCombining();
    const editor = await courseAdmin('combine-dev@example.test');
    // Allies and The Coalition published, a learner holding The Coalition's certificate, a course of the admins' own
    // after The Coalition, and the New York introduction's summary rewritten.
    await api.call('PUT', '/v1/admin/courses/the-coalition/map', editor, { prerequisites: [], position: { row: 1, column: 0 } });
    for (const courseId of ['allies', 'the-coalition']) expect((await api.call('POST', `/v1/admin/courses/${courseId}/publish`, editor)).body.version).toBe(1);
    const learner = await api.member('combine-learner@example.test');
    await passCourse('the-coalition', learner, editor);
    const certificate = (await api.call('GET', '/v1/courses/the-coalition', learner)).body.certificate as { certificateId: string };
    expect(certificate).not.toBeNull();
    await api.call('POST', '/v1/admin/courses', editor, { title: 'Futures Lab', summary: 'Hands-on.' });
    await api.call('PUT', '/v1/admin/courses/futures-lab/map', editor, { prerequisites: ['the-coalition', 'allies'], position: { row: 5, column: 5 } });
    await api.call('PUT', '/v1/admin/courses/new-york-transhumanist-party', editor, { title: 'Introduction to the New York Transhumanist Party', summary: 'Our own summary.' });

    // The release comes: the next request combines them.
    await db.collection(Collections.courseSeeds).doc(COMBINE_SEED).delete();
    const allies = await content('allies', editor);
    expect(allies.course).toMatchObject({ status: 'draft', publishedVersion: 1, summary: combinedCourses[0]!.summary });
    expect(allies.lessons.map((lesson) => lesson.lessonId)).toEqual(ALLIES);
    const coalition = await content('the-coalition', editor);
    expect(coalition.course).toMatchObject({ hidden: true, publishedVersion: 1, position: null });
    expect(coalition.lessons).toHaveLength(1);
    const listed = ((await api.call('GET', '/v1/public/courses')).body.courses as { courseId: string }[]).map((course) => course.courseId);
    expect(listed).not.toContain('the-coalition');
    expect(listed).toContain('futures-lab');
    expect((await api.call('GET', '/v1/public/courses/the-coalition')).status).toBe(200);
    expect((await api.call('GET', `/v1/public/certificates/${certificate.certificateId}`)).body).toMatchObject({ valid: true, courseTitle: 'The Coalition' });
    expect((await content('futures-lab', editor)).course.prerequisites).toEqual(['allies']);
    const newYork = await content('new-york-transhumanist-party', editor);
    expect(newYork.course.summary).toBe('Our own summary.');
    expect(newYork.lessons.map((lesson) => lesson.lessonId)).toEqual(NEW_YORK);

    // Once only: a lesson deleted afterwards stays deleted.
    expect((await api.call('DELETE', '/v1/admin/courses/allies/lessons/uspp', editor)).status).toBe(204);
    expect((await content('allies', editor)).lessons.map((lesson) => lesson.lessonId)).toEqual(ALLIES.slice(0, 3));
  });
});
