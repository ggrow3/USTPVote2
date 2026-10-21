import { ApiModule } from './api/api.module.js';
import { createFastifyApp, listen } from './common/create-app.js';

await listen(await createFastifyApp(ApiModule));
