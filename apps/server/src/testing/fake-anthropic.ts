/** What a fake Anthropic API saw of each request. */
export interface CapturedRequest {
  url?: string;
  headers?: Headers;
  body?: Record<string, unknown>;
}

/**
 * A `fetch` that answers like the Messages API's event stream, with `review` as the structured output, so the checkers
 * can be tested without calling Anthropic. Records the last request in `captured`.
 */
export function fakeAnthropic(review: unknown, captured: CapturedRequest = {}, model = 'claude-opus-5-5'): typeof globalThis.fetch {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: 30, cache_creation_input_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(review) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 120 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.headers = new Headers(init?.headers);
    captured.body = JSON.parse(String(init?.body));
    const sse = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return fetch as typeof globalThis.fetch;
}
