import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggerService } from '@nestjs/common';
import type { FastifyBaseLogger } from 'fastify';
import { buildCommit } from 'ustp-domain';

/** Pino level → Cloud Logging severity. */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * Writes one log entry an alert policy matches (`jsonPayload.alert`), as JSON on standard output, which Cloud Run reads
 * as a structured entry at severity ERROR. Never personal data: the policy's email quotes the message.
 */
export function alertLog(alert: string, message: string, fields: Readonly<Record<string, string>> = {}): void {
  process.stdout.write(`${JSON.stringify({ severity: 'ERROR', alert, message, ...fields })}\n`);
}

/**
 * What every log line written while a request is handled says about that request (design §14, "Logging"): its id and
 * Cloud Trace ids, which gather one request's lines in Logs Explorer, and, once the request has reached its handler,
 * which handler and who is calling.
 */
export interface LogContext {
  readonly requestId: string;
  /** `projects/<project>/traces/<id>`, when the request carried a trace header. */
  readonly trace?: string;
  readonly spanId?: string;
  /** `Controller.handler`: the code that answers the request. */
  action?: string;
  /** The caller. Never set on a route marked `@NoActorLog()` (casting a ballot, design §7.1). */
  accountId?: string;
  roles?: readonly string[];
  /** The System Admin acting as the test persona `accountId` (design §10.4). */
  operator?: string;
  /** The problem type of a refused request, where it has one. */
  problemType?: string;
}

/** The request being handled, for the logger: entered by the hooks in `create-app.ts`. */
export const requestContext = new AsyncLocalStorage<LogContext>();

const TRACE_FIELD = 'logging.googleapis.com/trace';
const SPAN_FIELD = 'logging.googleapis.com/spanId';

type Headers = Readonly<Record<string, string | string[] | undefined>>;

/**
 * The trace a request belongs to, from the W3C `traceparent` header or Google's older `x-cloud-trace-context`, both of
 * which Cloud Run sets. Without a project (a local run) there is no trace name to write, and so no span either.
 */
export function parseTrace(headers: Headers, projectId: string | undefined): { trace?: string; spanId?: string } {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  let traceId: string | undefined;
  let spanId: string | undefined;
  const w3c = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(one(headers['traceparent'])?.trim() ?? '');
  if (w3c) {
    [, traceId, spanId] = w3c;
  } else {
    const google = /^([0-9a-f]{32})(?:\/(\d{1,20}))?/.exec(one(headers['x-cloud-trace-context'])?.trim() ?? '');
    if (google) {
      traceId = google[1];
      if (google[2] !== undefined) spanId = BigInt(google[2]).toString(16).padStart(16, '0');
    }
  }
  if (!traceId || !projectId || /^0+$/.test(traceId)) return {};
  return { trace: `projects/${projectId}/traces/${traceId}`, ...(spanId !== undefined && { spanId }) };
}

/** The fields of the request being handled, as Cloud Logging names them; empty outside a request. */
export function contextFields(context: LogContext | undefined = requestContext.getStore()): Record<string, unknown> {
  if (!context) return {};
  return {
    requestId: context.requestId,
    ...(context.trace !== undefined && { [TRACE_FIELD]: context.trace }),
    ...(context.spanId !== undefined && { [SPAN_FIELD]: context.spanId }),
    ...(context.action !== undefined && { action: context.action }),
    ...(context.accountId !== undefined && { accountId: context.accountId }),
    ...(context.operator !== undefined && { operator: context.operator }),
  };
}

/**
 * Fastify logger settings: Cloud Logging field names, the request's fields on every line, and credentials never written
 * to logs. Request bodies are not logged at all, which keeps ballot contents out of logs (design §7.1), and nor are
 * Fastify's own request lines, which hold the client's address and the query string: `requestLine` replaces them.
 */
export function loggerOptions(stream?: { write(line: string): void }) {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    messageKey: 'message',
    // No pid or hostname: Cloud Run labels each entry with the service, revision and instance.
    base: null,
    formatters: {
      level: (label: string) => ({ severity: SEVERITY[label] ?? 'DEFAULT' }),
    },
    mixin: () => contextFields(),
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-firebase-appcheck"]', 'req.headers.cookie'],
      censor: '[redacted]',
    },
    ...(stream && { stream }),
  };
}

/** What `requestLine` reads of a request and its reply. */
export interface RequestFacts {
  readonly method: string;
  /** As received, query string included. */
  readonly url: string;
  /** The route's pattern, e.g. `/v1/admin/members/:id`; undefined where no route matched. */
  readonly route: string | undefined;
  readonly status: number;
  readonly elapsedMs: number;
}

