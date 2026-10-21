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
 * Fastify logger settings: Cloud Logging field names, and credentials never written to logs.
 * Request bodies are not logged at all (Fastify's default), which keeps ballot contents out of logs (design §7.1).
 */
export function loggerOptions() {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    messageKey: 'message',
    formatters: {
      level: (label: string) => ({ severity: SEVERITY[label] ?? 'DEFAULT' }),
    },
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-firebase-appcheck"]', 'req.headers.cookie'],
      censor: '[redacted]',
    },
  };
}
