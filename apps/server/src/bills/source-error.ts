import { BadGatewayException, HttpException, HttpStatus } from '@nestjs/common';
import { BillSourceError } from './bill-source.js';

/** The status a service's failure has (design §5.14): its hourly limit 429, anything else 502. */
export function sourceError(e: unknown): never {
  if (e instanceof BillSourceError) {
    if (e.kind === 'rate_limited') throw new HttpException({ message: e.message }, HttpStatus.TOO_MANY_REQUESTS);
    throw new BadGatewayException(e.message);
  }
  throw e;
}
