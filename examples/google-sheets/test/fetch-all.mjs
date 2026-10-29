// UrlFetchApp.fetchAll for the live run: reads its requests as JSON on stdin, sends them together, and writes each
// answer's status, headers and body as JSON on stdout. apps-script.mjs runs it as a child process to stay synchronous.
const requests = JSON.parse(await new Response(process.stdin).text());
const answers = await Promise.all(
  requests.map(async (r) => {
    const res = await fetch(r.url, {
      method: r.method.toUpperCase(),
      headers: { ...r.headers, 'Content-Type': r.contentType },
      body: r.payload,
      signal: AbortSignal.timeout(60_000),
    });
    return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
  }),
);
process.stdout.write(JSON.stringify(answers));
