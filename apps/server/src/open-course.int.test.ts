import { Collections } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi } from './testing/emulator.js';

/** The intro taken without signing in, claimed on signing in, and its certificates shared (design §10.8). */

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());
beforeEach(async () => resetEmulators());

/** A member made Course Administrator by `sa`, or the first System Admin, after the courses have been seeded. */
async function courseAdmin(email: string, by?: Awaited<ReturnType<TestApi['systemAdmins']>>[0]) {
  await api.call('GET', '/v1/public/courses/transhumanism');
  const sa = by ?? (await api.systemAdmins())[0];
  const editor = await api.member(email);
  await api.grant(editor.accountId, 'course_admin', sa);
  return editor;
}

/** A published course's lessons with their right answers, in order, from its public file. */
async function rightAnswers(courseId = 'transhumanism'): Promise<{ lessonId: string; answers: number[] }[]> {
  const pkg = await api.call('GET', `/v1/public/courses/${courseId}/package`);
  return pkg.body.lessons.map((lesson: { lessonId: string; questions: { correctIndex: number }[] }) => ({
    lessonId: lesson.lessonId,
    answers: lesson.questions.map((question) => question.correctIndex),
  }));
}

const count = async (collection: string) => (await api.firebase.db.collection(collection).count().get()).data().count;

describe('a course open without sign-in', () => {
  it('starts with the intro open, marks guests’ quizzes and keeps nothing of them', async () => {
    const course = await api.call('GET', '/v1/public/courses/transhumanism');
    expect(course.body.openToGuests).toBe(true);
    const map = await api.call('GET', '/v1/public/courses');
    const open = map.body.courses.filter((entry: { openToGuests: boolean }) => entry.openToGuests).map((entry: { courseId: string }) => entry.courseId);
    expect(open).toEqual(['transhumanism']);
    expect((await api.firebase.db.collection(Collections.courses).doc('transhumanism').get()).data()).toMatchObject({ openToGuests: true, openChangedBy: 'course-open' });

    const [first] = await rightAnswers();
    const check = (body: unknown, lessonId = first!.lessonId) => api.call('POST', `/v1/public/courses/transhumanism/lessons/${lessonId}/check`, undefined, body);
    const passed = await check({ version: 1, answers: first!.answers });
    expect(passed.status).toBe(200);
    expect(passed.body).toMatchObject({ version: 1, score: 100, passed: true });
    expect(passed.body.feedback).toHaveLength(first!.answers.length);
    expect(passed.body.feedback.every((answer: { correct: boolean }) => answer.correct)).toBe(true);
    const wrong = first!.answers.map((answer) => (answer === 0 ? 1 : 0));
    expect((await check({ version: 1, answers: wrong })).body).toMatchObject({ score: 0, passed: false });

    expect((await check({ version: 2, answers: first!.answers })).status).toBe(409);
    expect((await check({ version: 1, answers: [0] })).status).toBe(400);
    expect((await check({ version: 1, answers: first!.answers }, 'no-such-lesson')).status).toBe(404);
    // A draft has no quizzes to take.
    expect((await api.call('POST', '/v1/public/courses/fundamental-questions/lessons/x/check', undefined, { version: 1, answers: [0] })).status).toBe(404);
    // Marked and forgotten.
    expect(await count(Collections.courseAttempts)).toBe(0);
    expect(await count(Collections.courseProgress)).toBe(0);
  });

  it('is closed and opened by Course Administrators, never one that comes after another, and stays as they leave it', async () => {
    const editor = await courseAdmin('opener@example.test');
    const member = await api.member('not-an-editor@example.test');
    const guests = (courseId: string, openToGuests: boolean, by = editor) => api.call('PUT', `/v1/admin/courses/${courseId}/guests`, by, { openToGuests });

    expect((await guests('transhumanism', false, member)).status).toBe(403);
    const closed = await guests('transhumanism', false);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ openToGuests: false, openChangedBy: editor.accountId });
    const [first] = await rightAnswers();
    expect((await api.call('POST', `/v1/public/courses/transhumanism/lessons/${first!.lessonId}/check`, undefined, { version: 1, answers: first!.answers })).status).toBe(403);
    // The seed has run once: closing sticks.
    expect((await api.call('GET', '/v1/public/courses/transhumanism')).body.openToGuests).toBe(false);

    const refused = await guests('allies', true);
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toMatch(/comes after another/);
    // A draft may be opened; it is open once published.
    expect((await guests('fundamental-questions', true)).body).toMatchObject({ openToGuests: true });
    const listed = (await api.call('GET', '/v1/public/courses')).body.courses.find((c: { courseId: string }) => c.courseId === 'fundamental-questions');
    expect(listed.openToGuests).toBe(false);
    expect((await guests('transhumanism', true)).body).toMatchObject({ openToGuests: true });
    expect((await guests('nope', true)).status).toBe(404);
  });
});

