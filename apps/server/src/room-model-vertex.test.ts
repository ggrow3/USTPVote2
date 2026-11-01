import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FEED, EMPTY_METER, type RoomFeedRecord, type RoomModelMeterRecord } from 'ustp-domain';
import { loadConfig, type RoomVertexConfig, type ServerConfig } from './config.js';
import type { Firebase } from './infra/firebase.js';
import { configName, modelHash, RoomModelDeployment } from './room/room-model-deployment.js';
import { OllamaRoomModel, RoomModelWaking } from './room/room-model.js';
import type { RoomRepository } from './room/room.repository.js';

vi.mock('./infra/google-identity.js', () => ({ accessToken: async () => 'access-token', idToken: async () => 'id-token' }));

const ENDPOINT = 'projects/ustp-test/locations/us-central1/endpoints/1000';
const VERTEX: RoomVertexConfig = {
  endpoint: ENDPOINT,
  hourlyUsd: 0.98,
  idleMinutes: 30,
  monthlyBudgetUsd: 15,
  model: { containerSpec: { imageUri: 'us-central1-docker.pkg.dev/ustp-test/ustpvote/room-model@sha256:abc', invokeRoutePrefix: '/*' } },
  deployedModel: { serviceAccount: 'ustp-room-model@ustp-test.iam.gserviceaccount.com', dedicatedResources: { minReplicaCount: 0 } },
};
const NAME = configName(VERTEX);
const MODEL = 'projects/1/locations/us-central1/models/77';

afterEach(() => vi.unstubAllGlobals());

/** Vertex AI as the worker sees it: an endpoint's deployed models and the uploaded ones, recording every change asked for. */
function fakeVertex(state: { deployed: { id: string; displayName: string }[]; models: { name: string; labels: Record<string, string> }[] }) {
  const asked: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = decodeURIComponent(new URL(url).pathname + new URL(url).search).replace('/v1beta1/', '');
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer access-token');
    if (init.method === 'POST') asked.push({ method: 'POST', path, body });
    if (init.method === 'GET' && path === ENDPOINT) return Response.json({ name: ENDPOINT, deployedModels: state.deployed });
    if (init.method === 'GET' && path.startsWith('projects/ustp-test/locations/us-central1/models?filter=')) {
      const hash = /labels\.room_model="([0-9a-f]+)"/.exec(path)![1];
      return Response.json({ models: state.models.filter((m) => m.labels.room_model === hash) });
    }
    return Response.json({ name: 'operations/1' });
  });
  return asked;
}

/** The worker's deployment step with the room's switch and meter in memory. */
function deployment(feed: Partial<RoomFeedRecord> = {}, meter: RoomModelMeterRecord = EMPTY_METER, vertex = VERTEX) {
  const store = { meter };
  const repo = {
    findFeed: async () => ({ ...EMPTY_FEED, ...feed }),
    findModelMeter: async () => store.meter,
    getModelMeter: async () => store.meter,
    setModelMeter: (_tx: unknown, m: RoomModelMeterRecord) => (store.meter = m),
  } as unknown as RoomRepository;
  const firebase = { db: { runTransaction: (fn: (tx: unknown) => unknown) => fn({}) } } as unknown as Firebase;
  const config = { roomModel: 'ollama', room: { vertex } } as unknown as ServerConfig;
  return { step: new RoomModelDeployment(config, firebase, repo), store };
}

