<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { BILL_TOPIC_LABELS, CHAMBER_LABELS, congressLabel, lawLabel, rollCallLabel, VOTE_CAST_LABELS, type PublicBillView } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import ShareButtons from '../communications/ShareButtons.vue';
import PageShell from '../components/PageShell.vue';
import { publicBill } from './api.js';
import { day, latestActionLine, STATUS_COLORS, statusLabel } from './bill-text.js';
import LegislationNav from './LegislationNav.vue';
import { billShareable, positionLine, TOPIC_COLORS } from './legislation-text.js';

/**
 * One bill on the public Legislation page (design §5.14, "Legislation and the scorecard"): what the legislative team
 * says of it, how far it has gone, each roll call with the party's position and how each party voted, its CRS summary
 * and its latest actions, from the copy of Congress.gov the site keeps.
 */
const route = useRoute();
const bill = ref<PublicBillView | null>(null);
const missing = ref(false);
const error = ref<string | null>(null);
usePageTitle(() => (bill.value ? `${bill.value.label}: ${bill.value.title}` : 'Legislation'));

watch(
  () => String(route.params.billId ?? ''),
  async (id) => {
    bill.value = null;
    missing.value = false;
    error.value = null;
    try {
      bill.value = await publicBill(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) missing.value = true;
      else error.value = errorMessage(e);
    }
  },
  { immediate: true },
);

