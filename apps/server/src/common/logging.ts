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