describe('claiming quizzes passed before signing in', () => {
  it('records them in the account as attempts made now, issuing the certificate once every lesson is passed', async () => {
    const lessons = await rightAnswers();
    const learner = await api.member('guest-learner@example.test');
    const claim = (body: unknown) => api.call('POST', '/v1/courses/transhumanism/claim', learner, body);

    expect((await api.call('POST', '/v1/courses/transhumanism/claim', undefined, { version: 1, lessons })).status).toBe(401);
    expect((await claim({ version: 2, lessons })).status).toBe(409);
    expect((await claim({ version: 1, lessons: [lessons[0], lessons[0]] })).status).toBe(400);
    expect((await claim({ version: 1, lessons: [{ lessonId: 'no-such-lesson', answers: [0] }] })).status).toBe(404);

    const part = await claim({ version: 1, lessons: lessons.slice(0, 2) });
    expect(part.status).toBe(201);
    expect(part.body).toMatchObject({ claimed: 2, certificate: null });
    expect(part.body.progress.completedLessonIds).toHaveLength(2);

    const all = await claim({ version: 1, lessons });
    expect(all.body.claimed).toBe(6);
    expect(all.body.certificate).toMatchObject({ courseVersion: 1 });
    expect(await count(Collections.courseAttempts)).toBe(8);

    const view = await api.call('GET', '/v1/courses/transhumanism', learner);
    expect(view.body.progress.completedLessonIds).toHaveLength(6);
    // A login without a name is given its email address, which the holder can change.
    expect(view.body.certificate).toEqual({
      certificateId: all.body.certificate.certificateId,
      issuedAt: all.body.certificate.issuedAt,
      courseVersion: 1,
      recipientName: 'guest-learner@example.test',
      nameShown: false,
      linkedInOrganizationId: null,
    });
  });
});

describe('a shared certificate', () => {
  it('shows its holder’s name on its public page only while they choose, and never their email', async () => {
    const learner = await api.member('holder@example.test');
    const other = await api.member('no-certificate@example.test');
    const claimed = await api.call('POST', '/v1/courses/transhumanism/claim', learner, { version: 1, lessons: await rightAnswers() });
    const certificateId = claimed.body.certificate.certificateId as string;
    const holder = (body: unknown, by = learner) => api.call('PUT', '/v1/courses/transhumanism/certificate', by, body);
    const page = async () => (await api.call('GET', `/v1/public/certificates/${certificateId}`)).body;

    expect(await page()).toMatchObject({ valid: true, courseId: 'transhumanism', courseVersion: 1, holderName: null });
    // Its name is the email address the login was given, so it cannot be shown yet.
    expect((await holder({ nameShown: true })).status).toBe(409);
    expect((await holder({ recipientName: 'someone@example.test' })).status).toBe(400);
    expect((await holder({})).status).toBe(400);

    const named = await holder({ recipientName: '  Ada Lovelace ', nameShown: true });
    expect(named.status).toBe(200);
    expect(named.body).toMatchObject({ certificateId, recipientName: 'Ada Lovelace', nameShown: true });
    expect(await page()).toMatchObject({ valid: true, holderName: 'Ada Lovelace' });
    expect((await api.call('GET', '/v1/courses/transhumanism/certificate.pdf', learner)).contentType).toContain('application/pdf');

    expect((await holder({ nameShown: false })).body).toMatchObject({ recipientName: 'Ada Lovelace', nameShown: false });
    expect((await page()).holderName).toBeNull();
    expect((await holder({ nameShown: true }, other)).status).toBe(404);
    expect((await api.call('GET', '/v1/public/certificates/not-a-certificate')).body).toMatchObject({ valid: false, holderName: null });
  });

  it("names the party's LinkedIn organization once a System or Site Admin sets it", async () => {
    const [sa] = await api.systemAdmins();
    const site = await api.member('site-admin@example.test');
    await api.grant(site.accountId, 'site_admin', sa);
    const editor = await courseAdmin('linkedin-editor@example.test', sa);
    const learner = await api.member('linkedin-learner@example.test');
    await api.call('POST', '/v1/courses/transhumanism/claim', learner, { version: 1, lessons: await rightAnswers() });
    const url = '/v1/admin/certificate-settings';

    expect((await api.call('GET', url, editor)).status).toBe(403);
    expect((await api.call('PUT', url, learner, { linkedInOrganizationId: '1' })).status).toBe(403);
    expect((await api.call('GET', url, sa)).body).toMatchObject({ linkedInOrganizationId: null });
    expect((await api.call('PUT', url, site, { linkedInOrganizationId: 'ustp' })).status).toBe(400);
    try {
      const saved = await api.call('PUT', url, site, { linkedInOrganizationId: '1234567' });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ linkedInOrganizationId: '1234567', updatedBy: site.accountId });
      expect((await api.call('GET', url, sa)).body.linkedInOrganizationId).toBe('1234567');
      expect((await api.call('GET', '/v1/courses/transhumanism', learner)).body.certificate.linkedInOrganizationId).toBe('1234567');
    } finally {
      // The setting is cached for a minute, across the emulators' resets: leave it unset for the other tests.
      await api.call('PUT', url, sa, { linkedInOrganizationId: null });
    }
  });
});
