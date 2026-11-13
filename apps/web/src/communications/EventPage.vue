<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  EVENT_KIND_NAMES,
  eventCalendarPath,
  eventItem,
  eventPhase,
  eventWhen,
  googleCalendarUrl,
  joinLinkName,
  outlookCalendarUrl,
  type EventPhase,
  type PublicEvent,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import VideoPlayer from '../components/VideoPlayer.vue';
import { session } from '../session.js';
import { publicEvent } from './api.js';
import CommsNav from './CommsNav.vue';
import { eventLocalTime, eventShareable, longDate, otherZone } from './comms-text.js';
import NewsBody from './NewsBody.vue';
import ShareButtons from './ShareButtons.vue';

/**
 * One event (design §10.17): when (in its own zone, and the viewer's if that differs) and where, the way in (an
 * outside link, a place, or the members' room for Active members), calendar buttons, the speakers and co-hosts, and
 * once it is over its recording. Calendar and map buttons are plain links: nothing of those sites loads here.
 */
const route = useRoute();
const event = ref<PublicEvent | null>(null);
const missing = ref(false);
const error = ref<string | null>(null);
const phase = ref<EventPhase>('upcoming');
usePageTitle(() => event.value?.title ?? 'Event');

watch(
  () => String(route.params.slug ?? ''),
  async (slug) => {
    event.value = null;
    missing.value = false;
    error.value = null;
    try {
      event.value = await publicEvent(slug);
      phase.value = eventPhase(event.value, new Date().toISOString());
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) missing.value = true;
      else error.value = errorMessage(e);
    }
  },
  { immediate: true },
);

