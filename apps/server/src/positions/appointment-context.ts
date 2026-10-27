import type { Transaction } from 'firebase-admin/firestore';
import { Collections, type AppointmentContext, type PositionRecord, type PositionTermRecord } from 'ustp-domain';
import type { Firebase } from '../infra/firebase.js';
import type { MemberDirectory } from '../membership/member-directory.js';

/**
 * What the appointment rules read (design §6.4), in the request's or the decision's transaction: the office, the
 * appointee's member record, and the office's active terms.
 */
export async function appointmentContext(
  tx: Transaction,
  firebase: Firebase,
  members: MemberDirectory,
  positionId: string,
  accountId: string,
): Promise<AppointmentContext> {
  const db = firebase.db;
  const [office, [member], terms] = await Promise.all([
    tx.get(db.collection(Collections.positions).doc(positionId)),
    members.getAll(tx, [accountId]),
    tx.get(db.collection(Collections.positionTerms).where('positionId', '==', positionId).where('status', '==', 'active')),
  ]);
  return {
    office: (office.data() as PositionRecord | undefined) ?? null,
    member: member ?? null,
    terms: terms.docs.map((d) => d.data() as PositionTermRecord),
  };
}
