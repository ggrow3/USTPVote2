import {
  blockHash,
  blockSigningInput,
  buildBlock,
  entryInclusionProof,
  GENESIS_HASH,
  linkRecord,
  newSalt,
  sha256Hex,
  type BallotPart,
} from 'ustp-audit';
import {
  buildSealedBlock,
  commitmentsOf,
  definitionHash,
  isPublicLedgerEvent,
  rollMerkleRoot,
  rollSigningInput,
  sealedBlockHash,
  sealedCommitments,
  sealedInclusionProof,
  sequenceId,
  signingKeyId,
  type AnchorRecord,
  type BallotProof,
  type BallotReceipt,
  type ElectionDefinition,
  type LedgerBlockRecord,
  type LedgerEntry,
  type LedgerEventType,
  type PublicElection,
  type PublicLedgerEntry,
  type SealableBallot,
  type SealedBlockRecord,
  type SignatureRecord,
  type SigningKeyRecord,
} from 'ustp-domain';

/**
 * A small but complete published world, built with the real ustp-audit and ustp-domain functions the server uses: a
 * signed ledger of public and private entries, an election with a signed roll, ballots sealed in two blocks (one while
 * open, one at close), an anchor, and a voter's receipt. Tests tamper with copies of it.
 */

const T0 = Date.parse('2026-10-21T12:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

export const ELECTION_ID = '019a0a10-0000-7000-8000-000000000001';
export const KEY_VERSION = 'emulator/test/cryptoKeyVersions/1';
const ENTRIES_PER_BLOCK = 3;

export interface Signer {
  readonly key: SigningKeyRecord;
  sign(data: Uint8Array): Promise<SignatureRecord>;
}

/** A P-256 key that signs the way Cloud KMS does: ASN.1 DER, base64. */
export async function makeSigner(keyVersion = KEY_VERSION): Promise<Signer> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', publicKey)).toString('base64');
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${spki.replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----\n`;
  return {
    key: { keyId: signingKeyId(keyVersion), keyVersion, publicKeyPem, firstUsedAt: at(0) },
    async sign(data) {
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new Uint8Array(data)));
      return { keyVersion, signature: Buffer.from(p1363ToDer(raw)).toString('base64') };
    },
  };
}

/** r ‖ s to DER `SEQUENCE { INTEGER r, INTEGER s }`. */
function p1363ToDer(sig: Uint8Array): Uint8Array {
  const int = (v: Uint8Array) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const body = v[i]! & 0x80 ? [0, ...v.subarray(i)] : [...v.subarray(i)];
    return [0x02, body.length, ...body];
  };
  const seq = [...int(sig.subarray(0, 32)), ...int(sig.subarray(32))];
  return Uint8Array.from([0x30, seq.length, ...seq]);
}

export interface WorldOptions {
  /** Voting has closed and everything is sealed (default true); otherwise it is open with two ballots in the pool. */
  readonly closed?: boolean;
  readonly secrecy?: 'secret' | 'open';
}

export interface World {
  readonly signer: Signer;
  readonly closed: boolean;
  readonly entries: readonly LedgerEntry[];
  readonly blocks: readonly LedgerBlockRecord[];
  readonly anchor: AnchorRecord;
  readonly record: PublicElection;
  /** Contents of every sealed block (the api publishes them only once closed). */
  readonly sealedBlocks: readonly SealedBlockRecord[];
  /** The first voter's receipt; their ballot is in the first sealed block. */
  readonly receipt: BallotReceipt;
  /** The last voter's receipt; while open, their ballot still waits in the pool. */
  readonly lateReceipt: BallotReceipt;
}

export async function buildWorld(options: WorldOptions = {}): Promise<World> {
  const closed = options.closed ?? true;
  const secrecy = options.secrecy ?? 'secret';
  const signer = await makeSigner();
  const definition: ElectionDefinition = {
    v: 1,
    electionId: ELECTION_ID,
    title: 'Committee Elections',
    description: 'A test election.',
    secrecy,
    opensAt: at(10),
    closesAt: at(25),
    kAnonymity: 2,
    contests: [
      {
        contestId: 'plank',
        title: 'Plank 12',
        description: '',
        spec: { kind: 'proposal', id: 'plank', passRule: { threshold: { ratio: { num: 1, den: 2 }, comparison: 'gt' }, base: 'yes_no' } },
        proposal: { snapshotId: 'proposal-1', title: 'Plank 12', contentHash: sha256Hex('plank 12') },
        candidates: [],
      },
      {
        contestId: 'chair',
        title: 'Chair',
        description: '',
        spec: { kind: 'choose_n', id: 'chair', candidates: ['ca', 'cb', 'cc'], seats: 1, maxSelections: 1 },
        proposal: null,
        candidates: ['ca', 'cb', 'cc'].map((candidateId) => ({ candidateId, name: candidateId.toUpperCase(), statement: null })),
      },
    ],
  };
  const defHash = definitionHash(definition);

  const accounts = ['acct-1', 'acct-2', 'acct-3', 'acct-4', 'acct-5', 'acct-6'];
  const roll = { snapshotId: 'snapshot-1', approvalId: 'approval-1', asOf: at(1), count: accounts.length, merkleRoot: rollMerkleRoot(ELECTION_ID, accounts) };
  const rollSignature = await signer.sign(
    rollSigningInput({ electionId: ELECTION_ID, criteria: { status: 'active' }, ...roll }),
  );

  const choices: [string, string[]][] = [['yes', ['ca']], ['no', ['cb']], ['yes', ['ca']], ['abstain', ['cc']]];
  const ballots: SealableBallot[] = choices.map(([plank, chair], i) => ({
    parts: [
      { v: 1, electionId: ELECTION_ID, contestId: 'plank', selection: plank, salt: newSalt() },
      { v: 1, electionId: ELECTION_ID, contestId: 'chair', selection: chair, salt: newSalt() },
    ] satisfies BallotPart[],
    ...(secrecy === 'open' ? { accountId: accounts[i]! } : {}),
  }));
  const receiptOf = (ballot: SealableBallot): BallotReceipt => ({
    v: 1,
    electionId: ELECTION_ID,
    title: definition.title,
    definitionHash: defHash,
    castAt: at(11),
    parts: ballot.parts,
    commitments: commitmentsOf(ballot.parts),
  });

  const entries: LedgerEntry[] = [];
  const record = (type: LedgerEventType, minute: number, payload: Record<string, unknown>, subject: string | null = ELECTION_ID) => {
    const seq = entries.length + 1;
    const entry = linkRecord({ v: 1 as const, seq, type, at: at(minute), actor: 'system', subject, payload }, entries.at(-1)?.hash ?? GENESIS_HASH);
    entries.push(entry);
    return seq;
  };
  const sealedBlocks: SealedBlockRecord[] = [];
  const seal = (chunk: readonly SealableBallot[], minute: number) => {
    const prevSealedHash = sealedBlocks.at(-1)?.sealedHash ?? GENESIS_HASH;
    const block = buildSealedBlock({ electionId: ELECTION_ID, index: sealedBlocks.length + 1, prevSealedHash, ballots: chunk, sealedAt: at(minute) });
    const sealedHash = sealedBlockHash(block);
    const { index, ballotCount, merkleRoot } = block;
    const ledgerSeq = record('ballots.sealed', minute, { electionId: ELECTION_ID, index, ballotCount, merkleRoot, sealedHash, prevSealedHash });
    sealedBlocks.push({ ...block, sealedHash, commitments: sealedCommitments(block.contests), ledgerSeq });
  };

  record('member.status_changed', 0, { status: 'active' }, 'acct-1');
  record('member.status_changed', 0, { status: 'active' }, 'acct-2');
  record('roll.approved', 2, { electionId: ELECTION_ID, snapshotId: roll.snapshotId, merkleRoot: roll.merkleRoot, count: roll.count, asOf: roll.asOf, approvalId: roll.approvalId });
  record('approval.decided', 3, { decision: 'approve' }, 'approval-2');
  const tieBreakSeedCommitment = sha256Hex('tie-break seed');
  record('election.scheduled', 3, {
    electionId: ELECTION_ID,
    definitionHash: defHash,
    rollSnapshotId: roll.snapshotId,
    rollMerkleRoot: roll.merkleRoot,
    rollCount: roll.count,
    tieBreakSeedCommitment,
    opensAt: definition.opensAt,
    closesAt: definition.closesAt,
    approvalId: 'approval-2',
  });
  record('election.opened', 10, { electionId: ELECTION_ID, definitionHash: defHash, opensAt: definition.opensAt, closesAt: definition.closesAt, poolKeyVersion: null });
  if (secrecy === 'secret') seal(ballots.slice(0, 2), 15); // 4 in the pool, k = 2: two are sealed, two stay
  if (closed) {
    record('election.closed', 25, { electionId: ELECTION_ID, closesAt: definition.closesAt });
    seal(secrecy === 'secret' ? ballots.slice(2) : ballots, 26);
    const ballotsSealed = sealedBlocks.reduce((n, b) => n + b.ballotCount, 0);
    record('election.sealed', 26, { electionId: ELECTION_ID, blocks: sealedBlocks.length, ballots: ballotsSealed, lastSealedHash: sealedBlocks.at(-1)!.sealedHash });
  }
  record('member.status_changed', 27, { status: 'lapsed' }, 'acct-6');

  const blocks: LedgerBlockRecord[] = [];
  for (let first = 1; first <= entries.length; first += ENTRIES_PER_BLOCK) {
    const covered = entries.slice(first - 1, first - 1 + ENTRIES_PER_BLOCK);
    const block = buildBlock({
      index: blocks.length + 1,
      prevBlockHash: blocks.at(-1)?.blockHash ?? GENESIS_HASH,
      firstSeq: first,
      entryHashes: covered.map((e) => e.hash),
      createdAt: new Date(Date.parse(covered.at(-1)!.at) + 30_000).toISOString(),
    });
    blocks.push({ ...block, blockHash: blockHash(block), signature: await signer.sign(blockSigningInput(block)) });
  }
  const head = blocks.at(-1)!;
  const anchor: AnchorRecord = {
    index: head.index,
    blockHash: head.blockHash,
    uri: `gs://demo-ustpvote-anchors/v1/blocks/${sequenceId(head.index)}.json`,
    generation: '1700000000000000',
    anchoredAt: head.createdAt,
  };

  const summaries = sealedBlocks.map(({ index, ballotCount, merkleRoot, sealedHash, sealedAt, ledgerSeq }) => ({
    index,
    ballotCount,
    merkleRoot,
    sealedHash,
    sealedAt,
    ledgerSeq,
  }));
  const publicRecord: PublicElection = {
    election: {
      electionId: ELECTION_ID,
      title: definition.title,
      description: definition.description,
      secrecy,
      state: closed ? 'closed' : 'open',
      opensAt: definition.opensAt,
      closesAt: definition.closesAt,
      kAnonymity: definition.kAnonymity,
      definitionHash: defHash,
      tieBreakSeedCommitment,
      openedAt: at(10),
      closedAt: closed ? at(25) : null,
      sealedAt: closed ? at(26) : null,
      cancelledAt: null,
    },
    definition,
    roll: { snapshotId: roll.snapshotId, count: roll.count, merkleRoot: roll.merkleRoot, asOf: roll.asOf, signature: rollSignature },
    sealedBlocks: summaries,
    ballotsSealed: summaries.reduce((n, b) => n + b.ballotCount, 0),
    results: null,
  };
  return {
    signer,
    closed,
    entries,
    blocks,
    anchor,
    record: publicRecord,
    sealedBlocks,
    receipt: receiptOf(ballots[0]!),
    lateReceipt: receiptOf(ballots.at(-1)!),
  };
}

