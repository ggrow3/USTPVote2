import { Injectable } from '@nestjs/common';
import type { MyMailState } from 'ustp-domain';
import { MailRepository } from './mail.repository.js';
import { MyEmailService } from './my-email.js';

/**
 * What other contexts may ask of the records of the app's email (design §6.8): forgetting an account's when it is
 * deleted (design §4), its messages' records, the suppressions they started and its requests; and whether an account's
 * address can be mailed, for `GET /v1/me` (§10.12).
 */
@Injectable()
export class MailRecords {
  constructor(
    private readonly mail: MailRepository,
    private readonly email: MyEmailService,
  ) {}

  forgetAccount(accountId: string): Promise<void> {
    return this.mail.forgetAccount(accountId);
  }

  state(accountId: string): Promise<MyMailState> {
    return this.email.state(accountId);
  }
}
