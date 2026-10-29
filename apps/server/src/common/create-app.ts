import 'reflect-metadata';
import { NestFactory, type IEntryNestModule } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BUILD_COMMIT_HEADER, buildCommit, PRESS_ASSET_MAX_BYTES } from 'ustp-domain';
import { ACCEPTED_TYPES, MAX_PHOTO_BYTES } from '../photos/image.js';
import { loggerOptions } from './logging.js';
import { ProblemDetailsFilter } from './problem.filter.js';

export interface CreateAppOptions {
  /** Disable request logging (tests). */
  readonly quiet?: boolean;
}

export async function createFastifyApp(
  module: IEntryNestModule,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ logger: options.quiet ? false : loggerOptions(), trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(module, adapter, {
    logger: options.quiet ? false : ['log', 'warn', 'error'],
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
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
  return app;
}

/** Cloud Run provides PORT and expects the server on all interfaces. */
export async function listen(app: NestFastifyApplication): Promise<void> {
  await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}