/** Health checks: Cloud Run's probe and the web app's version check, far too many to keep at the default level. */
const QUIET_PATHS = new Set(['/healthz', '/v1/health']);

/**
 * The one line written for each request (design §14): what was asked, by whom, which handler answered, how, and how
 * long it took. Never the query string (a search holds a name or an email address), the client's address, a header or a
 * body. A path that carries a secret (`:token`, the unsubscribe link of §10.12) is written as its pattern.
 */
export function requestLine(
  facts: RequestFacts,
  context: LogContext | undefined,
): { level: 'debug' | 'info' | 'warn'; fields: Record<string, unknown>; message: string } {
  const rawPath = facts.url.split('?', 1)[0] ?? '';
  const path = facts.route?.includes(':token') ? facts.route : rawPath;
  const fields: Record<string, unknown> = {
    httpRequest: {
      requestMethod: facts.method,
      requestUrl: path,
      status: facts.status,
      latency: `${(Math.max(0, facts.elapsedMs) / 1000).toFixed(3)}s`,
    },
    ...(facts.route !== undefined && { route: facts.route }),
    ...(context?.roles?.length && { roles: context.roles }),
    ...(context?.problemType !== undefined && { problemType: context.problemType }),
  };
  const level = facts.status >= 500 ? 'warn' : QUIET_PATHS.has(rawPath) ? 'debug' : 'info';
  return { level, fields, message: `${facts.method} ${path} ${facts.status}` };
}

/** Marks an entry for Error Reporting, which then groups it by its stack trace. */
const REPORTED_ERROR = 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';

/** The fields of an unexpected error's line: the stack trace, and which service and build it came from. */
export function errorFields(error: unknown, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return {
    '@type': REPORTED_ERROR,
    stack_trace: error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : `Error: ${String(error)}`,
    serviceContext: { service: env.K_SERVICE ?? 'ustp-server', version: buildCommit(env.BUILD_COMMIT) ?? 'unreleased' },
  };
}

/** Nest's own start-up chatter (one line per route and provider): kept for `LOG_LEVEL=debug` only. */
const STARTUP_CONTEXTS = new Set(['RouterExplorer', 'RoutesResolver', 'InstanceLoader', 'NestFactory', 'NestApplication']);

/**
 * Nest's `Logger`, written through the same logger as everything else: one JSON entry per call, with the request's
 * fields and the logger's name as `context`. A message may be an object, whose fields become the entry's; an error
 * call's stack trace makes the entry one Error Reporting groups.
 */
export class JsonNestLogger implements LoggerService {
  constructor(private readonly logger: FastifyBaseLogger) {}

  log(message: unknown, ...rest: unknown[]): void {
    const context = contextOf(rest);
    this.write(context !== undefined && STARTUP_CONTEXTS.has(context) ? 'debug' : 'info', message, context);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, contextOf(rest));
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, contextOf(rest));
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('trace', message, contextOf(rest));
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, contextOf(rest));
  }

  /** `error(message, stack?, context?)`, or with an Error as the message. */
  error(message: unknown, ...rest: unknown[]): void {
    const context = contextOf(rest);
    const stack = rest.length > 1 && typeof rest[0] === 'string' ? rest[0] : undefined;
    const looksLikeStack = typeof message === 'string' && /\n\s+at /.test(message);
    const extra =
      message instanceof Error
        ? errorFields(message)
        : stack !== undefined
          ? { ...errorFields(null), stack_trace: stack }
          : looksLikeStack
            ? { ...errorFields(null), stack_trace: message }
            : {};
    this.write('error', message, context, extra);
  }

  private write(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: unknown,
    context: string | undefined,
    extra: Record<string, unknown> = {},
  ): void {
    const fields = { ...(context !== undefined && { context }), ...extra };
    if (message instanceof Error) {
      this.logger[level](fields, message.message);
    } else if (typeof message === 'object' && message !== null) {
      const { message: text, ...own } = message as Record<string, unknown>;
      this.logger[level]({ ...fields, ...own }, typeof text === 'string' ? text : (context ?? ''));
    } else {
      // A stack trace as the message: its first line is what the entry says.
      this.logger[level](fields, String(message).split('\n', 1)[0] ?? '');
    }
  }
}

/** Nest passes the logger's name last. */
function contextOf(rest: readonly unknown[]): string | undefined {
  const last = rest.at(-1);
  return typeof last === 'string' ? last : undefined;
}
