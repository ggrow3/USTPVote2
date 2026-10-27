<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { isAppointed, type PositionRecord, type PositionsView } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import { publicOffices } from './api.js';
import { day, officeShape } from './office-text.js';

/**
 * Who holds each party office now (design §6.4): public, like the results and appointments the terms come from. Each
 * holder says whether they were elected or appointed, and an appointment why.
 */
usePageTitle('Offices');
const view = ref<PositionsView | null>(null);
const error = ref<string | null>(null);

const holdersOf = (p: PositionRecord) => view.value?.terms.filter((t) => t.positionId === p.positionId) ?? [];

onMounted(async () => {
  try {
    view.value = await publicOffices();
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <q-page padding>
    <div class="ustp-content">
      <div>
        <h1 class="text-h5 q-mb-xs">Offices</h1>
        <div class="text-grey-7">
          Who holds each party office now. Most are elected; between elections, or before the first, a member can be
          appointed with an Auditor’s approval. Each term is in the public audit ledger.
        </div>
      </div>
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!view" class="text-grey-7">Loading…</div>
      <div v-else-if="view.positions.length === 0" class="text-grey-7">No offices have been defined yet.</div>
      <q-card v-for="p in view?.positions ?? []" :key="p.positionId" flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1">{{ p.title }}</h2>
          <div class="text-caption text-grey-7">{{ officeShape(p) }}<template v-if="p.description"> · {{ p.description }}</template></div>
        </q-card-section>
        <q-list v-if="holdersOf(p).length" separator>
          <q-item v-for="t in holdersOf(p)" :key="t.termId">
            <q-item-section>
              <q-item-label>{{ t.holderName }}</q-item-label>
              <q-item-label caption>
                <template v-if="isAppointed(t)">Appointed</template>
                <template v-else>Elected (<router-link :to="`/results/${encodeURIComponent(t.electionId)}`">results</router-link>)</template>
                · since {{ day(t.startsAt) }} · until {{ day(t.endsAt) }}
              </q-item-label>
              <q-item-label v-if="isAppointed(t)" caption class="offices-reason">Why: {{ t.reason }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
        <q-card-section v-else class="text-grey-7">Nobody holds this office now.</q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<style scoped>
.offices-reason {
  overflow-wrap: anywhere;
}
</style>
