import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory, Reflector, type IEntryNestModule } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import { BUILD_COMMIT_HEADER, buildCommit, PRESS_ASSET_MAX_BYTES, VIDEO_UPLOAD } from 'ustp-domain';
import { ACCEPTED_TYPES, MAX_PHOTO_BYTES } from '../photos/image.js';
import { ActionInterceptor } from './action.interceptor.js';
import { errorFields, JsonNestLogger, loggerOptions, parseTrace, requestContext, requestLine, type LogContext } from './logging.js';
import { ProblemDetailsFilter } from './problem.filter.js';

/** The public routes any site may read from a browser: the course list, published courses and their portraits. */
const OPEN_TO_EVERY_ORIGIN = ['/v1/public/courses', '/v1/public/course-images/'];

export interface CreateAppOptions {
  /** Disable logging (tests). */
  readonly quiet?: boolean;
  /** Where log lines go instead of standard output (tests of the logging itself). */
  readonly logStream?: { write(line: string): void };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** What the log lines of this request say about it (design §14). */
    logContext?: LogContext;
  }
}

export async function createFastifyApp(
  module: IEntryNestModule,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: options.quiet ? false : loggerOptions(options.logStream),
    // Fastify's own request lines hold the client's address and the query string; `requestLine` is written instead.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    trustProxy: true,
  });
  const fastify = adapter.getInstance();
  // Every line written while a request is handled carries its id and trace (design §14, "Logging"). Entered again
  // before the handler, because a request body is read from stream events, outside the first hook's context.
  fastify.addHook('onRequest', (req, _reply, done) => {
    req.logContext = { requestId: req.id, ...parseTrace(req.headers, process.env.GOOGLE_CLOUD_PROJECT) };
    requestContext.run(req.logContext, done);
  });
  fastify.addHook('preHandler', (req, _reply, done) => {
    if (req.logContext) requestContext.run(req.logContext, done);
    else done();
  });
  // One line per request, when it has been answered: what, who, which handler, the status and how long it took.
  fastify.addHook('onResponse', (req, reply, done) => {
    const context = req.logContext;
    const line = requestLine(
      { method: req.method, url: req.url, route: req.routeOptions?.url, status: reply.statusCode, elapsedMs: reply.elapsedTime },
      context,
    );
    const write = () => fastify.log[line.level](line.fields, line.message);
    if (context) requestContext.run(context, write);
    else write();
    done();
  });
  const app = await NestFactory.create<NestFastifyApplication>(module, adapter, {
    logger: options.quiet ? false : new JsonNestLogger(fastify.log),
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalInterceptors(new ActionInterceptor(app.get(Reflector)));
  app.enableShutdownHooks();
  // Every response, errors included, says which build answered (design §15): a page built from another commit offers a
  // reload, and explains a refused request by it. Released images only; BUILD_COMMIT is baked in by the release workflow.
  const commit = buildCommit(process.env.BUILD_COMMIT);
  if (commit) {
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (_req, reply, done) => {
        reply.header(BUILD_COMMIT_HEADER, commit);
        done();
      });
  }
  // No response is a page of its own for search results (design §15, "Search engines"): crawlers may still fetch the
  // api, as they must to render the web app's pages, but they list the pages, not the JSON, files or images behind them.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (_req, reply, done) => {
      reply.header('X-Robots-Tag', 'noindex');
      done();
    });
  // The public course api is for other sites too (design §10.8): a page anywhere may read the course list, a published
  // course and its file, and its portraits from the browser. Nothing there needs credentials, and browsers send none
  // to `*`. Errors carry it as well, so another site sees the api's 404 rather than a CORS failure.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (req, reply, done) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && OPEN_TO_EVERY_ORIGIN.some((path) => req.url.startsWith(path))) {
        reply.header('Access-Control-Allow-Origin', '*');
      }
      done();
    });
  // Profile photo uploads arrive as the raw image body (design §5.3); anything else image-typed gets 415.
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser([...ACCEPTED_TYPES], { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES }, (_req, body, done) =>
      done(null, body),
    );
  // Press kit PDFs arrive the same way, and are kept as sent (design §10.9).
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: PRESS_ASSET_MAX_BYTES }, (_req, body, done) => done(null, body));
  // An uploaded video arrives a part at a time, each part's raw bytes with the video's type (design §10.10).
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser([...VIDEO_UPLOAD.types], { parseAs: 'buffer', bodyLimit: VIDEO_UPLOAD.partBytes }, (_req, body, done) => done(null, body));
  // A mail client's one-click unsubscribe is a form (RFC 8058; design §10.12), multipart or url-encoded, which Nest already
  // takes. No route reads a form, so it parses to nothing.
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser('multipart/form-data', { parseAs: 'buffer', bodyLimit: 4096 }, (_req, _body, done) => done(null, {}));
  return app;
}

/** Cloud Run provides PORT and expects the server on all interfaces. */
export async function listen(app: NestFastifyApplication): Promise<void> {
  // An error nothing caught, a rejected promise nobody awaited included, ends the process (Node's default); say why
  // first, as an entry Error Reporting groups. Cloud Run starts another instance.
  process.on('uncaughtException', (error, origin) => {
    app.getHttpAdapter().getInstance().log.fatal(errorFields(error), `${origin}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
  await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}
