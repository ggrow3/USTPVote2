import { Logger } from '@nestjs/common';
import { accessToken } from '../infra/google-identity.js';
import type { RoomAssistant } from './room-assistant.js';

/**
 * How the api hands a question to the assistant (design §5.10): the room's model may need a minute or two to load, longer
 * than a request through Hosting may last, so the question runs elsewhere and its answer arrives as a message.
 */
export interface AssistantDispatch {
  send(jobId: string): Promise<void>;
}

export const ASSISTANT_DISPATCH = Symbol('AssistantDispatch');

/**
 * A Cloud Task on the worker queue (design §13) that posts `{jobId}` to the worker's `/tasks/room-assistant` with the
 * invoker account's OIDC token, as Cloud Scheduler calls the tick. Cloud Tasks retries a call that fails; the worker
 * answers each job once, so a retry finds it taken and does nothing.
 */
export class CloudTasksDispatch implements AssistantDispatch {
  constructor(
    private readonly queue: string,
    private readonly workerUrl: string,
    private readonly invoker: string,
  ) {}

  async send(jobId: string): Promise<void> {
    const res = await fetch(`https://cloudtasks.googleapis.com/v2/${this.queue}/tasks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        task: {
          dispatchDeadline: '300s',
          httpRequest: {
            httpMethod: 'POST',
            url: `${this.workerUrl}/tasks/room-assistant`,
            headers: { 'content-type': 'application/json' },
            body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
            oidcToken: { serviceAccountEmail: this.invoker, audience: this.workerUrl },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Cloud Tasks answered ${res.status}`);
  }
}

/** The emulator-only stand-in: the api answers the question itself, once it has replied to the request. */
export class InlineDispatch implements AssistantDispatch {
  private readonly logger = new Logger(InlineDispatch.name);

  constructor(private readonly assistant: RoomAssistant) {}

  async send(jobId: string): Promise<void> {
    setImmediate(() => {
      this.assistant.run(jobId).catch((e: unknown) => this.logger.warn(`room question ${jobId}: ${e instanceof Error ? e.message : e}`));
    });
  }
}

/** Cloud Tasks is not configured on this deployment. */
export class UnconfiguredDispatch implements AssistantDispatch {
  send(): Promise<void> {
    return Promise.reject(new Error('the assistant’s queue is not set up on this deployment'));
  }
}