const allActions = ref(false);
const actions = computed(() => (allActions.value ? (bill.value?.actions ?? []) : (bill.value?.actions ?? []).slice(0, 8)));
const count = (n: number) => n.toLocaleString('en-US');
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <LegislationNav />
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="missing">
        <h1 class="text-h5">Not found</h1>
        <p>The party does not follow that bill here. <router-link to="/legislation">See the bills it follows</router-link>.</p>
      </div>
      <div v-else-if="!bill" class="text-grey-7">Loading…</div>

      <article v-else class="public-bill">
        <div class="public-bill__chips">
          <q-chip dense square :color="TOPIC_COLORS[bill.topic]" text-color="white" :label="BILL_TOPIC_LABELS[bill.topic]" />
          <q-chip dense square :color="STATUS_COLORS[bill.status]" text-color="white" :label="statusLabel(bill.status)" />
        </div>
        <h1 class="text-h5 q-my-xs">{{ bill.label }}: {{ bill.title }}</h1>
        <div class="text-grey-7">{{ congressLabel(bill.congress) }}</div>

        <section v-if="bill.summary" aria-labelledby="why-heading">
          <h2 id="why-heading" class="text-subtitle1">Why the party follows it</h2>
          <p class="public-bill__summary">{{ bill.summary }}</p>
          <div class="text-caption text-grey-7">By the party's legislative team.</div>
        </section>

        <dl class="public-bill__facts">
          <template v-if="bill.sponsor">
            <dt>Sponsor</dt>
            <dd>{{ bill.sponsor.name }}<template v-if="bill.sponsor.party"> ({{ bill.sponsor.party }}<template v-if="bill.sponsor.state">-{{ bill.sponsor.state }}</template>)</template></dd>
          </template>
          <dt>Cosponsors</dt>
          <dd>{{ bill.cosponsors }}</dd>
          <template v-if="bill.introducedDate">
            <dt>Introduced</dt>
            <dd>{{ day(bill.introducedDate) }}</dd>
          </template>
          <template v-if="bill.policyArea">
            <dt>Policy area</dt>
            <dd>{{ bill.policyArea }}</dd>
          </template>
          <template v-if="bill.laws.length">
            <dt>Law</dt>
            <dd>{{ bill.laws.map(lawLabel).join(', ') }}</dd>
          </template>
          <dt>Latest action</dt>
          <dd>{{ latestActionLine(bill.latestAction) }}</dd>
        </dl>
        <div><a :href="bill.url" target="_blank" rel="noopener noreferrer">{{ bill.label }} on congress.gov</a>, with its full text</div>

        <section aria-labelledby="votes-heading">
          <h2 id="votes-heading" class="text-subtitle1">Recorded votes</h2>
          <p v-if="!bill.votes.length" class="text-grey-7">No roll call has been held on it yet.</p>
          <q-card v-for="v in bill.votes" :key="v.voteId" flat bordered class="q-mb-md">
            <q-card-section>
              <h3 class="text-subtitle2 q-mb-xs">{{ CHAMBER_LABELS[v.chamber] }} roll call {{ v.roll }}, {{ day(v.date) }}</h3>
              <div v-if="v.question"><strong>{{ v.question }}</strong><template v-if="v.result">: {{ v.result }}</template></div>
              <div class="text-caption text-grey-7">{{ v.action }}</div>
              <div class="q-mt-xs" :class="v.position ? 'text-weight-medium' : 'text-grey-7'">{{ positionLine(v.position) }}</div>
            </q-card-section>
            <q-card-section v-if="v.totals">
              <table class="public-bill__tally">
                <caption class="sr-only">How each party voted on {{ rollCallLabel(v) }}</caption>
                <thead>
                  <tr>
                    <th scope="col">Party</th>
                    <th scope="col">{{ VOTE_CAST_LABELS.yea }}</th>
                    <th scope="col">{{ VOTE_CAST_LABELS.nay }}</th>
                    <th scope="col">{{ VOTE_CAST_LABELS.present }}</th>
                    <th scope="col">{{ VOTE_CAST_LABELS.not_voting }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in v.parties" :key="p.party">
                    <th scope="row">{{ p.party }}</th>
                    <td>{{ count(p.yea) }}</td>
                    <td>{{ count(p.nay) }}</td>
                    <td>{{ count(p.present) }}</td>
                    <td>{{ count(p.notVoting) }}</td>
                  </tr>
                  <tr class="public-bill__tally-total">
                    <th scope="row">All</th>
                    <td>{{ count(v.totals.yea) }}</td>
                    <td>{{ count(v.totals.nay) }}</td>
                    <td>{{ count(v.totals.present) }}</td>
                    <td>{{ count(v.totals.notVoting) }}</td>
                  </tr>
                </tbody>
              </table>
            </q-card-section>
            <q-card-section v-else class="text-grey-7">The {{ CHAMBER_LABELS[v.chamber] }}'s record of this vote has not been read yet.</q-card-section>
            <q-card-actions>
              <q-btn flat no-caps label="Each member’s vote on the scorecard" :to="{ path: '/scorecard', query: { chamber: v.chamber } }" />
              <q-btn flat no-caps icon-right="open_in_new" :label="`The ${CHAMBER_LABELS[v.chamber]}'s record`" :href="v.sourceUrl" target="_blank" rel="noopener noreferrer" />
            </q-card-actions>
          </q-card>
        </section>

        <section v-if="bill.crsSummary" aria-labelledby="crs-heading">
          <h2 id="crs-heading" class="text-subtitle1">Summary</h2>
          <div class="text-caption text-grey-7 q-mb-sm">By the Congressional Research Service: {{ bill.crsSummary.versionLabel }}, {{ day(bill.crsSummary.date) }}</div>
          <p v-for="(para, i) in bill.crsSummary.paragraphs" :key="i" class="q-mb-sm">{{ para }}</p>
        </section>

        <section aria-labelledby="actions-heading">
          <h2 id="actions-heading" class="text-subtitle1">Latest actions</h2>
          <ol class="public-bill__actions">
            <li v-for="(a, i) in actions" :key="i">
              <span class="public-bill__date">{{ day(a.date) }}</span>
              <span>{{ a.text }}</span>
            </li>
          </ol>
          <q-btn v-if="bill.actions.length > 8" flat no-caps :label="allActions ? 'Show fewer' : `Show the latest ${bill.actions.length}`" @click="allActions = !allActions" />
        </section>

        <q-separator />
        <div>
          <h2 class="text-subtitle1">Share this bill</h2>
          <ShareButtons :item="billShareable(bill)" />
        </div>
        <p class="text-caption text-grey-7">
          Data retrieved from <a href="https://www.congress.gov/" target="_blank" rel="noopener noreferrer">Congress.gov</a> on
          {{ day(bill.checkedAt) }}, and members' votes from the House and the Senate.
        </p>
      </article>
    </div>
  </PageShell>
</template>

<style scoped>
.public-bill {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.public-bill__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: -4px;
}
.public-bill__summary {
  white-space: pre-wrap;
  margin: 0 0 4px;
}
.public-bill__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
}
.public-bill__facts dt {
  font-weight: 600;
}
.public-bill__facts dd {
  margin: 0;
}
@media (max-width: 599.98px) {
  .public-bill__facts {
    grid-template-columns: 1fr;
  }
  .public-bill__facts dd {
    margin-bottom: 8px;
  }
}
.public-bill__tally {
  border-collapse: collapse;
  width: 100%;
  max-width: 32rem;
}
.public-bill__tally th,
.public-bill__tally td {
  text-align: right;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}
.public-bill__tally th:first-child {
  text-align: left;
}
.body--dark .public-bill__tally th,
.body--dark .public-bill__tally td {
  border-bottom-color: rgba(255, 255, 255, 0.16);
}
.public-bill__tally-total th,
.public-bill__tally-total td {
  font-weight: 600;
}
.public-bill__actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.public-bill__actions li {
  display: grid;
  grid-template-columns: 7.5em 1fr;
  gap: 12px;
}
.public-bill__date {
  white-space: nowrap;
  font-weight: 600;
}
@media (max-width: 599.98px) {
  .public-bill__actions li {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
