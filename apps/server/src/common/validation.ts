import { BadRequestException, ConflictException, type HttpException, type PipeTransform } from '@nestjs/common';
import { PROBLEM_TYPES, type Check } from 'ustp-domain';
import type { z } from 'zod';

/** Validates a request body against a schema shared with the web app (ustp-domain). */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new BadRequestException({
      message: 'invalid request',
      errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}

/** Parses an optional query parameter with a schema; 400 if present and invalid. */
export function parseQuery<S extends z.ZodType>(schema: S, value: unknown, name: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(`invalid query parameter ${name}`);
  return result.data;
}

/**
 * Turns a failed domain rule into an HTTP error (409 by default). A rule's `code` becomes the problem `type`, so
 * clients can react (e.g. prompt for re-authentication) without parsing the message.
 */
export function assertCheck(check: Check, Exception: new (body: object) => HttpException = ConflictException): void {
  if (!check.ok) throw new Exception({ message: check.reason, ...(check.code && { type: PROBLEM_TYPES[check.code] }) });
}
