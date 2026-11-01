import {
  blockBody,
  blockHash,
  blockSigningInput,
  buildBlock,
  GENESIS_HASH,
  linkRecord,
  recordHash,
  verifyEcdsaP256,
  verifyInclusionHex,
} from 'ustp-audit';
import { rollSigningInput, sequenceId, type LedgerBlockRecord, type LedgerEntry } from 'ustp-domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEmulators, TestApi, TestWorker, type User } from './testing/emulator.js';

let api: TestApi;
let worker: TestWorker;
beforeAll(async () => {
  [api, worker] = await Promise.all([TestApi.start(), TestWorker.start()]);
});
afterAll(() => Promise.all([api.close(), worker.close()]));

type Member = User & { accountId: string };
let sa1: Member;
let sa2: Member;
let auditor: Member;

const BUCKET = 'demo-ustpvote-anchors';
const bucket = () => api.firebase.storage.bucket(BUCKET);
const verify = async () => (await api.call('GET', '/v1/admin/audit/verify', auditor)).body;

beforeEach(async () => {
  await resetEmulators();
  await bucket()
    .deleteFiles({ prefix: 'v1/' })
    .catch(() => undefined); // nothing anchored yet
  [sa1, sa2] = await api.systemAdmins();
  auditor = await api.member('auditor@example.test');
  await api.grant(auditor.accountId, 'auditor', sa1); // entries 1..3 with the two bootstrap grants
});

/** An insider with database access rewrites entry `seq` and relinks everything after it, head included. */
async function rewriteEntry(seq: number, payload: Record<string, unknown>) {
  const db = api.firebase.db;
  const entries = (await db.collection('audit_events').orderBy('seq').get()).docs.map((d) => d.data() as LedgerEntry);
  let prev = entries[seq - 2]?.hash ?? GENESIS_HASH;
  for (const entry of entries.slice(seq - 1)) {
    const { hash: _hash, prevHash: _prevHash, ...body } = entry;
    const next = linkRecord(entry.seq === seq ? { ...body, payload: { ...body.payload, ...payload } } : body, prev);
    await db.collection('audit_events').doc(sequenceId(entry.seq)).set(next);
    prev = next.hash;
  }
  await db.collection('ledger_head').doc('main').set({ seq: entries.length, hash: prev });
}

