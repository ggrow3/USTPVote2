<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { absoluteUrl, BILL_TOPIC_SHORT, congressLabel, isBillTopic, type BillTopic, type PublicBillCard } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import ShareButtons from '../communications/ShareButtons.vue';
import PageShell from '../components/PageShell.vue';
import { publicBills } from './api.js';
import { day, latestActionLine, STATUS_COLORS, statusLabel } from './bill-text.js';
import LegislationNav from './LegislationNav.vue';
import { TOPIC_COLORS, TOPIC_OPTIONS } from './legislation-text.js';

/**
 * The public Legislation page (design §5.14, "Legislation and the scorecard"): the science, AI and longevity bills
 * the party's legislative team follows, the latest action first, each with why it matters and how far it has gone.
 */
usePageTitle('Legislation');
const route = useRoute();
const router = useRouter();
const topic = computed<BillTopic | null>(() => (isBillTopic(route.query.topic) ? route.query.topic : null));
const bills = ref<PublicBillCard[] | null>(null);
const error = ref<string | null>(null);

watch(
  topic,
  async (t) => {
    error.value = null;
    try {
      bills.value = await publicBills(t);
    } catch (e) {
      error.value = errorMessage(e);
    }
  },
  { immediate: true },
);

function pick(t: BillTopic | null) {
  void router.replace({ query: t ? { topic: t } : {} });
}

const page = computed(() => ({
  text: 'The science, AI and longevity bills in Congress that the U.S. Transhumanist Party follows, and how they are moving.',
  url: absoluteUrl('/legislation', location.origin),
  hashtags: [],
  title: 'Science, AI and longevity bills in Congress',
}));
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <LegislationNav />
      <div>
        <h1 class="text-h5 q-mb-xs">Science, AI and longevity bills in Congress</h1>
        <p class="text-grey-7 q-mb-none">
          The bills the party's legislative team follows, the latest action first: what each does, why it matters to
          transhumanists, how far it has gone and how Congress voted on it.
          <router-link to="/scorecard">See how each member voted on them</router-link>.
        </p>
      </div>

      <div role="group" aria-label="Topic" class="legislation-topics">
        <q-btn
          v-for="o in TOPIC_OPTIONS"
          :key="o.value ?? 'all'"
          no-caps
          rounded
          unelevated
          :outline="topic !== o.value"
          :color="o.value ? TOPIC_COLORS[o.value] : 'primary'"
          :label="o.label"
          :aria-pressed="topic === o.value"
          @click="pick(o.value)"
        />
      </div>

      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!bills" class="text-grey-7">Loading…</div>
      <p v-else-if="bills.length === 0" class="text-grey-7">
        {{ topic ? 'No bill on this topic is on the page yet.' : 'The legislative team has not put any bills here yet.' }}
      </p>
      <ul v-else class="legislation-list">
        <li v-for="b in bills" :key="b.id">
          <q-card flat bordered>
            <q-card-section>
              <div class="legislation-chips">
                <q-chip dense square :color="TOPIC_COLORS[b.topic]" text-color="white" :label="BILL_TOPIC_SHORT[b.topic]" />
                <q-chip dense square :color="STATUS_COLORS[b.status]" text-color="white" :label="statusLabel(b.status)" />
              </div>
              <h2 class="text-subtitle1 text-weight-medium q-my-xs">
                <router-link :to="`/legislation/${b.id}`">{{ b.label }}: {{ b.title }}</router-link>
              </h2>
              <div class="text-caption text-grey-7">
                {{ congressLabel(b.congress) }}<template v-if="b.sponsor"> · {{ b.sponsor.name }}<template v-if="b.sponsor.party"> ({{ b.sponsor.party }}<template v-if="b.sponsor.state">-{{ b.sponsor.state }}</template>)</template></template>
              </div>
              <p v-if="b.summary" class="legislation-summary q-mt-sm q-mb-xs">{{ b.summary }}</p>
              <div class="text-caption q-mt-xs"><strong>Latest action:</strong> {{ latestActionLine(b.latestAction) }}</div>
              <div v-if="b.rollCalls" class="text-caption text-grey-7">
                {{ b.rollCalls === 1 ? '1 recorded vote' : `${b.rollCalls} recorded votes` }}<template v-if="b.scored">, {{ b.scored }} scored</template>
              </div>
            </q-card-section>
          </q-card>
        </li>
      </ul>

      <q-separator />
      <div>
        <h2 class="text-subtitle1">Share this page</h2>
        <ShareButtons :item="page" />
      </div>
      <p class="text-caption text-grey-7">
        Chosen and summarised by the party's legislative team. Bills from
        <a href="https://www.congress.gov/" target="_blank" rel="noopener noreferrer">Congress.gov</a>, read again every six hours<template
          v-if="bills?.length"
        >, last on {{ day(bills.map((b) => b.checkedAt).sort().at(-1)) }}</template>.
      </p>
    </div>
  </PageShell>
</template>

<style scoped>
.legislation-topics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.legislation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.legislation-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: -4px;
}
.legislation-summary {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
}
</style>