/** `GET /v1/public/ledger/entries/{seq}` as the server answers it; null where it answers 404. */
export function publicEntry(world: Pick<World, 'entries' | 'blocks'>, seq: number): PublicLedgerEntry | null {
  const entry = world.entries[seq - 1];
  const block = world.blocks.find((b) => b.firstSeq <= seq && seq <= b.lastSeq);
  if (!entry || !block || !isPublicLedgerEvent(entry.type)) return null;
  const hashes = world.entries.slice(block.firstSeq - 1, block.lastSeq).map((e) => e.hash);
  return { entry, block, proof: entryInclusionProof(hashes, block.firstSeq, seq) };
}

/** The result of scanning every entry the blocks cover: seq → entry, or null for the private ones. */
export function scanOf(world: Pick<World, 'entries' | 'blocks'>): Map<number, PublicLedgerEntry | null> {
  const through = world.blocks.at(-1)?.lastSeq ?? 0;
  return new Map(Array.from({ length: through }, (_, i) => [i + 1, publicEntry(world, i + 1)]));
}

/** Only the public entries of a scan, as the election checks receive them. */
export function publicEntries(world: Pick<World, 'entries' | 'blocks'>): Map<number, PublicLedgerEntry> {
  return new Map([...scanOf(world)].filter((e): e is [number, PublicLedgerEntry] => e[1] !== null));
}