describe('ledger blocks and anchors', () => {
  it('seals new entries into signed, chained blocks and anchors each one outside Firestore', async () => {
    expect(await worker.tick()).toMatchObject({ status: 200, body: { blocksSealed: 1, rollsSigned: 0, anchored: 1 } });
    expect((await worker.tick()).body).toEqual({
      poolKeysCreated: 0,
      electionsOpened: 0,
      electionsClosed: 0,
      ballotsSealed: 0,
      resultsComputed: 0,
      poolKeysDestroyed: 0,
      noticesSent: 0,
      testEmailsSent: 0,
      bouncesRecorded: 0,
      suggestionsDeleted: 0,
      roomExpired: 0,
      roomModel: 'not-vertex',
      blocksSealed: 0,
      rollsSigned: 0,
      anchored: 0,
    });

    const [block1] = (await api.call('GET', '/v1/public/ledger/blocks')).body as LedgerBlockRecord[];
    expect(block1).toMatchObject({ index: 1, prevBlockHash: GENESIS_HASH, firstSeq: 1, lastSeq: 3 });
    const [key] = (await api.call('GET', '/v1/public/ledger/keys')).body;
    expect(key.keyVersion).toBe(block1!.signature.keyVersion);
    expect(await verifyEcdsaP256(key.publicKeyPem, blockSigningInput(block1!), block1!.signature.signature)).toBe(true);

    const anchor = (await api.call('GET', '/v1/public/anchors/latest')).body;
    expect(anchor).toMatchObject({ index: 1, blockHash: block1!.blockHash, uri: `gs://${BUCKET}/v1/blocks/000000000001.json` });
    const [content] = await bucket().file('v1/blocks/000000000001.json').download();
    expect(JSON.parse(content.toString())).toEqual({
      v: 1,
      block: blockBody(block1!),
      blockHash: block1!.blockHash,
      signature: block1!.signature,
    });
    const [pem] = await bucket().file(`v1/keys/${key.keyId}.pem`).download();
    expect(pem.toString()).toBe(key.publicKeyPem);

    const pat = await api.member('pat@example.test');
    await api.grant(pat.accountId, 'membership_admin', sa1); // entry 4
    expect((await worker.tick()).body).toMatchObject({ blocksSealed: 1, anchored: 1 });
    const block2 = (await api.call('GET', '/v1/public/ledger/blocks/2')).body;
    expect(block2).toMatchObject({ prevBlockHash: block1!.blockHash, firstSeq: 4, lastSeq: 4 });
    expect(await verify()).toEqual({ ok: true, entries: 4, head: block2.headEntryHash, blocks: 2, unblocked: 0, anchored: 2 });
    expect((await api.call('GET', '/v1/public/ledger/blocks/3')).status).toBe(404);
  });

  it('catches sealed history rewritten consistently, even with the block rehashed', async () => {
    await worker.tick();
    await rewriteEntry(3, { reason: 'edited later' });
    // The entry chain alone now verifies; the block's Merkle root does not.
    expect(await verify()).toMatchObject({ ok: false, part: 'block', at: 1, reason: 'Merkle root does not match the entries' });

    const db = api.firebase.db;
    const stored = (await db.collection('blocks').doc(sequenceId(1)).get()).data() as LedgerBlockRecord;
    const entries = (await db.collection('audit_events').orderBy('seq').get()).docs.map((d) => (d.data() as LedgerEntry).hash);
    const rebuilt = buildBlock({ index: 1, prevBlockHash: GENESIS_HASH, firstSeq: 1, entryHashes: entries, createdAt: stored.createdAt });
    await db.collection('blocks').doc(sequenceId(1)).set({ ...rebuilt, blockHash: blockHash(rebuilt), signature: stored.signature });
    // Without the signing key, the forged block cannot be re-signed.
    expect(await verify()).toMatchObject({ ok: false, part: 'block', at: 1, reason: 'signature does not verify' });
  });

  it('notices an anchor object that was replaced', async () => {
    await worker.tick();
    await bucket().file('v1/blocks/000000000001.json').save('{}', { resumable: false });
    expect(await verify()).toMatchObject({ ok: false, part: 'anchor', at: 1 });
  });

  it('refuses to sign a chain that does not verify', async () => {
    await api.firebase.db.collection('audit_events').doc(sequenceId(3)).update({ 'payload.reason': 'edited' });
    expect((await worker.tick()).status).toBe(500);
    expect((await api.call('GET', '/v1/public/ledger/blocks')).body).toEqual([]);
  });

  it('publishes public entries with inclusion proofs and keeps member entries private', async () => {
    const admin = await api.member('membership.admin@example.test');
    await api.grant(admin.accountId, 'membership_admin', sa1);
    await api.call('POST', '/v1/admin/bylaws', admin, { version: '2026.1', title: 'USTP Bylaws', text: 'Article I.\n' });
    const seq = (await api.firebase.db.collection('audit_events').where('type', '==', 'bylaws.published').get()).docs[0]!.data().seq;

    expect((await api.call('GET', `/v1/public/ledger/entries/${seq}`)).status).toBe(404); // not in a block yet
    await worker.tick();
    const published = (await api.call('GET', `/v1/public/ledger/entries/${seq}`)).body;
    expect(published.entry).toMatchObject({ seq, type: 'bylaws.published' });
    expect(recordHash(published.entry)).toBe(published.entry.hash);
    expect(published.proof.root).toBe(published.block.merkleRoot);
    expect(verifyInclusionHex(published.entry.hash, published.proof)).toBe(true);

    expect((await api.call('GET', '/v1/public/ledger/entries/3')).status).toBe(404); // role.granted
  });
});

describe('roll signatures', () => {
  it('signs a roll once an Auditor has approved it', async () => {
    const ea = await api.member('election.admin@example.test');
    await api.grant(ea.accountId, 'election_admin', sa1);
    for (const email of ['v1@example.test', 'v2@example.test']) {
      const voter = await api.member(email);
      await api.firebase.db.collection('members').doc(voter.accountId).set({ accountId: voter.accountId, status: 'active', legalName: email, state: 'CA' });
    }
    const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    const { electionId } = (
      await api.call('POST', '/v1/admin/elections', ea, { title: 'Officers', secrecy: 'secret', opensAt: inDays(10), closesAt: inDays(17) })
    ).body;
    const roll = (await api.call('POST', `/v1/admin/elections/${electionId}/roll`, ea, { reason: 'roll' })).body;

    expect((await worker.tick()).body.rollsSigned).toBe(0); // pending rolls are not signed
    await api.call('POST', `/v1/admin/approvals/${roll.approvalId}/decision`, auditor, { decision: 'approve', reason: 'checked' });
    expect((await worker.tick()).body.rollsSigned).toBe(1);
    expect((await worker.tick()).body.rollsSigned).toBe(0);

    const { snapshot } = (await api.call('GET', `/v1/admin/elections/${electionId}/roll`, auditor)).body;
    const [key] = (await api.call('GET', '/v1/public/ledger/keys')).body;
    expect(snapshot.signature.keyVersion).toBe(key.keyVersion);
    expect(await verifyEcdsaP256(key.publicKeyPem, rollSigningInput(snapshot), snapshot.signature.signature)).toBe(true);
    expect(await verifyEcdsaP256(key.publicKeyPem, rollSigningInput({ ...snapshot, count: 3 }), snapshot.signature.signature)).toBe(false);
  });
});
