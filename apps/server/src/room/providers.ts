import type { Provider } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../config.js';
import { RoomAssistant } from './room-assistant.js';
import { Firebase } from '../infra/firebase.js';
import { ASSISTANT_DISPATCH, CloudTasksDispatch, InlineDispatch, UnconfiguredDispatch } from './room-dispatch.js';
import { RoomFeedWatcher } from './room-feed.js';
import { RoomRetention } from './room-retention.js';
import { RoomModelDeployment } from './room-model-deployment.js';
import { MeteredRoomModel } from './room-model-meter.js';
import { LocalRoomModel, NoRoomModel, OllamaRoomModel, ROOM_MODEL } from './room-model.js';
import { RoomRepository } from './room.repository.js';
import { RoomService } from './room.service.js';

/** The room's model as the deployment sets it (design §5.10); on Vertex AI, behind its monthly cap. */
const roomModelProvider: Provider = {
  provide: ROOM_MODEL,
  inject: [CONFIG, Firebase, RoomRepository],
  useFactory: (config: ServerConfig, firebase: Firebase, repo: RoomRepository) => {
    if (config.roomModel === 'local') return new LocalRoomModel();
    if (config.roomModel !== 'ollama') return new NoRoomModel();
    const { modelUrl, chatModel, embedModel, vertex } = config.room;
    if (!vertex) return new OllamaRoomModel(modelUrl!, chatModel, embedModel);
    return new MeteredRoomModel(new OllamaRoomModel(modelUrl!, chatModel, embedModel, 'access-token'), firebase, repo, vertex);
  },
};

/** Everything the room context provides, for the API module to register (design §3.3, §5.10). */
export const ROOM_PROVIDERS: Provider[] = [
  RoomRepository,
  RoomFeedWatcher,
  RoomAssistant,
  RoomService,
  roomModelProvider,
  {
    provide: ASSISTANT_DISPATCH,
    inject: [CONFIG, RoomAssistant],
    useFactory: (config: ServerConfig, assistant: RoomAssistant) => {
      if (config.room.dispatch === 'inline') return new InlineDispatch(assistant);
      const { tasksQueue, workerUrl, tasksInvoker } = config.room;
      return tasksQueue && workerUrl && tasksInvoker ? new CloudTasksDispatch(tasksQueue, workerUrl, tasksInvoker) : new UnconfiguredDispatch();
    },
  },
];

/** What the worker needs: answering questions, and the tick's retention and model deployment steps (design §13). */
export const ROOM_WORKER_PROVIDERS: Provider[] = [RoomRepository, RoomAssistant, RoomRetention, RoomModelDeployment, roomModelProvider];
