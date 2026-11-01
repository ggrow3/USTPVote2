import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Put,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  API_KEY_NAMES,
  API_KEY_SECRETS,
  apiKeyHint,
  apiKeyNameSchema,
  apiKeySchema,
  checkApiKey,
  Collections,
  type AccountRecord,
  type ApiKeyChangedPayload,
  type ApiKeyInput,
  type ApiKeyName,
  type ApiKeyRecord,
  type ApiKeysStatus,
  type ApiKeyStatus,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { SECRET_STORE, type SecretStore } from '../infra/secret-store.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ApiKeys } from './api-keys.js';
import { API_KEY_TESTER, type ApiKeyTester } from './key-tester.js';

/**
 * A System Admin adds, replaces or removes a public-records service's key (design §5.6), as they do the Anthropic API
 * key. The key goes from the request to its service (to try it) and to Secret Manager, and nowhere else: no record,
 * ledger entry, log line or answer holds it. Each change is ledgered.
 */
@Injectable()
export class ApiKeysAdminService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly keys: ApiKeys,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(API_KEY_TESTER) private readonly tester: ApiKeyTester,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async status(): Promise<ApiKeysStatus> {
    return { keys: await Promise.all(API_KEY_NAMES.map((name) => this.one(name))), tried: !this.config.usingEmulators };
  }

  /** Tries the key, then keeps it as its secret's only live version. A key its service refuses is never kept. */
  async add(ctx: RequestContext, name: string, input: ApiKeyInput): Promise<ApiKeysStatus> {
    const actor = requireAccount(ctx);
    const key = known(name);
    assertCheck(checkApiKey(key, input.key), BadRequestException);
    const trial = await this.tester.try(key, input.key);
    if (!trial.ok) {
      throw trial.refusal === 'unreachable' ? new BadGatewayException(trial.reason) : new UnprocessableEntityException(trial.reason);
    }
    const db = this.firebase.db;
    const account = (await db.collection(Collections.accounts).doc(actor).get()).data() as AccountRecord | undefined;
    const version = await this.secrets.replace(API_KEY_SECRETS[key], input.key);
    const record: ApiKeyRecord = {
      version,
      hint: apiKeyHint(input.key),
      addedAt: new Date().toISOString(),
      addedBy: actor,
      addedByName: account?.displayName || account?.primaryEmail || actor,
    };
    await db.runTransaction(async (tx) => {
      const payload: ApiKeyChangedPayload = { key, change: 'added' };
      await this.ledger.record(tx, [{ type: 'api_key.changed', actor, subject: null, payload: { ...payload } }]);
      tx.set(this.recordRef(key), record);
    });
    this.keys.invalidate(key);
    return this.status();
  }

  /** Destroys every version, so the deployment's own key (if it has one) is used again. */
  async remove(ctx: RequestContext, name: string): Promise<ApiKeysStatus> {
    const actor = requireAccount(ctx);
    const key = known(name);
    if (!(await this.keys.version(key))) throw new NotFoundException('no key was added here for this service, so there is none to remove');
    await this.secrets.clear(API_KEY_SECRETS[key]);
    await this.firebase.db.runTransaction(async (tx) => {
      const payload: ApiKeyChangedPayload = { key, change: 'removed' };
      await this.ledger.record(tx, [{ type: 'api_key.changed', actor, subject: null, payload: { ...payload } }]);
      tx.delete(this.recordRef(key));
    });
    this.keys.invalidate(key);
    return this.status();
  }

  private async one(name: ApiKeyName): Promise<ApiKeyStatus> {
    const [version, snap] = await Promise.all([this.keys.version(name), this.recordRef(name).get()]);
    const record = snap.data() as ApiKeyRecord | undefined;
    // Who added it is known only for a key added here; one added with gcloud since is just "added".
    const ours = version && record?.version === version.name ? record : null;
    const deploymentKey = this.keys.deployment(name) !== null;
    return {
      name,
      source: version ? 'app' : deploymentKey ? 'deployment' : 'none',
      addedAt: version?.createdAt ?? null,
      addedBy: ours ? { accountId: ours.addedBy, name: ours.addedByName } : null,
      hint: ours?.hint ?? null,
      deploymentKey,
    };
  }

  private recordRef(name: ApiKeyName) {
    return this.firebase.db.collection(Collections.apiKeys).doc(name);
  }
}

function known(name: string): ApiKeyName {
  const parsed = apiKeyNameSchema.safeParse(name);
  if (!parsed.success) throw new NotFoundException('there is no such key here');
  return parsed.data;
}

/** The public-records services' keys (design §5.6): which is in use and who added it, never a key. */
@Controller('v1/admin/api-keys')
@Roles('system_admin')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysAdminService) {}

  @Get()
  status() {
    return this.keys.status();
  }

  @Put(':name')
  add(@Ctx() ctx: RequestContext, @Param('name') name: string, @Body(new ZodPipe(apiKeySchema)) body: ApiKeyInput) {
    return this.keys.add(ctx, name, body);
  }

  @Delete(':name')
  remove(@Ctx() ctx: RequestContext, @Param('name') name: string) {
    return this.keys.remove(ctx, name);
  }
}
