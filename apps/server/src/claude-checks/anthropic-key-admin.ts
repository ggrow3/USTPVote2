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
  Put,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ANTHROPIC_KEY_SECRET,
  anthropicKeyHint,
  anthropicKeySchema,
  checkAnthropicKey,
  Collections,
  type AccountRecord,
  type AnthropicKeyChangedPayload,
  type AnthropicKeyInput,
  type AnthropicKeyRecord,
  type AnthropicKeyStatus,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { Firebase } from '../infra/firebase.js';
import { SECRET_STORE, type SecretStore } from '../infra/secret-store.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AnthropicKey } from './anthropic-key.js';
import { ANTHROPIC_KEY_TESTER, type AnthropicKeyTester } from './key-tester.js';

/**
 * A System Admin adds, replaces or removes the Anthropic API key the Claude checks use (design §5.6). The key goes from
 * the request to Anthropic (to try it) and to Secret Manager, and nowhere else: no record, ledger entry, log line or
 * answer holds it. Each change is ledgered.
 */
@Injectable()
export class AnthropicKeyAdminService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
    private readonly key: AnthropicKey,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(ANTHROPIC_KEY_TESTER) private readonly tester: AnthropicKeyTester,
    @Inject(CONFIG) private readonly config: ServerConfig,
  ) {}

  async status(): Promise<AnthropicKeyStatus> {
    const version = await this.key.current({ fresh: true });
    const record = (await this.recordRef().get()).data() as AnthropicKeyRecord | undefined;
    // Who added it is known only for a key added here; one added with gcloud since is just "set".
    const ours = version && record?.version === version.name ? record : null;
    return {
      set: !!version,
      addedAt: version?.createdAt ?? null,
      addedBy: ours ? { accountId: ours.addedBy, name: ours.addedByName } : null,
      hint: ours?.hint ?? null,
      checks: { bylaws: this.config.bylawsChecker, consistency: this.config.consistencyChecker },
      tried: !this.config.usingEmulators,
    };
  }

  /** Tries the key, then keeps it as the secret's only live version. A key Anthropic refuses is never kept. */
  async add(ctx: RequestContext, input: AnthropicKeyInput): Promise<AnthropicKeyStatus> {
    const actor = requireAccount(ctx);
    assertCheck(checkAnthropicKey(input.key), BadRequestException);
    const trial = await this.tester.try(input.key, [this.config.bylawsCheckModel, this.config.consistencyCheckModel]);
    if (!trial.ok) {
      throw trial.refusal === 'unreachable' ? new BadGatewayException(trial.reason) : new UnprocessableEntityException(trial.reason);
    }
    const db = this.firebase.db;
    const account = (await db.collection(Collections.accounts).doc(actor).get()).data() as AccountRecord | undefined;
    const version = await this.secrets.replace(ANTHROPIC_KEY_SECRET, input.key);
    const record: AnthropicKeyRecord = {
      version,
      hint: anthropicKeyHint(input.key),
      addedAt: new Date().toISOString(),
      addedBy: actor,
      addedByName: account?.displayName || account?.primaryEmail || actor,
    };
    await db.runTransaction(async (tx) => {
      const payload: AnthropicKeyChangedPayload = { change: 'added' };
      await this.ledger.record(tx, [{ type: 'anthropic_key.changed', actor, subject: null, payload: { ...payload } }]);
      tx.set(this.recordRef(), record);
    });
    this.key.invalidate();
    return this.status();
  }

  /** Destroys every version, so no check can run until a key is added again. */
  async remove(ctx: RequestContext): Promise<AnthropicKeyStatus> {
    const actor = requireAccount(ctx);
    if (!(await this.key.current({ fresh: true }))) throw new NotFoundException('no Anthropic API key is set, so there is none to remove');
    await this.secrets.clear(ANTHROPIC_KEY_SECRET);
    await this.firebase.db.runTransaction(async (tx) => {
      const payload: AnthropicKeyChangedPayload = { change: 'removed' };
      await this.ledger.record(tx, [{ type: 'anthropic_key.changed', actor, subject: null, payload: { ...payload } }]);
      tx.delete(this.recordRef());
    });
    this.key.invalidate();
    return this.status();
  }

  private recordRef() {
    return this.firebase.db.collection(Collections.anthropicKey).doc('current');
  }
}

/** The Anthropic API key (design §5.6): whether one is set and by whom, never the key itself. */
@Controller('v1/admin/anthropic-key')
@Roles('system_admin')
export class AnthropicKeyController {
  constructor(private readonly keys: AnthropicKeyAdminService) {}

  @Get()
  status() {
    return this.keys.status();
  }

  @Put()
  add(@Ctx() ctx: RequestContext, @Body(new ZodPipe(anthropicKeySchema)) body: AnthropicKeyInput) {
    return this.keys.add(ctx, body);
  }

  @Delete()
  remove(@Ctx() ctx: RequestContext) {
    return this.keys.remove(ctx);
  }
}
