<script setup lang="ts">
import { computed, ref } from 'vue';
import { inclusionProofHex, isHex32, newSalt, sha256Hex, verifyInclusionHex, type InclusionProof } from 'ustp-audit';

const input = ref('');

/** Verified entirely in the browser with ustp-audit — the server is not trusted for this answer (design §7.5). */
const result = computed<{ ok: boolean; message: string } | null>(() => {
  if (!input.value.trim()) return null;
  let parsed: { commitment?: unknown; proof?: InclusionProof };
  try {
    parsed = JSON.parse(input.value);
  } catch {
    return { ok: false, message: 'That is not valid JSON.' };
  }
  const { commitment, proof } = parsed;
  if (!isHex32(commitment) || typeof proof !== 'object' || proof === null) {
    return { ok: false, message: 'Expected {"commitment": "<64 hex digits>", "proof": {leafIndex, treeSize, path, root}}.' };
  }
  return verifyInclusionHex(commitment, proof)
    ? { ok: true, message: `Included in the sealed block with Merkle root ${proof.root}.` }
    : { ok: false, message: 'The proof does not match: this commitment is not shown as included.' };
});

function loadExample() {
  const commitments = Array.from({ length: 12 }, () => sha256Hex(newSalt()));
  const index = 7;
  input.value = JSON.stringify({ commitment: commitments[index], proof: inclusionProofHex(commitments, index) }, null, 2);
}
</script>

<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">Verify a receipt</div>
    <p>
      Paste a ballot commitment with its inclusion proof. Fetching proofs for your saved receipt and checking the
      ledger and anchors arrive in milestone M3; the Merkle check below already runs locally.
    </p>
    <q-input v-model="input" type="textarea" outlined autogrow label="Commitment and proof (JSON)" class="q-mb-sm" />
    <q-btn flat color="primary" label="Load an example" class="q-mb-md" @click="loadExample" />
    <q-banner v-if="result" :class="result.ok ? 'bg-positive text-white' : 'bg-negative text-white'">
      {{ result.message }}
    </q-banner>
  </q-page>
</template>
