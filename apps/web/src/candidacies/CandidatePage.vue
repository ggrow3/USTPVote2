<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { PublicCandidacy } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { publicCandidacy } from './api.js';
import CandidacyDetails from './CandidacyDetails.vue';
import { day, districtText } from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';
import PersonBadges from './PersonBadges.vue';

/**
 * One member's candidacy, as approved (design §5.8): who, marked as the Transhumanist Party's candidate, for what, where
 * and when, the platform, and the district's map.
 */
const route = useRoute();
const candidacy = ref<PublicCandidacy | null>(null);
const error = ref<string | null>(null);
usePageTitle(() => (candidacy.value ? `${candidacy.value.name} · Candidates` : 'Candidates'));

const markers = computed<MapMarker[]>(() => {
  const c = candidacy.value;
  return c?.district.point ? [{ id: c.candidacyId, point: c.district.point, title: c.name, caption: `${c.officeTitle} · ${districtText(c)}` }] : [];
});
const outline = computed(() => (candidacy.value ? { kind: candidacy.value.district.kind, geoid: candidacy.value.district.geoid } : null));

watch(
  () => route.params.id as string,
  async (id) => {
    candidacy.value = null;
    error.value = null;
    try {
      candidacy.value = await publicCandidacy(id);
    } catch (e) {
      error.value = errorMessage(e);
    }
  },
  { immediate: true },
);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div><router-link to="/candidates">← All candidates</router-link></div>
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!candidacy" class="text-grey-7">Loading…</div>
      <template v-else>
        <h1 class="text-h5 q-mb-none">
          {{ candidacy.name }}
          <PersonBadges :marks="{ party: true, representative: false }" />
        </h1>
        <DistrictMap :markers="markers" :outline="outline" :label="`Map of ${districtText(candidacy)}`" height="320px" />
        <q-card flat bordered>
          <q-card-section>
            <CandidacyDetails :content="candidacy" />
          </q-card-section>
          <q-card-section class="text-caption text-grey-7 q-pt-none">
            Approved {{ day(candidacy.publishedAt) }}<template v-if="candidacy.district.vintage">
              · Boundaries from the U.S. Census Bureau ({{ candidacy.district.vintage }})</template
            >
          </q-card-section>
        </q-card>
      </template>
    </div>
  </PageShell>
</template>
