import { coursePackageSchema } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());
beforeEach(async () => resetEmulators());

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
    await api.call('GET', '/v1/public/courses/transhumanism');
    const [sa] = await api.systemAdmins();
    const editor = await api.member('draft-editor@example.test');
    await api.grant(editor.accountId, 'course_admin', sa);
    const profile = {
      order: 100,
      name: 'Draft only',
      category: 'ethical_technology_thinker',
      biography: 'A profile that intentionally lacks a portrait while it is being drafted.',
      ideas: ['Careful attribution'],
      quote: 'Draft quote.',
      quoteSource: 'Draft source',
      quoteUrl: 'https://example.test/quote',
      portraitUrl: null,
      portraitAlt: '',
      portraitCredit: null,
      portraitLicense: null,
      portraitSourceUrl: null,
      furtherReadingUrl: 'https://example.test/read',
    };
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/profiles', editor, profile)).status).toBe(201);
    expect((await api.call('POST', '/v1/admin/courses/transhumanism/publish', editor)).body.detail).toMatch(/credited, open-licence portrait/);
  });
});

