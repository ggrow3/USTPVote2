import Anthropic, { APIError, AuthenticationError, NotFoundError, PermissionDeniedError } from '@anthropic-ai/sdk';

/** Why Anthropic would not take a key: it refused it, it does not offer a model to it, or it could not be asked. */
export type KeyTrial = { readonly ok: true } | { readonly ok: false; readonly refusal: 'rejected' | 'unreachable'; readonly reason: string };

/** Tries a pasted key before it is kept (design §5.6), so a typo shows at once rather than as failed checks. */
export interface AnthropicKeyTester {
  /** `models` are the ones the checks ask for; the key must reach each. */
  try(key: string, models: readonly string[]): Promise<KeyTrial>;
}

export const ANTHROPIC_KEY_TESTER = Symbol('AnthropicKeyTester');

/**
 * Asks Anthropic's Models API for each model the checks use: free, and it fails exactly as a check would for a key
 * that is wrong, revoked, or not allowed that model. Nothing but the key and the model names is sent.
 */
export class ClaudeKeyTester implements AnthropicKeyTester {
  constructor(
    /** For tests (a fake `fetch`). */
    private readonly clientOptions: ConstructorParameters<typeof Anthropic>[0] = {},
  ) {}

  async try(key: string, models: readonly string[]): Promise<KeyTrial> {
    const client = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 1, ...this.clientOptions });
    for (const model of new Set(models)) {
      try {
        await client.models.retrieve(model);
      } catch (e) {
        if (e instanceof APIError) return refusal(e, model);
        throw e;
      }
    }
    return { ok: true };
  }
}

/** Anthropic's answer in words. The SDK's message is not passed on: it is Anthropic's, and the panel says what to do. */
function refusal(e: APIError, model: string): KeyTrial {
  const rejected = (reason: string): KeyTrial => ({ ok: false, refusal: 'rejected', reason });
  if (e instanceof AuthenticationError) return rejected('Anthropic did not accept this key: check that it is complete and has not been deleted');
  if (e instanceof PermissionDeniedError) return rejected('Anthropic recognized this key but does not let it use the API');
  if (e instanceof NotFoundError) return rejected(`Anthropic does not offer ${model}, the model the checks use, to this key`);
  // A connection error, a timeout, rate limiting or Anthropic's own failure: the key may be fine.
  return { ok: false, refusal: 'unreachable', reason: 'Anthropic could not be asked about this key just now; nothing was saved, so try again shortly' };
}

/** With the emulators nothing goes to Anthropic: a key of the right shape is kept untried (CI and local development). */
export class UntriedKeyTester implements AnthropicKeyTester {
  async try(): Promise<KeyTrial> {
    return { ok: true };
  }
}
