import 'reflect-metadata';
import { NestFactory, type IEntryNestModule } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
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
  return app;
}

/** Cloud Run provides PORT and expects the server on all interfaces. */
export async function listen(app: NestFastifyApplication): Promise<void> {
  await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}
