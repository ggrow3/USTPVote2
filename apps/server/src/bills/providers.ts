import type { Provider } from '@nestjs/common';
import { ApiKeys } from '../api-keys/api-keys.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { BILL_SOURCE, PublicBillSource } from './bill-source.js';
import { BillRepository } from './bill.repository.js';
import { BillsService } from './bills.service.js';
import { LocalBillSource } from './local-bill-source.js';
import { PublicBills } from './public-bills.js';
import { LocalRollCallSource, PublicRollCallSource, ROLL_CALL_SOURCE } from './roll-call-source.js';

/** Where bills and roll calls come from: Congress.gov, GovInfo and the Senate, or the emulator-only fixtures. */
const SOURCES: Provider[] = [
  {
    provide: BILL_SOURCE,
    inject: [CONFIG, ApiKeys],
    useFactory: (config: ServerConfig, keys: ApiKeys) =>
      config.billSource === 'local' ? new LocalBillSource() : new PublicBillSource(async () => (await keys.billsKey()).key),
  },
  {
    provide: ROLL_CALL_SOURCE,
    inject: [CONFIG, ApiKeys],
    useFactory: (config: ServerConfig, keys: ApiKeys) =>
      config.billSource === 'local' ? new LocalRollCallSource() : new PublicRollCallSource(async () => (await keys.billsKey()).key),
  },
];

/** Everything the bills context provides, for the API module to register (design §3.3, §5.14). */
export const BILLS_PROVIDERS: Provider[] = [BillRepository, BillsService, PublicBills, ...SOURCES];

/**
 * What the worker's tick needs: reading the public bills again every six hours (design §5.14, §13). The worker reads
 * the Congress.gov key as the api does, so it has its own `ApiKeys` (and Terraform gives it the key's secrets).
 */
export const BILLS_WORKER_PROVIDERS: Provider[] = [ApiKeys, BillRepository, PublicBills, ...SOURCES];
