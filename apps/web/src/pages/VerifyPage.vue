<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  checkReceiptPart,
  sealedBlockProblems,
  type AnchorRecord,
  type BallotProof,
  type BallotReceipt,
  type PartCheck,
  type PublicElection,
  type PublicLedgerEntry,
  type SealedBlockRecord,
  type SigningKeyRecord,
} from 'ustp-domain';
import { api, ApiError, errorMessage } from '../api.js';
import { savedReceipts } from '../receipts.js';

const route = useRoute();
const saved = savedReceipts();
const chosen = ref<string | null>(null);
const pasted = ref('');
const file = ref<File | null>(null);
const checking = ref(false);
const error = ref<string | null>(null);
const record = ref<PublicElection | null>(null);
const results = ref<PartCheck[] | null>(null);
/** Closed elections: whether the published sealed blocks recompute (null: not published yet). */
const blocksCheck = ref<{ ok: boolean; detail: string } | null>(null);

onMounted(() => {
  const wanted = String(route.query.election ?? '');
  chosen.value = saved.find((r) => r.electionId === wanted)?.electionId ?? saved[0]?.electionId ?? null;
});

const receiptOptions = saved.map((r) => ({ label: `${r.title} — cast ${new Date(r.castAt).toLocaleString()}`, value: r.electionId }));

function parseReceipt(text: string): BallotReceipt {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('That is not a receipt: it is not valid JSON.');
  }
  const r = value as Partial<BallotReceipt>;
  if (r?.v !== 1 || typeof r.electionId !== 'string' || !Array.isArray(r.parts) || !Array.isArray(r.commitments)) {
    throw new Error('That is not a USTP ballot receipt.');
  }
  return r as BallotReceipt;
}

const orNull = <T,>(request: Promise<T>): Promise<T | null> =>
  request.catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return null;
    throw e;
  });

