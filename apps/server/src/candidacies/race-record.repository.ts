import { Injectable } from '@nestjs/common';
import { Collections, type RaceRecordsRecord } from 'ustp-domain';
import { Firebase } from '../infra/firebase.js';

/**
 * `race_records/{key}` (design §5.17, §11): what the public records said about a state's federal races, or `US` the
 * presidency's, shared by every api instance so that crawlers reading the race pages ask the FEC once a day per state.
 * Public records only, overwritten as they are read again; nothing about anyone who reads the pages.
 */
@Injectable()
export class RaceRecordRepository {
  constructor(private readonly firebase: Firebase) {}

  private records() {
    return this.firebase.db.collection(Collections.raceRecords);
  }

  async get(key: string): Promise<RaceRecordsRecord | null> {
    return ((await this.records().doc(key).get()).data() as RaceRecordsRecord | undefined) ?? null;
  }

  async set(record: RaceRecordsRecord): Promise<void> {
    await this.records().doc(record.key).set(record);
  }

  /** The records that list someone, newest first: a member of Congress is in their state's, a candidate in their race's. */
  async holding(contactId: string): Promise<RaceRecordsRecord[]> {
    const snap = await this.records().where('people', 'array-contains', contactId).get();
    return snap.docs.map((d) => d.data() as RaceRecordsRecord).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  }

  /** Everyone with a page of their own in the records of an election, for the sitemap: only their IDs are read. */
  async people(electionYear: number): Promise<string[]> {
    const snap = await this.records().where('electionYear', '==', electionYear).select('people').get();
    return snap.docs.flatMap((d) => (d.get('people') as string[] | undefined) ?? []);
  }
}
