import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProblemDetails } from 'ustp-domain';

/** Every error leaves the API as RFC 9457 problem details; unexpected errors never leak internals. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let type = 'about:blank';
    let detail: string | undefined;
    let errors: ProblemDetails['errors'];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as { message?: unknown; type?: unknown; errors?: ProblemDetails['errors'] };
        detail = Array.isArray(b.message) ? b.message.join('; ') : typeof b.message === 'string' ? b.message : undefined;
        if (typeof b.type === 'string') type = b.type;
        errors = b.errors;
      }
    } else {
      // One entry with the stack trace, which Error Reporting groups; the request's id, trace, handler and caller are
      // added by the logger (design §14, "Logging").
      this.logger.error(exception instanceof Error ? exception : new Error(String(exception)));
    }
    // The request's own line says why it was refused, where the refusal has a type.
    const log = host.switchToHttp().getRequest<FastifyRequest>().logContext;
    if (log && type !== 'about:blank') log.problemType = type;

    const problem: ProblemDetails = {
      type,
      title: HttpStatus[status]?.toString().replaceAll('_', ' ').toLowerCase() ?? 'error',
      status,
      ...(detail !== undefined && { detail }),
      ...(errors !== undefined && { errors }),
    };
    void reply.status(status).header('content-type', 'application/problem+json').send(problem);
  }
}
