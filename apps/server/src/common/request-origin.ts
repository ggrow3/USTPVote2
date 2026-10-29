import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * The origin the caller reached the web app at. Firebase Hosting forwards `/v1/**` with X-Forwarded-Host and
 * X-Forwarded-Proto, which Fastify reads (trustProxy), so links in what is served point at the site it was fetched from.
 */
export function requestOrigin(req: FastifyRequest): string {
  const url = URL.parse(`${req.protocol}://${req.host}`);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) throw new BadRequestException('the request has no usable host');
  return url.origin;
}
