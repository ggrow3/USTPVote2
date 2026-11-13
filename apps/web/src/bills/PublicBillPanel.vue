<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  BILL_TOPIC_LABELS,
  BILL_TOPICS,
  CHAMBER_LABELS,
  billRollCalls,
  PUBLIC_BILL_LIMITS,
  type BillDetail,
  type BillTopic,
  type PartyPosition,
  type PublicBillTeamView,
} from 'ustp-domain';
import { announce, focusSoon } from '../a11y.js';
import { errorMessage } from '../api.js';
import { attempt, dialog } from '../dialogs.js';
import { savePublicBill, withdrawPublicBill } from './api.js';
import { day } from './bill-text.js';
import { POSITION_OPTIONS } from './legislation-text.js';

/**
 * The bill's place on the public Legislation page (design §5.14, "Legislation and the scorecard"), for the legislative
 * team: shown or not, its topic, the summary the team writes for the public, and the party's position on each of its
 * roll calls, which the scorecard counts. The watchlist's tags and notes never go there.
 */
const props = defineProps<{ bill: BillDetail }>();
const emit = defineEmits<{ changed: [view: PublicBillTeamView | null] }>();

const topicOptions = BILL_TOPICS.map((t) => ({ label: BILL_TOPIC_LABELS[t], value: t }));
const shown = computed(() => props.bill.public);
const rollCalls = computed(() => billRollCalls(props.bill.actions));
const unread = computed(() => new Set(shown.value?.unread ?? []));

const topic = ref<BillTopic | null>(null);
const summary = ref('');
const positions = ref<Record<string, PartyPosition | null>>({});
const error = ref('');
const saving = ref(false);

function reset() {
  topic.value = shown.value?.topic ?? null;
  summary.value = shown.value?.summary ?? '';
  positions.value = Object.fromEntries(rollCalls.value.map((r) => [r.voteId, shown.value?.positions[r.voteId] ?? null]));
  error.value = '';
}
watch(() => [props.bill.id, shown.value?.version], reset, { immediate: true });

const marked = computed(() => Object.fromEntries(Object.entries(positions.value).filter((e): e is [string, PartyPosition] => e[1] !== null)));
const changed = computed(
  () =>
    !shown.value ||
    topic.value !== shown.value.topic ||
    summary.value.trim() !== shown.value.summary ||
    JSON.stringify(Object.entries(marked.value).sort()) !== JSON.stringify(Object.entries(shown.value.positions).sort()),
);

