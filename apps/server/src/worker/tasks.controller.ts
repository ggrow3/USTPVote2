import { Controller, HttpCode, NotFoundException, NotImplementedException, Param, Post } from '@nestjs/common';

/** Worker task endpoints (design §13), invoked by Cloud Scheduler and Cloud Tasks with OIDC tokens. */
export const WORKER_TASKS = ['tick', 'tally', 'photo-check', 'email', 'destroy-pool-key'] as const;
export type WorkerTask = (typeof WORKER_TASKS)[number];

@Controller('tasks')
export class TasksController {
  @Post(':task')
  @HttpCode(202)
  run(@Param('task') task: string) {
    if (!(WORKER_TASKS as readonly string[]).includes(task)) throw new NotFoundException(`unknown task ${task}`);
    throw new NotImplementedException(`task ${task} is not implemented yet`);
  }
}
