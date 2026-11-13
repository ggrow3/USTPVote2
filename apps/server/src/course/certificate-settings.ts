import { Body, Controller, Get, Injectable, Put } from '@nestjs/common';
import {
  certificateSettingsSchema,
  Collections,
  SITE_ADMIN_ROLES,
  type CertificateSettingsInput,
  type CertificateSettingsRecord,
} from 'ustp-domain';
import { Ctx, requireAccount, Roles } from '../auth/decorators.js';
import type { RequestContext } from '../auth/principal.js';
import { ZodPipe } from '../common/validation.js';
import { Firebase } from '../infra/firebase.js';

const CACHE_MS = 60_000;

function record(data: Partial<CertificateSettingsRecord> | undefined): CertificateSettingsRecord {
  return { linkedInOrganizationId: data?.linkedInOrganizationId ?? null, updatedAt: data?.updatedAt ?? null, updatedBy: data?.updatedBy ?? null };
}

/**
 * What System Admins (and Site Admins) set about course certificates (design §10.8, "Sharing a certificate"): the
 * party's LinkedIn organization, which Add to profile names as the issuer. Read with each learner's course page, so
 * cached briefly; another instance picks up a change within a minute.
 */
@Injectable()
export class CertificateSettingsService {
  private cache: { at: number; record: CertificateSettingsRecord } | null = null;

  constructor(private readonly firebase: Firebase) {}

  private get doc() {
    return this.firebase.db.collection(Collections.certificateSettings).doc('current');
  }

  async current(): Promise<CertificateSettingsRecord> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.record;
    const current = record((await this.doc.get()).data() as CertificateSettingsRecord | undefined);
    this.cache = { at: Date.now(), record: current };
    return current;
  }

  async update(input: CertificateSettingsInput, accountId: string): Promise<CertificateSettingsRecord> {
    const saved: CertificateSettingsRecord = { ...input, updatedAt: new Date().toISOString(), updatedBy: accountId };
    await this.doc.set(saved);
    this.cache = { at: Date.now(), record: saved };
    return saved;
  }
}

@Controller('v1/admin/certificate-settings')
@Roles(...SITE_ADMIN_ROLES)
export class CertificateSettingsController {
  constructor(private readonly settings: CertificateSettingsService) {}

  @Get()
  get() {
    return this.settings.current();
  }

  /** Sets the party's LinkedIn organization ID, or clears it with null, at once. */
  @Put()
  update(@Ctx() ctx: RequestContext, @Body(new ZodPipe(certificateSettingsSchema)) input: CertificateSettingsInput) {
    return this.settings.update(input, requireAccount(ctx));
  }
}
