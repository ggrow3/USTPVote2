import type { ProblemDetails } from 'ustp-domain';
import type { z } from 'zod';
import { ApiError } from './api.js';

export type FieldErrors = Record<string, string>;

/** Validates with a shared ustp-domain schema; returns the parsed value or the first message per field. */
export function validate<S extends z.ZodType>(
  schema: S,
  value: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: toFieldErrors(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))) };
}

/** Field errors reported by the API for a 400 response, if any. */
export function apiFieldErrors(error: unknown): FieldErrors {
  return error instanceof ApiError ? toFieldErrors(error.problem.errors ?? []) : {};
}

function toFieldErrors(issues: NonNullable<ProblemDetails['errors']>): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, message } of issues) errors[path || '_'] ??= message;
  return errors;
}

export { STATES } from './states.js';
