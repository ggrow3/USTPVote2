import { BadRequestException, ConflictException, type HttpException, type PipeTransform } from '@nestjs/common';
import type { Check } from 'ustp-domain';
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

/** Turns a failed domain rule into an HTTP error (409 by default). */
export function assertCheck(check: Check, toError: (reason: string) => HttpException = (r) => new ConflictException(r)): void {
  if (!check.ok) throw toError(check.reason);
}