describe('the room model on Vertex AI (design §5.10)', () => {
  it('uploads the model once, then deploys it, charging the deployment like a wake-up', async () => {
    const asked = fakeVertex({ deployed: [], models: [] });
    const { step, store } = deployment();
    expect(await step.reconcile()).toBe('uploading');
    expect(asked).toEqual([
      {
        method: 'POST',
        path: 'projects/ustp-test/locations/us-central1/models:upload',
        body: { model: { ...VERTEX.model, displayName: `room-model-${modelHash(VERTEX)}`, labels: { room_model: modelHash(VERTEX) } } },
      },
    ]);
    // The next tick, while the upload runs, does not start another.
    expect(await step.reconcile()).toBe('uploading');
    expect(asked).toHaveLength(1);

    const deploys = fakeVertex({ deployed: [], models: [{ name: MODEL, labels: { room_model: modelHash(VERTEX) } }] });
    expect(await step.reconcile()).toBe('deploying');
    expect(deploys).toEqual([
      {
        method: 'POST',
        path: `${ENDPOINT}:deployModel`,
        body: { deployedModel: { ...VERTEX.deployedModel, model: MODEL, displayName: NAME }, trafficSplit: { '0': 100 } },
      },
    ]);
    expect(store.meter).toMatchObject({ wakeUps: 1, deploy: { config: NAME, step: 'deploy' } });
    expect(await step.reconcile()).toBe('deploying');
    expect(deploys).toHaveLength(1);
  });

  it('keeps one deployed model, the current one, and takes the rest away', async () => {
    const asked = fakeVertex({ deployed: [{ id: '1', displayName: 'room-model-old' }, { id: '2', displayName: NAME }], models: [] });
    expect(await deployment().step.reconcile()).toBe('undeployed');
    expect(asked).toEqual([{ method: 'POST', path: `${ENDPOINT}:undeployModel`, body: { deployedModelId: '1' } }]);
    fakeVertex({ deployed: [{ id: '2', displayName: NAME }], models: [] });
    expect(await deployment().step.reconcile()).toBe('ready');
  });

  it('takes the model away while its server is switched off, or the month is stopped', async () => {
    const asked = fakeVertex({ deployed: [{ id: '2', displayName: NAME }], models: [] });
    expect(await deployment({ serverOn: false }).step.reconcile()).toBe('undeployed');
    expect(asked).toEqual([{ method: 'POST', path: `${ENDPOINT}:undeployModel`, body: { deployedModelId: '2' } }]);
    fakeVertex({ deployed: [], models: [] });
    expect(await deployment({ serverOn: false }).step.reconcile()).toBe('off');
    const stopped = { ...EMPTY_METER, month: new Date().toISOString().slice(0, 7), stoppedAt: new Date().toISOString() };
    fakeVertex({ deployed: [], models: [] });
    expect(await deployment({}, stopped).step.reconcile()).toBe('off');
  });

  it('does not deploy when the month’s budget cannot cover starting it', async () => {
    const asked = fakeVertex({ deployed: [], models: [{ name: MODEL, labels: { room_model: modelHash(VERTEX) } }] });
    expect(await deployment({}, EMPTY_METER, { ...VERTEX, monthlyBudgetUsd: 0.5 }).step.reconcile()).toBe('budget');
    expect(asked).toEqual([]);
  });

  it('stops the model when Google Cloud’s budget reports this month’s bill at the budget', async () => {
    const notice = (costAmount: number, start = new Date().toISOString().slice(0, 7) + '-01T07:00:00Z') => ({
      message: { data: Buffer.from(JSON.stringify({ costAmount, budgetAmount: 15, costIntervalStart: start })).toString('base64') },
    });
    const asked = fakeVertex({ deployed: [{ id: '2', displayName: NAME }], models: [] });
    const { step, store } = deployment();
    expect(await step.budgetNotice(notice(9.5))).toBe(false);
    expect(await step.budgetNotice(notice(16, '2020-01-01T08:00:00Z'))).toBe(false);
    expect(await step.budgetNotice({ message: { data: 'not base64 json' } })).toBe(false);
    expect(await step.budgetNotice(notice(15.2))).toBe(true);
    expect(store.meter.stoppedAt).not.toBeNull();
    expect(asked).toEqual([{ method: 'POST', path: `${ENDPOINT}:undeployModel`, body: { deployedModelId: '2' } }]);
    expect(await step.budgetNotice(notice(15.4))).toBe(false);
  });
});

describe('calling the model through Vertex AI', () => {
  it('tries again while Vertex AI says the model is starting, with an access token', async () => {
    const statuses = [429, 429, 200];
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>).authorization}`);
      const status = statuses.shift()!;
      return status === 200 ? Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }] }) : new Response('waking', { status });
    });
    const model = new OllamaRoomModel('https://1000.us-central1-1.prediction.vertexai.goog/v1/x/invoke', 'gemma', 'embed', 'access-token', 10_000, 5);
    expect(await model.embed(['hello'], 'query', Date.now() + 5_000)).toEqual([[0.1, 0.2]]);
    expect(seen).toEqual(Array(3).fill('https://1000.us-central1-1.prediction.vertexai.goog/v1/x/invoke/v1/embeddings Bearer access-token'));
  });

  it('gives up with RoomModelWaking at the deadline or after waiting its share, and treats 429 from Cloud Run as an error', async () => {
    vi.stubGlobal('fetch', async () => new Response('waking', { status: 429 }));
    const vertex = new OllamaRoomModel('https://vertex.example/invoke', 'gemma', 'embed', 'access-token', 10_000, 5);
    await expect(vertex.embed(['hello'], 'query', Date.now() + 30)).rejects.toBeInstanceOf(RoomModelWaking);
    // A run with minutes left still stops waiting after wakeWaitMs, leaving the next try a whole run.
    const patient = new OllamaRoomModel('https://vertex.example/invoke', 'gemma', 'embed', 'access-token', 10_000, 5, 40);
    const started = Date.now();
    await expect(patient.embed(['hello'], 'query', Date.now() + 60_000)).rejects.toBeInstanceOf(RoomModelWaking);
    expect(Date.now() - started).toBeLessThan(1_000);
    const cloudRun = new OllamaRoomModel('https://room-model.example', 'gemma', 'embed');
    await expect(cloudRun.embed(['hello'], 'query', Date.now() + 1_000)).rejects.toThrow('the model answered 429');
  });
});

describe('ROOM_MODEL_VERTEX', () => {
  const env = (vertex: unknown) => ({ ROOM_MODEL: 'ollama', ROOM_MODEL_URL: 'https://vertex.example/invoke', ROOM_MODEL_VERTEX: JSON.stringify(vertex) });

  it('reads what Terraform writes', () => {
    expect(loadConfig(env(VERTEX)).room.vertex).toEqual(VERTEX);
    expect(loadConfig({ ROOM_MODEL: 'ollama', ROOM_MODEL_URL: 'https://room-model.example' }).room.vertex).toBeNull();
  });

  it('refuses a broken one at start-up', () => {
    expect(() => loadConfig(env({ ...VERTEX, endpoint: 'endpoints/1000' }))).toThrow('ROOM_MODEL_VERTEX.endpoint');
    expect(() => loadConfig(env({ ...VERTEX, idleMinutes: 2 }))).toThrow('idleMinutes');
    expect(() => loadConfig(env({ ...VERTEX, monthlyBudgetUsd: -1 }))).toThrow('monthlyBudgetUsd');
    expect(() => loadConfig({ ...env(VERTEX), ROOM_MODEL: 'off' })).toThrow('ROOM_MODEL=ollama');
    expect(() => loadConfig({ ...env(VERTEX), ROOM_MODEL_VERTEX: '{' })).toThrow('must be JSON');
  });
});
