<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { PROBLEM_TYPES, pollItem, type PublicPoll } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import { APP_NAME } from '../app-name.js';
import PageShell from '../components/PageShell.vue';
import { session } from '../session.js';
import { answerPoll, pollView } from './api.js';
import CommsNav from './CommsNav.vue';
import { longDate, shortTime } from './comms-text.js';
import PollBars from './PollBars.vue';
import { cardSrc } from '../seo.js';
import { answersText, pollPath, pollShareable, pollVoter, rememberAnswer, rememberedAnswer } from './polls.js';
import ShareButtons from './ShareButtons.vue';

/**
 * One issue poll (design §10.16): its question and choices to answer, once per person; the running results to those
 * who answered, and to everyone once it closes; its share buttons and card. Plainly a poll, not an election.
 */
const route = useRoute();
const poll = ref<PublicPoll | null>(null);
const missing = ref(false);
const error = ref<string | null>(null);
const choice = ref<string | null>(null);
const trap = ref('');
const sending = ref(false);
const failure = ref<string | null>(null);
const mine = ref<string | null>(null);
usePageTitle(() => (poll.value ? `${poll.value.state === 'closed' ? 'Poll results' : 'Poll'}: ${poll.value.question}` : 'Poll'));

/** Answers and reads as themself only someone signed in with an account; anyone else is a visitor with a browser token. */
const signedIn = computed(() => !!session.user && !!session.me?.account);
const pollId = computed(() => String(route.params.id ?? ''));

async function load() {
  poll.value = null;
  missing.value = false;
  error.value = null;
  failure.value = null;
  try {
    poll.value = await pollView(pollId.value, pollVoter(), signedIn.value);
    mine.value = rememberedAnswer(pollId.value);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) missing.value = true;
    else error.value = errorMessage(e);
  }
}

watch([pollId, signedIn], load, { immediate: true });

async function answer() {
  if (!poll.value || !choice.value) {
    failure.value = 'Choose an answer first.';
    return;
  }
  failure.value = null;
  sending.value = true;
  try {
    const answered = await answerPoll(poll.value.pollId, { choiceId: choice.value, voter: pollVoter(), website: trap.value }, signedIn.value);
    rememberAnswer(answered.pollId, choice.value);
    mine.value = choice.value;
    poll.value = answered;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      // Answered before (on this browser, or by this account elsewhere), or it closed meanwhile: show where it stands.
      failure.value = errorMessage(e);
      const latest = await pollView(poll.value.pollId, pollVoter(), signedIn.value).catch(() => null);
      if (latest) poll.value = latest;
    } else if (e instanceof ApiError && e.problem.type === PROBLEM_TYPES.mfaRequired) {
      failure.value = 'Set up two-step sign-in on your account page to answer while signed in.';
    } else {
      failure.value = errorMessage(e);
    }
  } finally {
    sending.value = false;
  }
}

