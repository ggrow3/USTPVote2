import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { chargeMeter, modelStopped, stopModel, type RoomModelMeterRecord } from 'ustp-domain';
import { CONFIG, type RoomVertexConfig, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { accessToken } from '../infra/google-identity.js';
import { RoomRepository } from './room.repository.js';

/** An upload or deployment that has not finished in this long is tried again (Vertex AI takes up to half an hour). */
const RETRY_MS = 60 * 60_000;

/** What a tick found or did: nothing to do, the model ready, or a step of getting it there or taking it away. */
export type DeploymentStep = 'not-vertex' | 'off' | 'ready' | 'uploading' | 'deploying' | 'undeployed' | 'budget';

interface DeployedModel {
  readonly id: string;
  readonly displayName?: string;
}

/** A Pub/Sub push of Google Cloud's budget for the model (its notification's fields that matter here). */
interface BudgetNotice {
  readonly costAmount?: number;
  readonly budgetAmount?: number;
  readonly costIntervalStart?: string;
}

/**
 * The room's model on Vertex AI (design §5.10), kept as the deployment and the switches say by the worker's tick: while
 * the model server is switched on and the month's budget is not spent, the endpoint has exactly one deployed model, the
 * one Terraform describes (named by a hash of that description, so a changed one is uploaded and deployed anew and the
 * old one then taken away); otherwise it has none, and no machine can run. Vertex AI scales the deployed model to zero
 * after it idles, and deploying it starts a machine, charged to the month like a wake-up.
 */
@Injectable()
export class RoomModelDeployment {
  private readonly logger = new Logger(RoomModelDeployment.name);
  private readonly vertex: RoomVertexConfig | null;

  constructor(
    @Inject(CONFIG) config: ServerConfig,
    private readonly firebase: Firebase,
    private readonly repo: RoomRepository,
  ) {
    this.vertex = config.roomModel === 'ollama' ? config.room.vertex : null;
  }

  /** One step towards how the endpoint should be; for the tick. */
  async reconcile(): Promise<DeploymentStep> {
    const vertex = this.vertex;
    if (!vertex) return 'not-vertex';
    const at = new Date().toISOString();
    const [feed, meter, endpoint] = await Promise.all([
      this.repo.findFeed(),
      this.repo.findModelMeter(),
      this.call<{ deployedModels?: DeployedModel[] }>('GET', vertex.endpoint),
    ]);
    const deployed = endpoint.deployedModels ?? [];

    if (!feed.serverOn || modelStopped(meter, at) || vertex.monthlyBudgetUsd <= 0) {
      for (const d of deployed) await this.undeploy(vertex, d);
      return deployed.length ? 'undeployed' : 'off';
    }

    const name = configName(vertex);
    const current = deployed.find((d) => d.displayName === name);
    if (current) {
      const old = deployed.filter((d) => d !== current);
      for (const d of old) await this.undeploy(vertex, d);
      return old.length ? 'undeployed' : 'ready';
    }

    const model = await this.findModel(vertex);
    const step = model ? 'deploy' : 'upload';
    const started = await this.firebase.db.runTransaction(async (tx) => {
      const m = await this.repo.getModelMeter(tx);
      if (inFlight(m, name, step, at)) return 'waiting' as const;
      // Deploying starts a machine at once: charged like a wake-up, and only within the cap.
      const charged = step === 'deploy' ? chargeMeter(m, at, vertex) : null;
      if (charged && !charged.allowed) return 'budget' as const;
      this.repo.setModelMeter(tx, { ...(charged?.allowed ? charged.meter : m), deploy: { config: name, step, startedAt: at } });
      return 'started' as const;
    });
    if (started === 'budget') return 'budget';
    if (started === 'started') {
      if (model) await this.deploy(vertex, model, name);
      else await this.upload(vertex);
    }
    return model ? 'deploying' : 'uploading';
  }

  /**
   * Google Cloud's budget for the model, pushed through Pub/Sub: once this month's real bill reaches the budget, the
   * month is stopped and the model taken away at once. A notice about an earlier month, or under the budget, changes
   * nothing. True if it stopped the model.
   */
  async budgetNotice(body: unknown): Promise<boolean> {
    if (!this.vertex) return false;
    const notice = decodeBudgetNotice(body);
    const at = new Date().toISOString();
    if (!notice || notice.costIntervalStart?.slice(0, 7) !== at.slice(0, 7)) return false;
    if (!(typeof notice.costAmount === 'number' && typeof notice.budgetAmount === 'number' && notice.costAmount >= notice.budgetAmount)) return false;
    const stopped = await this.firebase.db.runTransaction(async (tx) => {
      const m = await this.repo.getModelMeter(tx);
      if (modelStopped(m, at)) return false;
      this.repo.setModelMeter(tx, stopModel(m, at));
      return true;
    });
    if (stopped) {
      this.logger.warn(`room model stopped: Google Cloud's budget reports $${notice.costAmount} of $${notice.budgetAmount} this month`);
      await this.reconcile();
    }
    return stopped;
  }

  /** The uploaded model with this configuration's container, if any: a change to how it is deployed needs no new upload. */
  private async findModel(vertex: RoomVertexConfig): Promise<string | null> {
    const filter = encodeURIComponent(`labels.room_model="${modelHash(vertex)}"`);
    const found = await this.call<{ models?: { name: string }[] }>('GET', `${parent(vertex)}/models?filter=${filter}`);
    return found.models?.[0]?.name ?? null;
  }

  private async upload(vertex: RoomVertexConfig): Promise<void> {
    const hash = modelHash(vertex);
    const labels = { ...((vertex.model.labels as Record<string, string> | undefined) ?? {}), room_model: hash };
    await this.call('POST', `${parent(vertex)}/models:upload`, { model: { ...vertex.model, displayName: `room-model-${hash}`, labels } });
    this.logger.log(`room model ${hash} uploading to Vertex AI`);
  }

  private async deploy(vertex: RoomVertexConfig, model: string, name: string): Promise<void> {
    await this.call('POST', `${vertex.endpoint}:deployModel`, {
      deployedModel: { ...vertex.deployedModel, model, displayName: name },
      trafficSplit: { '0': 100 },
    });
    this.logger.log(`room model ${name} deploying to ${vertex.endpoint}`);
  }

  private async undeploy(vertex: RoomVertexConfig, d: DeployedModel): Promise<void> {
    await this.call('POST', `${vertex.endpoint}:undeployModel`, { deployedModelId: d.id });
    this.logger.log(`room model ${d.displayName ?? d.id} taken off ${vertex.endpoint}`);
  }

  /** A call to Vertex AI's API in the endpoint's region, as the worker's account. */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const region = /\/locations\/([^/]+)\//.exec(path)?.[1];
    const res = await fetch(`https://${region}-aiplatform.googleapis.com/v1beta1/${path}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Vertex AI answered ${res.status} to ${method} ${path.replace(/\?.*$/, '')}`);
    return (await res.json()) as T;
  }
}