const cancelled = computed(() => event.value?.status === 'cancelled');
const comingOrOn = computed(() => !cancelled.value && phase.value !== 'past');
const activeMember = computed(() => session.me?.member?.status === 'active');
const mapUrl = computed(() =>
  event.value ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([event.value.place, event.value.address].filter(Boolean).join(', '))}` : '',
);
const calendars = computed(() => {
  const e = event.value;
  if (!e) return null;
  // The links need what the public page has; the event's ID is not one, and the calendar files carry it themselves.
  const linked = { ...e, eventId: '', version: 0, status: e.status };
  return {
    ics: eventCalendarPath(e.slug),
    google: googleCalendarUrl(linked, location.origin),
    outlook: outlookCalendarUrl(linked, location.origin),
  };
});
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="missing">
        <h1 class="text-h5">Not found</h1>
        <p>There is no event at this address. <router-link to="/events">See the events</router-link>.</p>
      </div>
      <div v-else-if="!event" class="text-grey-7">Loading…</div>
      <article v-else>
        <div class="text-caption text-uppercase text-grey-7 event__kind">{{ EVENT_KIND_NAMES[event.kind] }}</div>
        <h1 class="text-h5 q-mt-xs q-mb-xs">{{ event.title }}</h1>
        <q-banner v-if="cancelled" class="bg-grey-3 text-black q-my-sm" rounded role="status">
          The party cancelled this event<template v-if="event.cancelledAt"> on {{ longDate(event.cancelledAt) }}</template>. It will not take place.
        </q-banner>
        <q-banner v-else-if="phase === 'live'" class="bg-red-1 text-black q-my-sm" rounded role="status">On now.</q-banner>
        <q-banner v-else-if="phase === 'past'" class="bg-blue-1 text-black q-my-sm" rounded role="status">
          This event took place on {{ longDate(event.startsAt) }}.
          <template v-if="!event.recording"> There is no recording of it here yet.</template>
        </q-banner>

        <div class="event__facts">
          <div>
            <q-icon name="schedule" aria-hidden="true" class="q-mr-xs" />
            <time :datetime="event.startsAt">{{ eventWhen(event) }}</time>
            <div v-if="otherZone(event.timeZone)" class="text-caption text-grey-7">Your time: {{ eventLocalTime(event) }}</div>
          </div>
          <div v-if="event.attendance === 'in_person'">
            <q-icon name="place" aria-hidden="true" class="q-mr-xs" />
            <strong>{{ event.place }}</strong><template v-if="event.address">, {{ event.address }}</template>
            · <a :href="mapUrl" target="_blank" rel="noopener noreferrer">Map</a>
          </div>
          <div v-else-if="event.attendance === 'members_room'">
            <q-icon name="forum" aria-hidden="true" class="q-mr-xs" />
            In the members’ room’s call, for Active members.
          </div>
          <div v-else>
            <q-icon name="videocam" aria-hidden="true" class="q-mr-xs" />
            Online<template v-if="event.joinUrl">, at {{ joinLinkName(event) }}</template>
          </div>
        </div>

        <div v-if="comingOrOn" class="ustp-actions q-my-md">
          <q-btn
            v-if="event.joinUrl"
            unelevated
            no-caps
            color="primary"
            icon="open_in_new"
            :label="event.attendance === 'in_person' ? `Watch online at ${joinLinkName(event)}` : `Join at ${joinLinkName(event)}`"
            :href="event.joinUrl"
            target="_blank"
            rel="noopener noreferrer"
          />
          <template v-if="event.attendance === 'members_room'">
            <q-btn v-if="activeMember" unelevated no-caps color="primary" icon="forum" label="Go to the members’ room" to="/room" />
            <q-btn v-else unelevated no-caps color="primary" icon="how_to_reg" label="Join the party to take part" to="/register" />
          </template>
          <q-btn-dropdown v-if="calendars" outline no-caps color="primary" icon="event" label="Add to calendar">
            <q-list>
              <q-item clickable tag="a" :href="calendars.ics">
                <q-item-section>Apple Calendar, Outlook or another app (.ics)</q-item-section>
              </q-item>
              <q-item clickable tag="a" :href="calendars.google" target="_blank" rel="noopener noreferrer">
                <q-item-section>Google Calendar</q-item-section>
              </q-item>
              <q-item clickable tag="a" :href="calendars.outlook" target="_blank" rel="noopener noreferrer">
                <q-item-section>Outlook.com</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>

        <p v-if="event.summary" class="text-subtitle1 q-mt-md">{{ event.summary }}</p>
        <VideoPlayer v-if="event.recording" :video="event.recording" :title="`Recording: ${event.title}`" />

        <div v-if="event.speakers.length" class="q-my-md">
          <h2 class="text-subtitle1 q-mb-xs">{{ event.kind === 'debate' ? 'Debating' : event.kind === 'candidate_qa' ? 'Answering questions' : 'Speaking' }}</h2>
          <ul class="q-my-none">
            <li v-for="s in event.speakers" :key="s">{{ s }}</li>
          </ul>
        </div>
        <div v-if="event.partners.length" class="q-my-md">
          <h2 class="text-subtitle1 q-mb-xs">Co-hosted with</h2>
          <ul class="q-my-none">
            <li v-for="p in event.partners" :key="p.partnerId">
              <router-link :to="{ path: '/partners', hash: `#partner-${p.partnerId}` }">{{ p.name }}</router-link>
              <template v-if="p.website"> · <a :href="p.website" target="_blank" rel="noopener noreferrer">their site</a></template>
            </li>
          </ul>
        </div>

        <NewsBody v-if="event.body" :body="event.body" />
        <div v-if="event.hashtags.length" class="text-grey-7 q-mb-md">
          <span v-for="t in event.hashtags" :key="t" class="q-mr-sm">#{{ t }}</span>
        </div>
        <div class="text-caption text-grey-7">
          <router-link to="/events">All events</router-link><template v-if="event.editedAt"> · updated {{ longDate(event.editedAt) }}</template>
        </div>
        <template v-if="!cancelled">
          <q-separator class="q-my-md" />
          <h2 class="text-subtitle1">Share this</h2>
          <ShareButtons :item="eventShareable(event)" :count-as="eventItem(event.slug)" />
        </template>
      </article>
    </div>
  </PageShell>
</template>

<style scoped>
.event__kind {
  letter-spacing: 0.06em;
}
.event__facts {
  display: grid;
  gap: 6px;
  margin: 12px 0;
}
</style>
