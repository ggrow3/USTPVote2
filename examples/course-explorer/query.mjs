#!/usr/bin/env node
// Queries an election site's public course api (design §10.8) for its course map and each published course's
// ustp.course file, and writes them as one JSON file, the one index.html opens. Node 18 or later, nothing to install:
//
//   node query.mjs                                     every published course on ustpvote2-dev.web.app, to stdout
//   node query.mjs --out courses.json                  the same, to a file
//   node query.mjs --course transhumanism              one course
//   node query.mjs --course transhumanism --version 1  an earlier published version of it
//   node query.mjs --site https://another-election-site
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const DEFAULT_SITE = 'https://ustpvote2-dev.web.app';

function fail(message) {
  process.stderr.write(`query.mjs: ${message}\n`);
  process.exit(1);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      site: { type: 'string', default: DEFAULT_SITE },
      course: { type: 'string' },
      version: { type: 'string' },
      out: { type: 'string' },
    },
  }));
} catch (error) {
  fail(error.message);
}
let site;
try {
  site = new URL(values.site);
} catch {
  fail(`--site must be an address such as ${DEFAULT_SITE}`);
}
if (site.protocol !== 'https:' && site.protocol !== 'http:') fail(`--site must be an http(s) address`);
site = site.origin;
if (values.version !== undefined && !/^[1-9]\d*$/.test(values.version)) fail('--version must be a version number, 1 or more');
if (values.version !== undefined && values.course === undefined) fail('--version needs --course');

async function get(path) {
  const res = await fetch(`${site}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from GET ${site}${path}`);
  return res.json();
}

try {
  const courseMap = await get('/v1/public/courses');
  // Drafts on the map have no file to read (their package route answers 404), so "every course" means every published one.
  const ids = values.course ? [values.course] : courseMap.courses.filter((c) => c.published).map((c) => c.courseId);
  const query = values.version ? `?version=${values.version}` : '';
  const packages = Object.fromEntries(
    await Promise.all(ids.map(async (id) => [id, await get(`/v1/public/courses/${encodeURIComponent(id)}/package${query}`)])),
  );
  const result = {
    site,
    queriedAt: new Date().toISOString(),
    query: { course: values.course ?? null, version: values.version ? Number(values.version) : null },
    courseMap,
    packages,
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.out) await writeFile(values.out, json);
  else process.stdout.write(json);

  // What came back, on stderr so it stays out of the JSON.
  for (const [id, pkg] of Object.entries(packages)) {
    const questions = pkg.lessons.reduce((n, lesson) => n + lesson.questions.length, 0);
    const minutes = pkg.lessons.reduce((n, lesson) => n + lesson.estimatedMinutes, 0);
    process.stderr.write(
      `${id}: version ${pkg.source.courseVersion}, ${pkg.lessons.length} lessons, ${questions} questions, ` +
        `${minutes} minutes, ${pkg.profiles.length} profiles\n`,
    );
  }
  if (values.out) process.stderr.write(`Wrote ${values.out} (${Math.round(Buffer.byteLength(json) / 1024)} KB)\n`);
} catch (error) {
  fail(error.message);
}
