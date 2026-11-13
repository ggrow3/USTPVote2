import { createHash } from 'node:crypto';
import type { CourseEmbed, CoursesEmbed } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, type ServerConfig } from './config.js';
import { resetEmulators, TestApi } from './testing/emulator.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetEmulators();
  // The party's courses are seeded on first read.
  await api.call('GET', '/v1/public/courses/transhumanism');
});

/** A request as Firebase Hosting forwards it from the site at `host`. */
const get = (url: string) => api.app.inject({ method: 'GET', url, headers: { 'x-forwarded-host': 'vote.example.org', 'x-forwarded-proto': 'https' } });

/** The page's data, as its script reads it. */
const data = <T>(html: string): T => JSON.parse(html.match(/<script type="application\/json" id="embed-data">([\s\S]*?)<\/script>/)![1]!) as T;

const sha = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

describe('the course embed (design §10.17)', () => {
  it('serves a published course as a page any site may frame, running only its own script', async () => {
    const res = await get('/embed/course/transhumanism');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain('frame-ancestors *');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('frame-src https://www.youtube-nocookie.com');
    expect(res.headers['x-robots-tag']).toBe('noindex');
    // Every inline script and style the page has is the one the policy names.
    const scripts = [...res.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    const styles = [...res.body.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
    expect(scripts).toHaveLength(1);
    expect(styles).toHaveLength(1);
    expect(csp).toContain(`script-src ${sha(scripts[0]!)}`);
    expect(csp).toContain(`style-src ${sha(styles[0]!)}`);

    // Links go to the site's own address (WEB_ORIGIN), else to where the request came.
    const origin = api.app.get<ServerConfig>(CONFIG).webOrigin ?? 'https://vote.example.org';
    const embed = data<CourseEmbed>(res.body);
    expect(embed).toMatchObject({ view: 'course', site: { origin }, pageUrl: `${origin}/course/transhumanism`, passPercent: 80 });
    expect(embed.lessons.length).toBeGreaterThan(0);
    expect(embed.lessons[0]!.questions[0]).toHaveProperty('correctIndex');
  });

  it('lists the published courses, each opening in the frame', async () => {
    const res = await get('/embed/courses');
    expect(res.statusCode).toBe(200);
    const embed = data<CoursesEmbed>(res.body);
    expect(embed.view).toBe('courses');
    expect(embed.courses.find((c) => c.courseId === 'transhumanism')).toMatchObject({ embedPath: '/embed/course/transhumanism' });
    // Drafts on the map are coming soon on the Courses page, but have nothing to show here.
    const map = (await api.call('GET', '/v1/public/courses')).body as { courses: { courseId: string; published: boolean }[] };
    const drafts = map.courses.filter((c) => !c.published).map((c) => c.courseId);
    for (const id of drafts) expect(embed.courses.map((c) => c.courseId)).not.toContain(id);
  });

  it('says a course that is not published is not found, with 404, and runs nothing for it', async () => {
    const map = (await api.call('GET', '/v1/public/courses')).body as { courses: { courseId: string; published: boolean }[] };
    const draft = map.courses.find((c) => !c.published)!;
    for (const path of [`/embed/course/${draft.courseId}`, '/embed/course/no-such-course', '/embed/course/a%2Fb']) {
      const res = await get(path);
      expect(res.statusCode, path).toBe(404);
      expect(res.headers['content-type'], path).toBe('text/html; charset=utf-8');
      expect(res.body, path).toContain('Course not found');
      expect(data(res.body), path).toBeNull();
    }
  });
});
