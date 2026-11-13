<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { EVENT_KIND_NAMES, EVENTS_CALENDAR_PATH, eventPhase, eventWhere, type PublicEventSummary, type PublicEventsPage } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { APP_NAME } from '../app-name.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { eventsPage } from './api.js';
import CommsNav from './CommsNav.vue';
import { eventLocalTime, longDate } from './comms-text.js';

/**
 * Events (design §10.17): what is coming, soonest first, and what took place, with its recording, for everyone. Each
 * event has its own page with its link, calendar buttons and share buttons; this page offers the calendar to subscribe
 * to, which calendar apps fetch from the api themselves.
 */
usePageTitle('Events');
const $q = useQuasar();
const page = ref<PublicEventsPage | null>(null);
const error = ref<string | null>(null);
const now = new Date().toISOString();

const feed = computed(() => `${location.origin}${EVENTS_CALENDAR_PATH}`);
/** Calendar apps subscribe to webcal:// addresses, and Google Calendar to one given as its `cid`. */
const webcal = computed(() => feed.value.replace(/^https?:/, 'webcal:'));
const google = computed(() => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal.value)}`);

const live = (e: PublicEventSummary) => e.status === 'published' && eventPhase(e, now) === 'live';

async function copyFeed() {
  try {
    await navigator.clipboard.writeText(feed.value);
    $q.notify({ type: 'positive', message: 'Copied the calendar’s address' });
  } catch {
    $q.notify({ message: feed.value, timeout: 10_000 });
  }
}

onMounted(async () => {
  try {
    page.value = await eventsPage();
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <div>
        <h1 class="text-h5 q-mb-xs">Events</h1>
        <div class="text-grey-7">
          Candidate Q&amp;As, debate nights, talks and meetups, some with the party’s
          <router-link to="/partners">partner groups</router-link>. Anyone may come unless an event says it is for Active members.
        </div>
      </div>
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!page" class="text-grey-7">Loading…</div>
      <template v-else>
        <section aria-labelledby="events-coming">
          <h2 id="events-coming" class="text-subtitle1 text-weight-medium">Coming up</h2>
          <div v-if="page.upcoming.length === 0" class="text-grey-7">Nothing is planned yet. Subscribe below to hear when something is.</div>
          <q-list v-else separator>
            <q-item v-for="e in page.upcoming" :key="e.slug" class="q-px-none">
              <q-item-section>
                <q-item-label caption class="text-uppercase events-kind">
                  {{ EVENT_KIND_NAMES[e.kind] }}
                  <q-badge v-if="e.status === 'cancelled'" color="grey-7" label="Cancelled" class="q-ml-xs" />
                  <q-badge v-else-if="live(e)" color="negative" label="On now" class="q-ml-xs" />
                </q-item-label>
                <q-item-label class="text-subtitle1 text-weight-medium" :class="{ 'events-cancelled': e.status === 'cancelled' }">
                  <router-link :to="`/events/${e.slug}`">{{ e.title }}</router-link>
                </q-item-label>
                <q-item-label caption>
                  <time :datetime="e.startsAt">{{ eventLocalTime(e) }}</time> · {{ eventWhere(e) }}
                </q-item-label>
                <q-item-label v-if="e.partners.length" caption>With {{ e.partners.map((p) => p.name).join(', ') }}</q-item-label>
                <q-item-label v-if="e.summary" class="q-mt-xs">{{ e.summary }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </section>

        <q-card flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Add every event to your calendar</h2>
            <p class="q-mb-sm">
              Subscribe once and each new event, change or cancellation of {{ APP_NAME }} appears in your calendar app on its
              own. No sign-in or email is needed.
            </p>
            <div class="ustp-actions">
              <q-btn outline no-caps color="primary" icon="event" label="Apple Calendar, Outlook…" :href="webcal" />
              <q-btn outline no-caps color="primary" icon="calendar_month" label="Google Calendar" :href="google" target="_blank" rel="noopener noreferrer" />
              <q-btn flat no-caps color="primary" icon="content_copy" label="Copy the address" @click="copyFeed" />
            </div>
          </q-card-section>
        </q-card>

        <section v-if="page.past.length" aria-labelledby="events-past">
          <h2 id="events-past" class="text-subtitle1 text-weight-medium">Past events</h2>
          <q-list separator>
            <q-item v-for="e in page.past" :key="e.slug" class="q-px-none">
              <q-item-section>
                <q-item-label>
                  <router-link :to="`/events/${e.slug}`">{{ e.title }}</router-link>
                </q-item-label>
                <q-item-label caption>
                  {{ EVENT_KIND_NAMES[e.kind] }} · <time :datetime="e.startsAt">{{ longDate(e.startsAt) }}</time>
                  <template v-if="e.partners.length"> · with {{ e.partners.map((p) => p.name).join(', ') }}</template>
                </q-item-label>
              </q-item-section>
              <q-item-section v-if="e.recorded" side>
                <q-chip dense icon="play_circle" label="Recording" color="primary" text-color="white" />
              </q-item-section>
            </q-item>
          </q-list>
        </section>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.events-kind {
  letter-spacing: 0.06em;
}
.events-cancelled a {
  text-decoration: line-through;
}
</style>
