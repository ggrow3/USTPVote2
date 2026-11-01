import sharp from 'sharp';
import { Collections, coursePackageSchema } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
    expect((await api.call('GET', `/v1/public/certificates/${certificateId}`)).body).toEqual({ valid: false, courseTitle: null, courseVersion: null, issuedAt: null });
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
    expect(courses.map((course) => course.courseId)).toEqual([
      'transhumanism',
      'fundamental-questions',
      'the-coalition',
      'allies',
      'transhumanist-party',
      'new-york-transhumanist-party',
      'introduction-to-left-transhumanism',
      'figures-of-transhumanism',
      'why-the-transhumanist-party',
      'why-the-new-york-transhumanist-party',
      'historical-applied-projects',
    ]);
    expect(courses[0]).toMatchObject({ title: FIRST_TITLE, published: true, lessonCount: 6, prerequisites: [], position: { row: 0, column: 0 } });
    expect(courses.find((course) => course.courseId === 'the-coalition')).toMatchObject({
      title: 'The Coalition',
      summary: null,
      published: false,
      prerequisites: ['allies'],
      position: { row: 1, column: 0 },
    });
    expect(courses.find((course) => course.courseId === 'why-the-new-york-transhumanist-party')!.prerequisites).toEqual(['new-york-transhumanist-party']);
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
    // The courses the curriculum has nothing for stay as the map seed left them.
    expect(await content('allies', editor)).toMatchObject({ course: { summary: DRAFT_SUMMARY }, lessons: [] });
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
    // The Figures come after An Introduction into the Transhumanist Party, which has no lessons yet.
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
});
