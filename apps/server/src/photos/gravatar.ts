import { createHash } from 'node:crypto';
import { MAX_PHOTO_BYTES, MAX_STORED_SIDE } from './image.js';

export const GRAVATAR_TIMEOUT_MS = 5_000;

/** Gravatar's key for an address: SHA-256 of the email, trimmed and lowercased (docs.gravatar.com/rest/hash). */
export function gravatarHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * `s`: the largest side we keep. `d=404`: an address with no picture answers 404 rather than a placeholder.
 * `r=g`: only pictures their owner rated G (Gravatar's default, stated so it cannot change under us).
 */
export function gravatarUrl(base: string, email: string): string {
  return `${base}/${gravatarHash(email)}?s=${MAX_STORED_SIDE}&d=404&r=g`;
}

/** `none`: no picture (or none rated G) for that address. The rest: Gravatar did not give us a usable image. */
export class GravatarError extends Error {
  constructor(
    readonly kind: 'none' | 'unavailable' | 'too-large' | 'not-image',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Fetches the picture Gravatar links to an address (design §5.3). Called only when the member asks; sends Gravatar
 * the hash, never the address, and refuses redirects, anything but an image, more than `maxBytes` and anything slower
 * than `timeoutMs` (headers and body together).
 */
export class GravatarClient {
  constructor(
    /** `DEFAULT_GRAVATAR_URL` in config.ts. */
    private readonly baseUrl: string,
    private readonly timeoutMs: number = GRAVATAR_TIMEOUT_MS,
    private readonly maxBytes: number = MAX_PHOTO_BYTES,
  ) {}

  async fetch(email: string): Promise<Buffer> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let res: Response | undefined;
    try {
      res = await fetch(gravatarUrl(this.baseUrl, email), {
        signal,
        redirect: 'manual',
        headers: { accept: 'image/*' },
      });
      if (res.status === 404) throw new GravatarError('none', 'no Gravatar picture for that address');
      if (res.status !== 200 || !res.body) throw new GravatarError('unavailable', `Gravatar answered ${res.status}`);
      if (!res.headers.get('content-type')?.startsWith('image/')) {
        throw new GravatarError('not-image', 'Gravatar did not answer with an image');
      }
      if (Number(res.headers.get('content-length')) > this.maxBytes) throw this.tooLarge();
      return await this.readAtMost(res.body);
    } catch (e) {
      // A body left unread holds its connection until it is garbage-collected; release it now.
      if (res?.body && !res.bodyUsed) await res.body.cancel().catch(() => undefined);
      if (e instanceof GravatarError) throw e;
      const timedOut = signal.aborted;
      throw new GravatarError('unavailable', timedOut ? 'Gravatar did not answer in time' : 'Gravatar could not be reached', {
        cause: e,
      });
    }
  }

  /** The body, stopping as soon as it passes `maxBytes` (a missing or false Content-Length cannot get round it). */
  private async readAtMost(body: ReadableStream<Uint8Array>): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      total += value.byteLength;
      if (total > this.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw this.tooLarge();
      }
      chunks.push(value);
    }
  }

  private tooLarge(): GravatarError {
    return new GravatarError('too-large', `the Gravatar picture is larger than ${this.maxBytes / (1024 * 1024)} MB`);
  }
}
