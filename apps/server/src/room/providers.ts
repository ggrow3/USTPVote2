import type { Provider } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../config.js';
import { RoomAssistant } from './room-assistant.js';
import { ASSISTANT_DISPATCH, CloudTasksDispatch, InlineDispatch, UnconfiguredDispatch } from './room-dispatch.js';
import { RoomEntry } from './room-entry.js';
import { RoomFeedWatcher } from './room-feed.js';
import { RoomRetention } from './room-retention.js';
import { LocalRoomModel, NoRoomModel, OllamaRoomModel, ROOM_MODEL } from './room-model.js';
import { RoomRepository } from './room.repository.js';
import { RoomService } from './room.service.js';

/** The room's model as the deployment sets it (design §5.10). */
const roomModelProvider: Provider = {
  provide: ROOM_MODEL,
  inject: [CONFIG],
  useFactory: (config: ServerConfig) =>
    config.roomModel === 'ollama'
      ? new OllamaRoomModel(config.room.modelUrl!, config.room.chatModel, config.room.embedModel)
      : config.roomModel === 'local'
        ? new LocalRoomModel()
        : new NoRoomModel(),
};

/** Everything the room context provides, for the API module to register (design §3.3, §5.10). */
export const ROOM_PROVIDERS: Provider[] = [
  RoomRepository,
  RoomFeedWatcher,
  RoomAssistant,
  RoomService,
  RoomEntry,
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

/** What the worker needs: answering questions, and the tick's retention step (design §13). */
export const ROOM_WORKER_PROVIDERS: Provider[] = [RoomRepository, RoomAssistant, RoomRetention, roomModelProvider];