/**
 * The public api over a world, the way the server answers: pages of at most `pageCap` blocks, 404 for private
 * entries, 409 for sealed contents while open. `results` is the results bundle, if published.
 */
export function fakeFetch(world: World, options: { readonly pageCap?: number; readonly results?: unknown } = {}): typeof fetch {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const problem = (status: number, detail: string) => json({ type: 'about:blank', status, detail }, status);
  return async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === '/v1/public/ledger/blocks') {
      const after = Number(url.searchParams.get('after') ?? 0);
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), options.pageCap ?? 200);
      return json(world.blocks.filter((b) => b.index > after).slice(0, limit));
    }
    if (path === '/v1/public/ledger/keys') return json([world.signer.key]);
    if (path === '/v1/public/anchors/latest') return json(world.anchor);
    let m = /^\/v1\/public\/ledger\/entries\/(\d+)$/.exec(path);
    if (m) {
      const found = publicEntry(world, Number(m[1]));
      return found ? json(found) : problem(404, `no public ledger entry ${m[1]}`);
    }
    m = /^\/v1\/public\/elections\/([^/]+)(?:\/(sealed-blocks|results|proofs\/([^/]+)))?$/.exec(path);
    if (!m || decodeURIComponent(m[1]!) !== ELECTION_ID) return problem(404, 'not found');
    if (!m[2]) return json(world.record);
    if (m[2] === 'sealed-blocks') return world.closed ? json(world.sealedBlocks) : problem(409, 'sealed ballots are published when voting closes');
    if (m[2] === 'results') return options.results === undefined ? problem(404, 'not found') : json(options.results);
    const commitment = m[3]!;
    const visible = world.sealedBlocks.filter((b) => world.record.sealedBlocks.some((s) => s.index === b.index));
    const block = visible.find((b) => b.commitments.includes(commitment));
    if (!block) return problem(404, 'that commitment is not in a sealed block (yet)');
    const proof: BallotProof = {
      electionId: ELECTION_ID,
      commitment,
      blockIndex: block.index,
      merkleRoot: block.merkleRoot,
      sealedHash: block.sealedHash,
      ledgerSeq: block.ledgerSeq,
      proof: sealedInclusionProof(block, commitment)!,
    };
    return json(proof);
  };
}
