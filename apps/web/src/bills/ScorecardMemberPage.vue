<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { BILL_TOPIC_SHORT, memberLabel, memberPlace, VOTE_CAST_LABELS, type ScorecardMemberView } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import ShareButtons from '../communications/ShareButtons.vue';
import PageShell from '../components/PageShell.vue';
import { scorecardMember } from './api.js';
import { day } from './bill-text.js';
import LegislationNav from './LegislationNav.vue';
import { memberShareable, OUTCOME_COLORS, OUTCOME_LABELS, scoreColor, scorePercent, TOPIC_COLORS } from './legislation-text.js';

/**
 * One member of Congress on the scorecard (design §5.14, "Legislation and the scorecard"): their score, and every
 * vote they cast on the bills on the Legislation page, with the party's position on each.
 */
const route = useRoute();
const view = ref<ScorecardMemberView | null>(null);
const missing = ref(false);
const error = ref<string | null>(null);
usePageTitle(() => (view.value ? `${memberLabel(view.value.member)}: scorecard` : 'Scorecard'));

watch(
  () => String(route.params.memberId ?? ''),
  async (id) => {
    view.value = null;
    missing.value = false;
    error.value = null;
    try {
      view.value = await scorecardMember(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) missing.value = true;
      else error.value = errorMessage(e);
    }
  },
  { immediate: true },
);

const m = computed(() => view.value?.member ?? null);
/** Their Congress biography, for a Bioguide ID (a former senator known only by the Senate's ID has none here). */
const bioguide = computed(() => (m.value && /^[A-Z]\d{6}$/.test(m.value.memberId) ? `https://bioguide.congress.gov/search/bio/${m.value.memberId}` : null));
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <LegislationNav />
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="missing">
        <h1 class="text-h5">Not found</h1>
        <p>That member of Congress has no vote on the bills the party follows here. <router-link to="/scorecard">See the scorecard</router-link>.</p>
      </div>
      <div v-else-if="!view || !m" class="text-grey-7">Loading…</div>

      <article v-else class="member">
        <div>
          <h1 class="text-h5 q-mb-xs">{{ memberLabel(m) }}</h1>
          <div class="text-grey-7">
            {{ m.chamber === 'house' ? 'U.S. House' : 'U.S. Senate' }}, {{ memberPlace(m) }}<template v-if="m.party"> · {{ m.party }}</template>
            <template v-if="bioguide"> · <a :href="bioguide" target="_blank" rel="noopener noreferrer">Biography</a></template>
          </div>
        </div>

        <q-card flat bordered>
          <q-card-section class="member__score">
            <div :class="`text-h4 text-weight-bold text-${scoreColor(m.score)}`">{{ scorePercent(m.score) }}</div>
            <div>
              <template v-if="m.score !== null">
                with the party's position: {{ m.with }} of {{ m.with + m.against }} scored yeas and nays
              </template>
              <template v-else>No scored yea or nay of theirs yet.</template>
              <div v-if="m.missed" class="text-grey-7">and {{ m.missed === 1 ? '1 scored vote' : `${m.missed} scored votes` }} missed, or answered Present</div>
            </div>
          </q-card-section>
        </q-card>

        <section aria-labelledby="votes-heading">
          <h2 id="votes-heading" class="text-subtitle1">Their votes on the party's bills</h2>
          <q-list bordered separator class="rounded-borders">
            <q-item v-for="v in view.votes" :key="v.voteId">
              <q-item-section>
                <q-item-label>
                  <q-chip dense square size="sm" :color="TOPIC_COLORS[v.topic]" text-color="white" :label="BILL_TOPIC_SHORT[v.topic]" class="q-ml-none" />
                  <router-link :to="`/legislation/${v.billId}`">{{ v.label }}: {{ v.title }}</router-link>
                </q-item-label>
                <q-item-label caption>
                  {{ day(v.date) }} · {{ v.question }}<template v-if="v.result">: {{ v.result }}</template> ·
                  <a :href="v.sourceUrl" target="_blank" rel="noopener noreferrer">the record</a>
                </q-item-label>
                <q-item-label>
                  Voted <strong>{{ VOTE_CAST_LABELS[v.vote] }}</strong
                  ><template v-if="v.position">; the party's position was {{ VOTE_CAST_LABELS[v.position] }}</template
                  ><template v-else>; the party took no position</template>
                </q-item-label>
              </q-item-section>
              <q-item-section side top>
                <q-chip dense square :color="OUTCOME_COLORS[v.outcome]" text-color="white" :label="OUTCOME_LABELS[v.outcome]" />
              </q-item-section>
            </q-item>
          </q-list>
        </section>

        <q-separator />
        <div>
          <h2 class="text-subtitle1">Share this scorecard</h2>
          <ShareButtons :item="memberShareable(m)" />
        </div>
      </article>
    </div>
  </PageShell>
</template>

<style scoped>
.member {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.member__score {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
</style>
