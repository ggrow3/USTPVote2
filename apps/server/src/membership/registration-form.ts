import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, Put } from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import {
  checkRegistrationForm,
  Collections,
  DEFAULT_REGISTRATION_FORM,
  registrationFormChanges,
  registrationFormSchema,
  resolveRegistrationForm,
  type PublicRegistrationForm,
  type RegistrationFormChangedPayload,
  type RegistrationFormInput,
  type RegistrationFormRecord,
} from 'ustp-domain';
import { Ctx, Public, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { assertCheck, ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';
import { LedgerService } from '../ledger/ledger.service.js';

const DOC_ID = 'current';

function record(data: Partial<RegistrationFormRecord> | undefined): RegistrationFormRecord {
  return {
    ...resolveRegistrationForm(data),
    version: data?.version ?? 0,
    updatedAt: data?.updatedAt ?? null,
    updatedBy: data?.updatedBy ?? null,
  };
}

const publicForm = ({ updatedAt: _at, updatedBy: _by, ...form }: RegistrationFormRecord): PublicRegistrationForm => form;

/**
 * The registration form's wording (design §5.2): the intro on the Register page, the two membership questions and the
 * Core Ideals. Not cached, unlike the home page quote: an application must answer the version stored now, and a
 * stale copy would have it refused until the cache ran out. Each saved version is kept, so the wording any
 * application answered can be read back.
 */
@Injectable()
export class RegistrationFormService {
  constructor(
    private readonly firebase: Firebase,
    private readonly ledger: LedgerService,
  ) {}

  private get doc() {
    return this.firebase.db.collection(Collections.registrationForm).doc(DOC_ID);
  }

  private versionDoc(version: number) {
    return this.firebase.db.collection(Collections.registrationFormVersions).doc(String(version));
  }

  async current(): Promise<RegistrationFormRecord> {
    return record((await this.doc.get()).data() as RegistrationFormRecord | undefined);
  }

  /** The current version, read in `tx`: what an application must have answered. */
  async version(tx: Transaction): Promise<number> {
    const snap = await tx.get(this.doc);
    return (snap.get('version') as number | undefined) ?? 0;
  }

  /** A version as it was saved; 0 is the default. Null for a version nobody has saved. */
  async atVersion(version: number): Promise<RegistrationFormRecord | null> {
    if (version === 0) return record({ ...DEFAULT_REGISTRATION_FORM, version: 0 });
    const snap = await this.versionDoc(version).get();
    return snap.exists ? record(snap.data() as RegistrationFormRecord) : null;
  }

  /**
   * Saves the wording, tidied, if nobody saved since `basedOn`, keeping the new version and ledgering every part that
   * changed. Both questions, the Core Ideals' heading and an ideal are needed, and a bonus link needs https:// (400).
   */
  async update(ctx: RequestContext, input: RegistrationFormInput): Promise<RegistrationFormRecord> {
    const actor = requireAccount(ctx);
    const { basedOn, ...form } = input;
    const after = resolveRegistrationForm(form);
    assertCheck(checkRegistrationForm(after), BadRequestException);
    return this.firebase.db.runTransaction(async (tx) => {
      const before = record((await tx.get(this.doc)).data() as RegistrationFormRecord | undefined);
      if (basedOn !== before.version) {
        throw new ConflictException('someone else changed the registration form since you opened it; reload to see their change');
      }
      const changes = registrationFormChanges(before, after);
      if (changes.length === 0) return before;
      const next: RegistrationFormRecord = { ...after, version: before.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor };
      const payload: RegistrationFormChangedPayload = { version: next.version, changes };
      await this.ledger.record(tx, [{ type: 'registration_form.changed', actor, subject: null, payload: { ...payload } }]);
      tx.set(this.doc, next);
      tx.create(this.versionDoc(next.version), next);
      return next;
    });
  }
}

/** The wording the Register page shows, and any earlier version an application answered: no sign-in needed. */
@Controller('v1/registration/form')
export class PublicRegistrationFormController {
  constructor(private readonly form: RegistrationFormService) {}

  @Public()
  @Get()
  async current(): Promise<PublicRegistrationForm> {
    return publicForm(await this.form.current());
  }

  @Public()
  @Get(':version')
  async atVersion(@Param('version') version: string): Promise<PublicRegistrationForm> {
    const found = /^\d{1,9}$/.test(version) ? await this.form.atVersion(Number(version)) : null;
    if (!found) throw new NotFoundException(`no registration form version ${version}`);
    return publicForm(found);
  }
}

/** Membership Admins change the registration form's intro, questions and Core Ideals (design §5.2). */
@Controller('v1/admin/registration-form')
@Roles('membership_admin')
export class RegistrationFormAdminController {
  constructor(private readonly form: RegistrationFormService) {}

  @Get()
  current() {
    return this.form.current();
  }

  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(registrationFormSchema)) body: RegistrationFormInput) {
    return this.form.update(ctx, body);
  }
}
