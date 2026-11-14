import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';
import { PROBLEM_TYPES, type Check, type FieldProblem, type Outcome, type Refusal, type Refused } from 'ustp-domain';
import type { z } from 'zod';

type HttpExceptionClass = new (body: object) => HttpException;

class TooManyRequestsException extends HttpException {
  constructor(body: object) {
    super(body, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** The status each kind of domain refusal has always had. */
const REFUSALS: Readonly<Record<Refusal, HttpExceptionClass>> = {
  forbidden: ForbiddenException,
  not_found: NotFoundException,
  conflict: ConflictException,
  rate_limited: TooManyRequestsException,
};

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

/**
 * 400 when a request's fields break rules that depend on settings read at run time, which a fixed schema cannot hold:
 * the same body as `ZodPipe` gives, so a form shows each message under its field.
 */
export function assertNoFieldProblems(problems: readonly FieldProblem[]): void {
  if (problems.length) throw new BadRequestException({ message: 'invalid request', errors: problems });
}

/** Parses an optional query parameter with a schema; 400 if present and invalid. */
export function parseQuery<S extends z.ZodType>(schema: S, value: unknown, name: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(`invalid query parameter ${name}`);
  return result.data;
}

/**
 * Turns a failed domain rule into an HTTP error: the status its `refusal` names, else `Exception` (409 by default). A
 * rule's `code` becomes the problem `type`, so clients can react (e.g. prompt for re-authentication) without parsing
 * the message.
 */
export function assertCheck(check: Check, Exception: HttpExceptionClass = ConflictException): void {
  if (!check.ok) throw refusalError(check, Exception);
}

/** The records an aggregate command produced, or its refusal as an HTTP error (as `assertCheck`). */
export function accepted<T>(outcome: Outcome<T>, Exception: HttpExceptionClass = ConflictException): T {
  if (outcome.ok) return outcome.value;
  throw refusalError(outcome, Exception);
}

function refusalError(refused: Refused, Exception: HttpExceptionClass): HttpException {
  const Refusing = refused.refusal ? REFUSALS[refused.refusal] : Exception;
  return new Refusing({ message: refused.reason, ...(refused.code && { type: PROBLEM_TYPES[refused.code] }) });
}
