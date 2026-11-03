import { Injectable } from '@nestjs/common';
import { Timestamp, type DocumentReference, type Query, type Transaction } from 'firebase-admin/firestore';
import {
  Collections,
  MAIL_MESSAGE_RETENTION_DAYS,
  MAIL_SUPPRESSION_DAYS,
  type MailMessageRecord,
  type MailSuppressionRecord,
} from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

const DAY_MS = 86_400_000;

/** As stored: with the time Firestore's TTL policy deletes it (`expireAt`), which the domain records leave out. */
type Stored<T> = T & { readonly expireAt: Timestamp };

/**
 * The messages the mail service took and what their delivery reports said, and the addresses not to mail (design §6.8,
 * §11). The only code that knows their paths. Both expire by Firestore TTL: a message 180 days after it was sent, a
 * suppression a year after its last report.
 */
@Injectable()
export class MailRepository {
  constructor(private readonly firebase: Firebase) {}

  messageRef(messageId: string): DocumentReference {
    return this.firebase.db.collection(Collections.mailMessages).doc(messageId);
  }

  suppressionRef(addressKey: string): DocumentReference {
    return this.firebase.db.collection(Collections.mailSuppressions).doc(addressKey);
  }

  async message(messageId: string, tx?: Transaction): Promise<MailMessageRecord | null> {
    const snap = tx ? await tx.get(this.messageRef(messageId)) : await this.messageRef(messageId).get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MailMessageRecord>) : null;
  }

  async suppression(addressKey: string, tx?: Transaction): Promise<MailSuppressionRecord | null> {
    const snap = tx ? await tx.get(this.suppressionRef(addressKey)) : await this.suppressionRef(addressKey).get();
    return snap.exists ? withoutExpiry(snap.data() as Stored<MailSuppressionRecord>) : null;
  }

  /** Records a message the worker just sent. */
  async create(record: MailMessageRecord): Promise<void> {
    await this.messageRef(record.messageId).create(storedMessage(record));
  }

  setMessage(tx: Transaction, record: MailMessageRecord): void {
    tx.set(this.messageRef(record.messageId), storedMessage(record));
  }

  setSuppression(tx: Transaction, record: MailSuppressionRecord): void {
    tx.set(this.suppressionRef(record.addressKey), {
      ...record,
      expireAt: Timestamp.fromMillis(Date.parse(record.lastEventAt) + MAIL_SUPPRESSION_DAYS * DAY_MS),
    } satisfies Stored<MailSuppressionRecord>);
  }

  /** Deletes an account's messages and the suppressions found through its messages (a deleted account, design §4). */
  async forgetAccount(accountId: string): Promise<void> {
    await this.deleteWhere([
      this.firebase.db.collection(Collections.mailMessages).where('accountId', '==', accountId),
      this.firebase.db.collection(Collections.mailSuppressions).where('accountId', '==', accountId),
    ]);
  }

  /** Deletes the records of a deleted election's messages (design §6.1). */
  async forgetElection(electionId: string): Promise<void> {
    await this.deleteWhere([this.firebase.db.collection(Collections.mailMessages).where('electionId', '==', electionId)]);
  }

  private async deleteWhere(queries: readonly Query[]): Promise<void> {
    const found = await Promise.all(queries.map((q) => q.select().get()));
    const writer = this.firebase.db.bulkWriter();
    for (const snap of found) for (const doc of snap.docs) void writer.delete(doc.ref);
    await writer.close();
  }
}

function storedMessage(record: MailMessageRecord): Stored<MailMessageRecord> {
  return { ...record, expireAt: Timestamp.fromMillis(Date.parse(record.sentAt) + MAIL_MESSAGE_RETENTION_DAYS * DAY_MS) };
}

function withoutExpiry<T>(stored: Stored<T>): T {
  const { expireAt: _expireAt, ...record } = stored;
  return record as T;
}