async function check(source: 'saved' | 'file' | 'paste') {
  error.value = null;
  results.value = null;
  blocksCheck.value = null;
  checking.value = true;
  try {
    const receipt =
      source === 'saved'
        ? saved.find((r) => r.electionId === chosen.value)
        : parseReceipt(source === 'file' ? await file.value!.text() : pasted.value);
    if (!receipt) throw new Error('Choose a receipt.');
    const electionId = receipt.electionId;
    const [publicRecord, keys, anchor] = await Promise.all([
      api<PublicElection>('GET', `/v1/public/elections/${electionId}`),
      api<SigningKeyRecord[]>('GET', '/v1/public/ledger/keys'),
      orNull(api<AnchorRecord>('GET', '/v1/public/anchors/latest')),
    ]);
    record.value = publicRecord;
    results.value = await Promise.all(
      receipt.parts.map(async (part) => {
        const commitment = receipt.commitments.find((c) => c.contestId === part.contestId)?.commitment ?? '';
        const proof = await orNull(api<BallotProof>('GET', `/v1/public/elections/${electionId}/proofs/${commitment || '-'}`));
        const ledger = proof ? await orNull(api<PublicLedgerEntry>('GET', `/v1/public/ledger/entries/${proof.ledgerSeq}`)) : null;
        return checkReceiptPart({ part, commitment, proof, ledger, keys, anchor });
      }),
    );
    const blocks = await orNull(api<SealedBlockRecord[]>('GET', `/v1/public/elections/${electionId}/sealed-blocks`));
    if (blocks) {
      const problems = sealedBlockProblems(blocks);
      const ballots = blocks.reduce((n, b) => n + b.ballotCount, 0);
      blocksCheck.value = problems.length
        ? { ok: false, detail: problems.join('; ') }
        : { ok: true, detail: `All ${blocks.length} published sealed blocks (${ballots} ballots) recompute from their parts.` };
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
}

const titleOf = (contestId: string) => record.value?.definition.contests.find((c) => c.contestId === contestId)?.title ?? contestId;
const STATUS = {
  verified: { label: 'verified', color: 'positive' },
  pending: { label: 'not yet', color: 'grey-7' },
  failed: { label: 'failed', color: 'negative' },
} as const;
const summary = computed(() => {
  const r = results.value;
  if (!r) return null;
  if (r.some((p) => p.status === 'failed')) return { cls: 'bg-negative text-white', text: 'Something does not check out. Keep this receipt and tell an Auditor.' };
  if (r.every((p) => p.status === 'verified')) return { cls: 'bg-positive text-white', text: 'Every part of your ballot is in the published record.' };
  return { cls: 'bg-grey-3 text-black', text: 'Nothing is wrong so far; some steps cannot be checked yet.' };
});
</script>

<template>
  <q-page padding>
    <div class="text-h5 q-mb-sm">Verify a receipt</div>
    <p style="max-width: 760px">
      Checks, in this browser and from public data only, that each part of your ballot was sealed into the election's
      published record, that the sealed block is in the signed audit ledger, and that the ledger is anchored outside the
      database. Your receipt never leaves this browser: only the commitments are looked up.
    </p>

    <div class="column q-gutter-md" style="max-width: 760px">
      <q-card v-if="saved.length" flat bordered>
        <q-card-section class="row items-center q-gutter-md">
          <q-select v-model="chosen" :options="receiptOptions" emit-value map-options outlined dense label="Saved in this browser" class="col" />
          <q-btn color="primary" label="Check" :loading="checking" :disable="!chosen" @click="check('saved')" />
        </q-card-section>
      </q-card>
      <q-card flat bordered>
        <q-card-section class="row items-center q-gutter-md">
          <q-file v-model="file" outlined dense accept=".json,application/json" label="Open a downloaded receipt" class="col" />
          <q-btn color="primary" label="Check" :loading="checking" :disable="!file" @click="check('file')" />
        </q-card-section>
        <q-expansion-item dense label="…or paste one" class="q-px-sm">
          <div class="q-pa-sm">
            <q-input v-model="pasted" type="textarea" outlined autogrow label="Receipt (JSON)" />
            <q-btn class="q-mt-sm" color="primary" label="Check" :loading="checking" :disable="!pasted.trim()" @click="check('paste')" />
          </div>
        </q-expansion-item>
      </q-card>

      <q-banner v-if="error" class="bg-negative text-white" rounded>{{ error }}</q-banner>

      <template v-if="results && record">
        <div>
          <div class="text-h6">{{ record.election.title }}</div>
          <div class="text-caption text-grey-7">
            {{ record.election.state }} · {{ record.ballotsSealed }} ballots sealed in {{ record.sealedBlocks.length }}
            {{ record.sealedBlocks.length === 1 ? 'block' : 'blocks' }}
          </div>
        </div>
        <q-banner v-if="summary" :class="summary.cls" rounded>{{ summary.text }}</q-banner>
        <q-banner v-if="blocksCheck" :class="blocksCheck.ok ? 'bg-positive text-white' : 'bg-negative text-white'" rounded>
          {{ blocksCheck.detail }}
        </q-banner>
        <q-card v-for="r in results" :key="r.contestId" flat bordered>
          <q-card-section class="row items-center">
            <div class="col">
              <div class="text-subtitle1">{{ titleOf(r.contestId) }}</div>
              <div class="text-caption text-grey-7"><code>{{ r.commitment }}</code></div>
            </div>
            <q-badge :color="STATUS[r.status].color" :label="STATUS[r.status].label" />
          </q-card-section>
          <q-list dense class="q-pb-sm">
            <q-item v-for="s in r.steps" :key="s.label">
              <q-item-section avatar>
                <q-icon
                  :name="s.ok === true ? 'check_circle' : s.ok === false ? 'cancel' : 'hourglass_empty'"
                  :color="s.ok === true ? 'positive' : s.ok === false ? 'negative' : 'grey-6'"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ s.label }}</q-item-label>
                <q-item-label v-if="s.detail" caption>{{ s.detail }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </template>
    </div>
  </q-page>
</template>