/** The deployment's name on Vertex AI: `room-model-` and a hash of the model and how it is deployed. */
export function configName(vertex: RoomVertexConfig): string {
  return `room-model-${shortHash({ model: vertex.model, deployedModel: vertex.deployedModel })}`;
}

/** The uploaded model's label: a hash of the model alone. */
export const modelHash = (vertex: RoomVertexConfig): string => shortHash(vertex.model);

const shortHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

/** `projects/{p}/locations/{l}`, from the endpoint's name. */
const parent = (vertex: RoomVertexConfig): string => vertex.endpoint.replace(/\/endpoints\/[^/]+$/, '');

/** Whether this step for this configuration was started within the hour (so is still running, or failed recently). */
function inFlight(meter: RoomModelMeterRecord, name: string, step: 'upload' | 'deploy', at: string): boolean {
  const d = meter.deploy;
  return !!d && d.config === name && d.step === step && Date.parse(at) - Date.parse(d.startedAt) < RETRY_MS;
}

/** A Pub/Sub push body (`{message: {data}}`, the data base64 JSON), or null if it is not one. */
function decodeBudgetNotice(body: unknown): BudgetNotice | null {
  const data = (body as { message?: { data?: unknown } } | null)?.message?.data;
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as BudgetNotice;
  } catch {
    return null;
  }
}
