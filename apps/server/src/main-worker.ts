import { createFastifyApp, listen } from './common/create-app.js';
import { WorkerModule } from './worker/worker.module.js';

await listen(await createFastifyApp(WorkerModule));