async function save() {
  if (!topic.value) {
    error.value = 'Pick the topic it is filed under first.';
    await focusSoon('#public-topic');
    return;
  }
  error.value = '';
  saving.value = true;
  try {
    const first = !shown.value;
    const view = await savePublicBill(props.bill.id, { topic: topic.value, summary: summary.value.trim(), positions: marked.value, basedOn: shown.value?.version ?? null });
    emit('changed', view);
    announce(first ? `${props.bill.label} is on the public Legislation page.` : 'The public page is saved.');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

function withdraw() {
  dialog({
    title: `Take ${props.bill.label} off the public page?`,
    message:
      'It leaves the Legislation page and the scorecard at once, with its public summary, the party’s positions and the votes read for it. It stays on the watchlist with its tags and notes.',
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Take it off', color: 'negative', noCaps: true },
  }).onOk(async () => {
    const ok = await attempt(() => withdrawPublicBill(props.bill.id), `${props.bill.label} is off the public page.`);
    if (ok) {
      emit('changed', null);
      await focusSoon('#bill-public');
    }
  });
}
</script>

<template>
  <q-card id="bill-public" flat bordered tag="section" tabindex="-1" aria-labelledby="bill-public-heading">
    <q-card-section>
      <div class="ustp-header">
        <div>
          <h2 id="bill-public-heading" class="text-subtitle1">The public Legislation page</h2>
          <div class="text-caption text-grey-7">
            <template v-if="!bill.watch">Add it to the watchlist first; then it can be shown publicly.</template>
            <template v-else-if="shown">
              Shown publicly since {{ day(shown.publishedAt) }}, last changed {{ day(shown.updatedAt) }}. Anyone can read its topic, the
              summary below and the party's positions, with Congress.gov's details and every member's vote. The watchlist's tags and
              notes stay with the team.
            </template>
            <template v-else>
              Not shown publicly. Showing it puts its topic, the summary you write here, Congress.gov's details and its roll calls on
              the Legislation page, and the votes you mark below on the scorecard. The watchlist's tags and notes stay with the team.
            </template>
          </div>
        </div>
        <div v-if="shown" class="row no-wrap q-gutter-sm">
          <q-btn flat no-caps icon="open_in_new" label="Open the public page" :to="`/legislation/${bill.id}`" />
          <q-btn flat no-caps color="negative" label="Take off the public page" @click="withdraw" />
        </div>
      </div>
    </q-card-section>

    <q-card-section v-if="bill.watch">
      <q-banner v-if="shown?.refreshFailedAt" class="bg-orange-1 text-black q-mb-md" rounded>
        Congress.gov could not be read for it on {{ day(shown.refreshFailedAt) }}; the public page shows what it said on
        {{ day(shown.checkedAt) }} and is read again within the half hour.
      </q-banner>
      <form class="ustp-form" novalidate @submit.prevent="save">
        <q-select
          id="public-topic"
          v-model="topic"
          outlined
          dense
          emit-value
          map-options
          :options="topicOptions"
          label="Topic"
          hint="Where the Legislation page files it"
        />
        <q-input
          v-model="summary"
          outlined
          autogrow
          type="textarea"
          :maxlength="PUBLIC_BILL_LIMITS.summary"
          counter
          label="Public summary"
          hint="Plain text, for anyone: what the bill does and why it matters to transhumanists. Unlike notes, this is public."
        />

        <fieldset class="public-votes">
          <legend class="text-subtitle2">The party's position on each roll call</legend>
          <p class="text-caption text-grey-7 q-mb-sm">
            How a Transhumanist would vote. The scorecard counts each member's yea or nay against the positions marked here; a roll
            call with no position is shown but not scored. Mind what each vote decided: on a motion to recommit, say, Nay is usually
            the vote for the bill.
          </p>
          <p v-if="!rollCalls.length" class="text-grey-7">No roll call has been held on it yet. Its votes are added here as they happen.</p>
          <div v-for="r in rollCalls" :key="r.voteId" class="public-vote">
            <div>
              <div class="text-weight-medium">{{ CHAMBER_LABELS[r.chamber] }} roll call {{ r.roll }}, {{ day(r.date) }}</div>
              <div class="text-caption">{{ r.action }}</div>
              <div v-if="shown && unread.has(r.voteId)" class="text-caption text-deep-orange-10">The chamber's record of this vote has not been read yet.</div>
            </div>
            <q-select
              v-model="positions[r.voteId]"
              outlined
              dense
              emit-value
              map-options
              :options="POSITION_OPTIONS"
              :label="`Position on roll call ${r.roll}`"
              class="public-vote__position"
            />
          </div>
        </fieldset>

        <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
        <div class="ustp-actions">
          <q-btn v-if="!shown" type="submit" color="primary" no-caps icon="public" label="Show on the Legislation page" :loading="saving" />
          <template v-else>
            <q-btn type="submit" color="primary" no-caps label="Save the public page" :disable="!changed" :loading="saving" />
            <q-btn flat no-caps label="Undo changes" :disable="!changed" @click="reset" />
          </template>
        </div>
      </form>
    </q-card-section>
  </q-card>
</template>

<style scoped>
.public-votes {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.public-vote {
  display: grid;
  grid-template-columns: 1fr 15rem;
  gap: 12px;
  align-items: start;
}
@media (max-width: 599.98px) {
  .public-vote {
    grid-template-columns: 1fr;
  }
}
</style>
