<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { blockHash, blockSigningInput, GENESIS_HASH, verifyEcdsaP256 } from 'ustp-audit';
import type { AnchorRecord, LedgerBlockRecord, LedgerEntry, LedgerVerification, SigningKeyRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { attempt } from '../../dialogs.js';

const PAGE = 50;
const entries = ref<LedgerEntry[]>([]);
const more = ref(false);
const verification = ref<LedgerVerification | null>(null);
const verifying = ref(false);

/** Newest first. */
const blocks = ref<LedgerBlockRecord[]>([]);
const anchor = ref<AnchorRecord | null>(null);
/** Per block index: `ok`, or what this browser found wrong with it. */
const blockChecks = ref<Record<number, string>>({});

async function load(reset = true) {
  const after = reset ? 0 : (entries.value.at(-1)?.seq ?? 0);
  await attempt(async () => {
    const page = await api<LedgerEntry[]>('GET', `/v1/admin/audit/events?after=${after}&limit=${PAGE}`);
    entries.value = reset ? page : [...entries.value, ...page];
    more.value = page.length === PAGE;
  });
}

async function loadBlocks() {
  await attempt(async () => {
    const ordered: LedgerBlockRecord[] = [];
    for (let after = 0; ; ) {
      const page = await api<LedgerBlockRecord[]>('GET', `/v1/public/ledger/blocks?after=${after}&limit=200`);
      ordered.push(...page);
      if (page.length < 200) break;
      after = page.at(-1)!.index;
    }
    const [keys, latest] = await Promise.all([
      api<SigningKeyRecord[]>('GET', '/v1/public/ledger/keys'),
      api<AnchorRecord>('GET', '/v1/public/anchors/latest').catch(() => null),
    ]);
    blockChecks.value = await checkBlocks(ordered, keys);
    blocks.value = ordered.reverse();
    anchor.value = latest;
  });
}

/**
 * What a browser can check from the published blocks alone, without trusting the server's verdict: each block links to
 * the one before, its hash matches its contents, and the audit key signed it. Checking the Merkle roots needs the
 * private entries, so that part is the server's "Verify ledger".
 */
async function checkBlocks(ordered: readonly LedgerBlockRecord[], keys: readonly SigningKeyRecord[]) {
  const pems = new Map(keys.map((k) => [k.keyVersion, k.publicKeyPem]));
  const checks: Record<number, string> = {};
  let prev = GENESIS_HASH;
  let nextSeq = 1;
  for (const block of ordered) {
    const pem = pems.get(block.signature.keyVersion);
    checks[block.index] =
      block.prevBlockHash !== prev || block.firstSeq !== nextSeq
        ? 'does not follow the previous block'
        : blockHash(block) !== block.blockHash
          ? 'hash does not match its contents'
          : !pem
            ? 'signed by an unknown key'
            : (await verifyEcdsaP256(pem, blockSigningInput(block), block.signature.signature))
              ? 'ok'
              : 'signature does not verify';
    prev = block.blockHash;
    nextSeq = block.lastSeq + 1;
  }
  return checks;
}

const allBlocksOk = () => blocks.value.every((b) => blockChecks.value[b.index] === 'ok');

async function verify() {
  verifying.value = true;
  // Cleared first, so the result banner (an alert) is inserted again and read out on every run.
  verification.value = null;
  await attempt(async () => {
    verification.value = await api<LedgerVerification>('GET', '/v1/admin/audit/verify');
  }).finally(() => (verifying.value = false));
}

onMounted(() => Promise.all([load(), loadBlocks()]));
</script>

<template>
  <div class="ustp-content">
    <q-card flat bordered>
      <q-card-section class="ustp-header">
        <div>
          <h2 class="text-subtitle1">Ledger verification</h2>
          <div class="text-caption text-grey-7">
            Recomputes every entry's hash and link, every block's Merkle root and signature, and every anchor on the
            server.
          </div>
        </div>
        <q-btn color="primary" label="Verify ledger" :loading="verifying" @click="verify" />
      </q-card-section>
      <q-banner v-if="verification?.ok" class="bg-positive text-white">
        All {{ verification.entries }} entries verify. {{ verification.blocks }} signed
        {{ verification.blocks === 1 ? 'block covers' : 'blocks cover' }}
        {{ verification.entries - verification.unblocked }} of them<template v-if="verification.unblocked">
          ({{ verification.unblocked }} wait for the next block)</template
        >; {{ verification.anchored }} anchored. Head <code>{{ verification.head.slice(0, 16) }}…</code>
      </q-banner>
      <q-banner v-else-if="verification" class="bg-negative text-white">
        Verification failed at {{ verification.part }} {{ verification.at ?? '?' }}: {{ verification.reason }}
      </q-banner>
    </q-card>

    <q-card flat bordered>
      <q-card-section class="ustp-header">
        <div>
          <h2 class="text-subtitle1">Ledger blocks</h2>
          <div class="text-caption text-grey-7">
            Sealed and signed by the worker every minute when there are new entries.
            <template v-if="blocks.length">
              Checked in this browser:
              {{ allBlocksOk() ? 'every block follows the one before and carries a valid signature' : 'problems found, see below' }}.
            </template>
            <template v-if="anchor">
              Anchored through block {{ anchor.index }} (<code>{{ anchor.uri }}</code>).
            </template>
          </div>
        </div>
        <q-btn flat no-caps icon="refresh" label="Refresh" @click="loadBlocks">
          <span class="sr-only"> ledger blocks</span>
        </q-btn>
      </q-card-section>
      <q-markup-table v-if="blocks.length" flat dense>
        <caption class="sr-only">Ledger blocks, newest first</caption>
        <thead>
          <tr>
            <th class="text-left">Block</th>
            <th class="text-left">Entries</th>
            <th class="text-left">Sealed</th>
            <th class="text-left">Merkle root</th>
            <th class="text-left">Signature (checked here)</th>
            <th class="text-left">Anchored</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in blocks" :key="b.index">
            <td>{{ b.index }}</td>
            <td>{{ b.firstSeq }}–{{ b.lastSeq }}</td>
            <td>{{ new Date(b.createdAt).toLocaleString() }}</td>
            <td><code>{{ b.merkleRoot.slice(0, 12) }}…</code></td>
            <td>
              <q-icon
                :name="blockChecks[b.index] === 'ok' ? 'verified' : 'error'"
                :color="blockChecks[b.index] === 'ok' ? 'positive' : 'negative'"
              />
              {{ blockChecks[b.index] === 'ok' ? 'valid' : blockChecks[b.index] }}
            </td>
            <td>{{ anchor && b.index <= anchor.index ? 'yes' : 'not yet' }}</td>
          </tr>
        </tbody>
      </q-markup-table>
      <q-card-section v-else class="text-grey-7">No blocks yet.</q-card-section>
    </q-card>

    <q-markup-table flat bordered dense>
      <caption class="sr-only">Ledger entries</caption>
      <thead>
        <tr>
          <th class="text-left">#</th>
          <th class="text-left">Time</th>
          <th class="text-left">Type</th>
          <th class="text-left">Actor</th>
          <th class="text-left">Subject</th>
          <th class="text-left">Payload</th>
          <th class="text-left">Hash</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in entries" :key="e.seq">
          <td>{{ e.seq }}</td>
          <td>{{ new Date(e.at).toLocaleString() }}</td>
          <td>{{ e.type }}</td>
          <td><code>{{ e.actor.slice(0, 13) }}</code></td>
          <td><code>{{ e.subject?.slice(0, 13) ?? '' }}</code></td>
          <td style="max-width: 320px; white-space: normal; overflow-wrap: anywhere">
            <code>{{ JSON.stringify(e.payload) }}</code>
          </td>
          <td><code>{{ e.hash.slice(0, 12) }}…</code></td>
        </tr>
      </tbody>
    </q-markup-table>
    <q-btn v-if="more" flat no-caps label="Load more" @click="load(false)" />
  </div>
</template>
