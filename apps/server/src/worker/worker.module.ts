import { Module } from '@nestjs/common';
import { HealthController } from '../common/health.controller.js';
import { TasksController } from './tasks.controller.js';

/** Background worker (design §13). Same image as the API, separate service account and Cloud Run service. */
@Module({
  controllers: [HealthController, TasksController],
})
export class WorkerModule {}
