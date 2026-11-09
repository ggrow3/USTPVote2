import type { Provider } from '@nestjs/common';
import { ApiKeys } from '../api-keys/api-keys.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { BILL_SOURCE, PublicBillSource } from './bill-source.js';
import { BillRepository } from './bill.repository.js';
import { BillsService } from './bills.service.js';
import { LocalBillSource } from './local-bill-source.js';

/** Everything the bills context provides, for the API module to register (design §3.3, §5.14). */
export const BILLS_PROVIDERS: Provider[] = [
  BillRepository,
  BillsService,
  {
    provide: BILL_SOURCE,
    inject: [CONFIG, ApiKeys],
    useFactory: (config: ServerConfig, keys: ApiKeys) =>
      config.billSource === 'local' ? new LocalBillSource() : new PublicBillSource(async () => (await keys.billsKey()).key),
  },
];
