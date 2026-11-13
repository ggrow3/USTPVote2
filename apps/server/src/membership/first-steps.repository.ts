import { Injectable } from '@nestjs/common';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { Collections, resolveFirstSteps, type FirstStepsRecord, type FirstStepTicksRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

const SETTINGS_ID = 'current';

function settingsRecord(data: Partial<FirstStepsRecord> | undefined): FirstStepsRecord {
  return {
    ...resolveFirstSteps(data),
    version: data?.version ?? 0,
    updatedAt: data?.updatedAt ?? null,
    updatedBy: data?.updatedBy ?? null,
  };
}

const ticksOf = (data: Partial<FirstStepTicksRecord> | undefined): string[] =>
  Array.isArray(data?.ticked) ? data.ticked.filter((id): id is string => typeof id === 'string') : [];

/**
 * Storage of the getting started list (design §5.16): `first_steps/current`, the steps Membership Admins set, and
 * `first_step_ticks/{accountId}`, the steps each member ticked themselves. Only the membership context uses it.
 */
@Injectable()
export class FirstStepsRepository {
  constructor(private readonly firebase: Firebase) {}

  private get settingsDoc() {
    return this.firebase.db.collection(Collections.firstSteps).doc(SETTINGS_ID);
  }

  ticksRef(accountId: string): DocumentReference {
    return this.firebase.db.collection(Collections.firstStepTicks).doc(accountId);
  }

  /** The steps in force, the default list while nobody has saved one; read in `tx` when given. */
  async settings(tx?: Transaction): Promise<FirstStepsRecord> {
    const snap = tx ? await tx.get(this.settingsDoc) : await this.settingsDoc.get();
    return settingsRecord(snap.data() as Partial<FirstStepsRecord> | undefined);
  }

  setSettings(tx: Transaction, record: FirstStepsRecord): void {
    tx.set(this.settingsDoc, record);
  }

  /** The ids of the steps a member ticked themselves, as stored; read in `tx` when given. */
  async ticks(accountId: string, tx?: Transaction): Promise<string[]> {
    const ref = this.ticksRef(accountId);
    const snap = tx ? await tx.get(ref) : await ref.get();
    return ticksOf(snap.data() as Partial<FirstStepTicksRecord> | undefined);
  }

  setTicks(tx: Transaction, accountId: string, ticked: readonly string[]): void {
    const record: FirstStepTicksRecord = { ticked: [...ticked], updatedAt: new Date().toISOString() };
    tx.set(this.ticksRef(accountId), record);
  }
}
