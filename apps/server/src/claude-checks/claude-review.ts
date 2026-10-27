import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BylawsCheckUsage } from 'ustp-domain';
import type { z } from 'zod';

/** One text block of the request; `cache` puts a prompt-cache breakpoint after it, so what comes before is reused. */
export interface ReviewBlock {
  readonly text: string;
  readonly cache?: boolean;
}

export interface ClaudeReview<T> {
  readonly review: T;
  /** The model that answered (a fallback model if the requested one declined). */
  readonly model: string;
  readonly usage: BylawsCheckUsage;
}

/** A client for the worker's checks: under its 300-second request limit, with one retry for a dropped connection. */
export function reviewClient(apiKey: string, clientOptions: ConstructorParameters<typeof Anthropic>[0] = {}): Anthropic {
  return new Anthropic({ apiKey, timeout: 240_000, maxRetries: 1, ...clientOptions });
}

/**
 * One advisory review by Claude through the Anthropic API, as the bylaws and consistency checks make it (design §5.4,
 * §5.5): a fixed system prompt, then the blocks of the user turn, streamed, with adaptive thinking at effort `high` and
 * the answer held to `schema` by structured output. `fallbacks: "default"` lets the API retry a request its safety
 * classifiers decline on Anthropic's recommended fallback model. A refusal, a truncated answer or one in another form
 * throws, and so does an API error.
 */
export async function claudeReview<S extends z.ZodType>(
  client: Anthropic,
  request: { readonly model: string; readonly system: string; readonly blocks: readonly ReviewBlock[]; readonly schema: S },
): Promise<ClaudeReview<z.infer<S>>> {
  const stream = client.beta.messages.stream({
    model: request.model,
    max_tokens: 32_000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(request.schema) },
    system: request.system,
    messages: [
      {
        role: 'user',
        content: request.blocks.map((block) => ({
          type: 'text' as const,
          text: block.text,
          ...(block.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
        })),
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error(`Claude declined to review this text${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`);
  }
  if (message.stop_reason === 'max_tokens') throw new Error('the review was cut off before it finished');
  const review = message.parsed_output;
  if (!review) throw new Error('the review did not come back in the expected form');
  return {
    review,
    model: message.model,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
