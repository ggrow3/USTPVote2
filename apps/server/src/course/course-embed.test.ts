import { describe, expect, it } from 'vitest';
import { courseEmbedSnippet, type CoursesEmbed } from 'ustp-domain';
import { EMBED_CSP, EMBED_HEADERS, embedPage, scriptJson } from './course-embed.js';

const LIST: CoursesEmbed = {
  view: 'courses',
  site: { origin: 'https://vote.example.org', name: 'U.S. Transhumanist Party' },
  pageUrl: 'https://vote.example.org/courses',
  courses: [{ courseId: 'x', title: 'Ends a script </script><script>alert(1)</script>', summary: 'A & B', lessonCount: 2, embedPath: '/embed/course/x' }],
};

describe('the course embed page', () => {
  it('keeps its data inside its data block, whatever the text', () => {
    const html = embedPage(LIST);
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html).not.toContain('</script><script>alert');
    const block = html.match(/<script type="application\/json" id="embed-data">([\s\S]*?)<\/script>/)![1]!;
    expect(JSON.parse(block)).toEqual(LIST);
  });

  it('writes the line separators JSON allows but scripts once did not as escapes', () => {
    const text = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c<d`;
    const json = scriptJson({ text });
    expect(json).not.toContain(String.fromCharCode(0x2028));
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toEqual({ text });
  });

  it('escapes the title and says when there is no course', () => {
    const html = embedPage(null, { siteName: 'A "site" <here>', coursesUrl: 'https://vote.example.org/courses' });
    expect(html).toContain('<title>Course not found</title>');
    expect(html).toContain('See the courses of A &quot;site&quot; &lt;here&gt;');
    expect(html).toContain('<script type="application/json" id="embed-data">null</script>');
  });

  it('may be framed anywhere, and sends nothing anywhere', () => {
    expect(EMBED_HEADERS['Content-Security-Policy']).toBe(EMBED_CSP);
    expect(EMBED_CSP).toMatch(/frame-ancestors \*$/);
    expect(EMBED_CSP).toContain("form-action 'none'");
    expect(EMBED_CSP).not.toContain('unsafe-inline');
    expect(EMBED_CSP).not.toContain('connect-src');
  });
});

describe('the snippet partners paste', () => {
  it('frames a course or the list, its title escaped', () => {
    expect(courseEmbedSnippet('https://vote.example.org/', { courseId: 'transhumanism', title: 'Why "transhumanism"?' })).toBe(
      '<iframe src="https://vote.example.org/embed/course/transhumanism" title="Why &quot;transhumanism&quot;?: a course from the U.S. Transhumanist Party" ' +
        'width="100%" height="720" style="border:0;max-width:100%" loading="lazy" allow="fullscreen; autoplay; encrypted-media; picture-in-picture" ' +
        'referrerpolicy="strict-origin-when-cross-origin"></iframe>',
    );
    expect(courseEmbedSnippet('https://vote.example.org', null)).toContain('src="https://vote.example.org/embed/courses" title="Courses from the U.S. Transhumanist Party"');
  });
});