const card = computed(() =>
  poll.value ? cardSrc(pollPath(poll.value.pollId), poll.value.state === 'closed' ? `closed-${poll.value.results?.everyone.total ?? 0}` : 'open') : '',
);
const cardAlt = computed(() =>
  poll.value ? `${poll.value.state === 'closed' ? 'Poll results' : 'Poll'}: ${poll.value.question}` : '',
);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="missing">
        <h1 class="text-h5">Not found</h1>
        <p>There is no poll at this address. <router-link to="/polls">See all the polls</router-link>.</p>
      </div>
      <div v-else-if="!poll" class="text-grey-7">Loading…</div>
      <template v-else>
        <div>
          <div class="text-caption text-uppercase text-grey-7 poll-page__kind">
            {{ poll.state === 'open' ? 'Poll · open' : 'Poll · closed' }}
          </div>
          <h1 class="text-h5 q-mt-xs q-mb-xs">{{ poll.question }}</h1>
          <div class="text-caption text-grey-7">
            <template v-if="poll.state === 'open'">Open until {{ shortTime(poll.closesAt) }}</template>
            <template v-else>Closed {{ longDate(poll.closesAt) }}</template>
            <template v-if="poll.results"> · {{ answersText(poll.results.everyone.total) }}</template>
          </div>
        </div>
        <p v-if="poll.description" class="poll-page__description">{{ poll.description }}</p>

        <q-banner class="bg-grey-2 text-black" rounded dense>
          <template #avatar><q-icon name="info" color="grey-8" /></template>
          A poll of what people think, not an election: it decides nothing, and anyone may answer, member or not. It is
          not a scientific survey. The party decides in <router-link to="/vote">its elections</router-link>, which only
          members vote in, on {{ APP_NAME }}.
        </q-banner>

        <q-card v-if="poll.state === 'open' && !poll.voted" flat bordered>
          <q-card-section>
            <q-form class="ustp-form" novalidate @submit.prevent="answer">
              <fieldset class="ustp-fieldset">
                <legend>Your answer</legend>
                <q-option-group v-model="choice" :options="poll.choices.map((c) => ({ value: c.choiceId, label: c.label }))" type="radio" />
              </fieldset>
              <!-- Left empty by people; hidden from them and from screen readers. -->
              <div class="poll-page__trap" aria-hidden="true">
                <label>Website <input v-model="trap" type="text" tabindex="-1" autocomplete="off" /></label>
              </div>
              <q-banner v-if="failure" class="bg-orange-1 text-black" rounded role="alert">{{ failure }}</q-banner>
              <div class="ustp-actions">
                <q-btn type="submit" unelevated no-caps color="primary" label="Answer and see the results" :loading="sending" :disable="!choice" />
              </div>
              <div class="text-caption text-grey-7">
                One answer each, and it cannot be changed. Your answer is counted, never stored with you or your
                address; this browser remembers it for you.
                <template v-if="signedIn"> Signed in, you answer as your account; an Active member's answer is also counted among members.</template>
                <template v-else> Members: <router-link :to="{ path: '/signin', query: { redirect: pollPath(poll.pollId) } }">sign in</router-link> first to be counted among members too.</template>
              </div>
            </q-form>
          </q-card-section>
        </q-card>

        <q-card v-if="poll.results" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">{{ poll.state === 'closed' ? 'Results' : 'Results so far' }}</h2>
            <div v-if="poll.state === 'open'" class="text-caption text-grey-7 q-mb-sm">
              You see them because you answered; everyone sees them once the poll closes, {{ shortTime(poll.closesAt) }}.
            </div>
            <q-banner v-if="failure" class="bg-orange-1 text-black q-mb-sm" rounded role="alert">{{ failure }}</q-banner>
            <PollBars :choices="poll.choices" :results="poll.results" :mine="mine" />
          </q-card-section>
        </q-card>

        <q-separator class="q-my-sm" />
        <h2 class="text-subtitle1">{{ poll.state === 'closed' ? 'Share the results' : 'Share this poll' }}</h2>
        <ShareButtons :item="pollShareable(poll)" :count-as="pollItem(poll.pollId)" />
        <figure class="poll-page__card">
          <img :src="card" :alt="cardAlt" width="1200" height="630" loading="lazy" />
          <figcaption class="text-caption text-grey-7">
            How a link to this page looks when shared{{ poll.state === 'open' ? ': the results show on it once the poll closes' : '' }}.
            <a :href="card" download="poll-card.png">Download the image</a>
          </figcaption>
        </figure>
        <div><router-link to="/polls">All polls</router-link></div>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.poll-page__kind {
  letter-spacing: 0.06em;
}
.poll-page__description {
  white-space: pre-line;
}
.poll-page__trap {
  position: absolute;
  left: -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.poll-page__card {
  margin: 0;
  max-width: 600px;
}
.poll-page__card img {
  width: 100%;
  height: auto;
  border: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 8px;
  display: block;
}
</style>
