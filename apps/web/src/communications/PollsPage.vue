<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { PublicPoll } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { pollsList } from './api.js';
import CommsNav from './CommsNav.vue';
import { longDate, shortTime } from './comms-text.js';
import PollBars from './PollBars.vue';
import { answersText, leadText, pollPath, pollVoter, rememberedAnswer } from './polls.js';

/**
 * The issue polls (design §10.15): open ones to answer, newest first, then closed ones with their results. A poll
 * this browser answered shows its running results here too.
 */
usePageTitle('Polls');
const polls = ref<PublicPoll[] | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    polls.value = await pollsList(pollVoter());
  } catch (e) {
    error.value = errorMessage(e);
  }
});

const open = computed(() => polls.value?.filter((p) => p.state === 'open') ?? []);
const closed = computed(() => polls.value?.filter((p) => p.state === 'closed') ?? []);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <div>
        <h1 class="text-h5 q-mb-xs">Polls</h1>
        <div class="text-grey-7">
          What do you think? Anyone may answer, member or not, once each. Polls decide nothing and are not scientific
          surveys: the party decides in <router-link to="/vote">its elections</router-link>, which only members vote in.
          Answer a poll to see its results so far; everyone sees them when it closes.
        </div>
      </div>
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!polls" class="text-grey-7">Loading…</div>
      <template v-else>
        <section aria-labelledby="polls-open">
          <h2 id="polls-open" class="text-subtitle1">Open now</h2>
          <div v-if="!open.length" class="text-grey-7">No poll is open right now. See the results of earlier ones below.</div>
          <div class="ustp-stack">
            <q-card v-for="p in open" :key="p.pollId" flat bordered>
              <q-card-section>
                <h3 class="text-subtitle1 q-my-none">
                  <router-link :to="pollPath(p.pollId)">{{ p.question }}</router-link>
                </h3>
                <div class="text-caption text-grey-7">
                  Open until {{ shortTime(p.closesAt) }}<template v-if="p.voted"> · you answered</template>
                </div>
              </q-card-section>
              <q-card-section v-if="p.results" class="q-pt-none">
                <PollBars :choices="p.choices" :results="p.results" :mine="rememberedAnswer(p.pollId)" />
              </q-card-section>
              <q-card-actions v-else>
                <q-btn unelevated no-caps color="primary" label="Answer" :to="pollPath(p.pollId)" :aria-label="`Answer: ${p.question}`" />
                <span class="text-caption text-grey-7 q-ml-sm">{{ p.choices.map((c) => c.label).join(' · ') }}</span>
              </q-card-actions>
            </q-card>
          </div>
        </section>

        <section v-if="closed.length" aria-labelledby="polls-closed">
          <h2 id="polls-closed" class="text-subtitle1">Closed</h2>
          <q-list bordered separator class="rounded-borders">
            <q-item v-for="p in closed" :key="p.pollId" clickable :to="pollPath(p.pollId)">
              <q-item-section>
                <q-item-label>{{ p.question }}</q-item-label>
                <q-item-label caption>
                  Closed {{ longDate(p.closesAt) }}<template v-if="p.results">
                    · {{ answersText(p.results.everyone.total) }}<template v-if="leadText(p.choices, p.results.everyone)">
                      · {{ leadText(p.choices, p.results.everyone) }}</template
                    ></template
                  >
                </q-item-label>
              </q-item-section>
              <q-item-section side><q-icon name="chevron_right" /></q-item-section>
            </q-item>
          </q-list>
        </section>
      </template>
    </div>
  </PageShell>
</template>
