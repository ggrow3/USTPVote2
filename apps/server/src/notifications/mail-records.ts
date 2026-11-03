import { Injectable } from '@nestjs/common';
import { MailRepository } from './mail.repository.js';

/**
 * What other contexts may ask of the records of the app's email (design §6.8): forgetting an account's when it is
 * deleted (design §4), its messages' records and the suppressions they started.
 */
@Injectable()
export class MailRecords {
  constructor(private readonly mail: MailRepository) {}

  forgetAccount(accountId: string): Promise<void> {
    return this.mail.forgetAccount(accountId);
  }
}
