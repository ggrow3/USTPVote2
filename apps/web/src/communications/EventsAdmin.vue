<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  createEventSchema,
  DEFAULT_EVENT_TIME_ZONE,
  EVENT_ATTENDANCE,
  EVENT_ATTENDANCE_NAMES,
  EVENT_KIND_NAMES,
  EVENT_KINDS,
  EVENT_LIMITS,
  EVENT_TIME_ZONES,
  eventPhase,
  publishEventProblem,
  slugFrom,
  updateEventSchema,
  zonedInstant,
  zonedLocalTime,
  type EventAttendance,
  type EventKind,
  type EventRecord,
  type PartnerRecord,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import VideoField from '../components/VideoField.vue';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { videoDraft, videoDraftProblem, videoFromDraft } from '../video-fields.js';
import { confirmAction } from './admin-forms.js';
import { adminEvents, adminPartners, cancelEvent, createEvent, deleteEvent, publishEvent, saveEvent, VIDEO_UPLOADS } from './api.js';
import { EVENT_STATUS_COLORS, EVENT_STATUS_LABELS, eventLocalTime, formatHashtags, longDate, parseHashtags } from './comms-text.js';
import NewsBody from './NewsBody.vue';

/**
 * Events for Communications Admins (design §10.17): drafts, then publishing (public at once, on the Events page and in
 * the calendars, and in the audit ledger), changes to a published event (ledgered too, and taken by calendars that hold
 * it) and cancelling one that has not ended. A draft never published can be deleted. Times are written in the event's
 * own zone, whatever the editor's.
 */
const events = ref<EventRecord[] | null>(null);
const partners = ref<PartnerRecord[]>([]);

interface Form {
  kind: EventKind;
  title: string;
  slug: string;
  summary: string;
  body: string;
  timeZone: string;
  /** `YYYY-MM-DDTHH:mm` in the event's zone. */
  starts: string;
  ends: string;
  attendance: EventAttendance;
  joinUrl: string;
  joinLabel: string;
  place: string;
  address: string;
  /** One a line. */
  speakers: string;
  partnerIds: string[];
  hashtags: string;
  recordingUpload: string | null;
  recordingLink: string;
}
const editing = ref(false);
const current = ref<EventRecord | null>(null);
const blank = (): Form => ({
  kind: 'candidate_qa',
  title: '',
  slug: '',
  summary: '',
  body: '',
  timeZone: DEFAULT_EVENT_TIME_ZONE,
  starts: '',
  ends: '',
  attendance: 'online',
  joinUrl: '',
  joinLabel: '',
  place: '',
  address: '',
  speakers: '',
  partnerIds: [],
  hashtags: '',
  recordingUpload: null,
  recordingLink: '',
});
const form = ref<Form>(blank());
const slugTouched = ref(false);
const errors = ref<FieldErrors>({});
const preview = ref(false);
const busy = ref(false);
const videoBusy = ref(false);

const kinds = EVENT_KINDS.map((value) => ({ value, label: EVENT_KIND_NAMES[value] }));
const attendances = EVENT_ATTENDANCE.map((value) => ({ value, label: EVENT_ATTENDANCE_NAMES[value] }));
const zones = computed(() => [...new Set([...EVENT_TIME_ZONES, form.value.timeZone])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') })));
const partnerOptions = computed(() =>
  partners.value.map((p) => ({ value: p.partnerId, label: p.consent ? p.name : `${p.name} (not listed: not named in public)` })),
);
const now = ref(new Date().toISOString());

async function load() {
  await attempt(async () => {
    [events.value, partners.value] = await Promise.all([adminEvents(), adminPartners()]);
    now.value = new Date().toISOString();
  });
}

const toForm = (e: EventRecord): Form => ({
  kind: e.kind,
  title: e.title,
  slug: e.slug,
  summary: e.summary,
  body: e.body,
  timeZone: e.timeZone,
  starts: zonedLocalTime(e.startsAt, e.timeZone),
  ends: zonedLocalTime(e.endsAt, e.timeZone),
  attendance: e.attendance,
  joinUrl: e.joinUrl,
  joinLabel: e.joinLabel,
  place: e.place,
  address: e.address,
  speakers: e.speakers.join('\n'),
  partnerIds: [...e.partnerIds],
  hashtags: formatHashtags(e.hashtags),
  recordingUpload: videoDraft(e.recording).upload,
  recordingLink: videoDraft(e.recording).link,
});

function startNew() {
  current.value = null;
  form.value = blank();
  slugTouched.value = false;
  editing.value = true;
  errors.value = {};
  preview.value = false;
}

function open(e: EventRecord) {
  current.value = e;
  form.value = toForm(e);
  slugTouched.value = true;
  editing.value = true;
  errors.value = {};
  preview.value = false;
}

watch(
  () => form.value.title,
  (title) => {
    if (editing.value && !slugTouched.value && !current.value?.publishedAt) form.value.slug = slugFrom(title);
  },
);

// An end not yet given, or no longer after the start, becomes an hour and a half after it.
watch(
  () => form.value.starts,
  (starts) => {
    const zone = form.value.timeZone;
    const start = zonedInstant(starts, zone);
    if (!editing.value || !start) return;
    const end = zonedInstant(form.value.ends, zone);
    if (!end || end <= start) form.value.ends = zonedLocalTime(new Date(Date.parse(start) + 90 * 60_000).toISOString(), zone);
  },
);

const dirty = computed(() => editing.value && (!current.value || JSON.stringify(toForm(current.value)) !== JSON.stringify(form.value)));
const notReady = computed(() => (editing.value ? publishEventProblem(form.value) : null));
const over = computed(() => !!current.value && eventPhase(current.value, now.value) === 'past');

/** The form as the api takes it: times as instants from the event's zone, speakers a line each, the video chosen. */
function body() {
  const f = form.value;
  return {
    kind: f.kind,
    title: f.title,
    slug: f.slug,
    summary: f.summary,
    body: f.body,
    timeZone: f.timeZone,
    startsAt: zonedInstant(f.starts, f.timeZone),
    endsAt: zonedInstant(f.ends, f.timeZone),
    attendance: f.attendance,
    joinUrl: f.attendance === 'members_room' ? '' : f.joinUrl,
    joinLabel: f.attendance === 'members_room' ? '' : f.joinLabel,
    place: f.attendance === 'in_person' ? f.place : '',
    address: f.attendance === 'in_person' ? f.address : '',
    speakers: f.speakers
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    partnerIds: f.partnerIds,
    hashtags: parseHashtags(f.hashtags),
    recording: videoFromDraft({ upload: f.recordingUpload, link: f.recordingLink }),
  };
}

/** The api's names for fields, as the form names them. */
const FIELD_OF: Readonly<Record<string, string>> = { startsAt: 'starts', endsAt: 'ends' };
const formErrors = (found: FieldErrors): FieldErrors => Object.fromEntries(Object.entries(found).map(([k, v]) => [FIELD_OF[k] ?? k, v]));

async function save(): Promise<EventRecord | null> {
  if (!editing.value) return null;
  const event = current.value;
  const videoProblem = videoDraftProblem({ upload: form.value.recordingUpload, link: form.value.recordingLink });
  if (videoProblem) {
    errors.value = { recording: videoProblem };
    return null;
  }
  const input = body();
  const checked = event ? validate(updateEventSchema, { ...input, basedOn: event.version }) : validate(createEventSchema, input);
  if (!checked.ok) {
    errors.value = formErrors(checked.errors);
    await focusFirstInvalid();
    return null;
  }
  errors.value = {};
  let saved = null as EventRecord | null;
  busy.value = true;
  try {
    await attempt(
      async () => {
        try {
          saved = event
            ? await saveEvent(event.eventId, checked.data as Parameters<typeof saveEvent>[1])
            : await createEvent(checked.data as Parameters<typeof createEvent>[0]);
        } catch (err) {
          errors.value = formErrors(apiFieldErrors(err));
          throw err;
        }
      },
      event && event.status !== 'draft' ? 'Saved: the event has changed, and the change is in the audit ledger' : 'Draft saved',
    );
  } finally {
    busy.value = false;
  }
  if (saved) {
    open(saved);
    await load();
  }
  return saved;
}

async function publish() {
  const event = dirty.value ? await save() : current.value;
  if (!event) return;
  const ok = await confirmAction(
    event.status === 'cancelled' ? 'Publish this event again?' : 'Publish this event?',
    `“${event.title}” goes on the Events page and into the calendar people subscribe to at once, at /events/${event.slug}, which cannot change afterwards. Publishing is recorded in the audit ledger.`,
    'Publish',
  );
  if (!ok) return;
  let published = null as EventRecord | null;
  await attempt(async () => {
    published = await publishEvent(event.eventId, event.version);
  }, 'Published');
  if (published) {
    open(published);
    await load();
  }
}

async function cancel() {
  const event = current.value;
  if (!event) return;
  const ok = await confirmAction(
    'Cancel this event?',
    'Its page and the calendars that hold it say it is cancelled, and its link to join is taken off. Cancelling is recorded in the audit ledger; you can publish it again.',
    'Cancel the event',
  );
  if (!ok) return;
  let cancelled = null as EventRecord | null;
  await attempt(async () => {
    cancelled = await cancelEvent(event.eventId, event.version);
  }, 'Cancelled');
  if (cancelled) {
    open(cancelled);
    await load();
  }
}

async function remove() {
  const event = current.value;
  if (!event || !(await confirmAction('Delete this draft?', `“${event.title}” has never been published. Deleting it cannot be undone.`, 'Delete'))) return;
  if (await attempt(() => deleteEvent(event.eventId), 'Draft deleted')) {
    editing.value = false;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Candidate Q&amp;As, debate nights, talks and events with <strong>partners</strong> appear on the public
      <router-link to="/events">Events page</router-link>, each with its own page, calendar buttons and share buttons, as soon
      as you publish them. Publishing, changing a published event and cancelling one are recorded in the audit ledger; drafts
      are not. Once an event is over, add its recording here.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!editing" unelevated no-caps color="primary" icon="add" label="New event" @click="startNew" />
    </div>

    <q-card v-if="editing" flat bordered>
      <q-card-section class="ustp-header">
        <div>
          <h2 class="text-subtitle1">{{ current ? current.title : 'New event' }}</h2>
          <div v-if="current" class="text-caption text-grey-7">
            <q-badge :color="EVENT_STATUS_COLORS[current.status]" :label="EVENT_STATUS_LABELS[current.status]" />
            <template v-if="over"> · over</template>
            <template v-if="current.publishedAt"> · published {{ longDate(current.publishedAt) }}</template>
            <template v-if="current.editedAt"> · changed {{ longDate(current.editedAt) }}</template>
            · version {{ current.version }}
          </div>
        </div>
        <q-btn
          v-if="current && current.status !== 'draft'"
          flat
          no-caps
          color="primary"
          icon-right="north_east"
          label="View"
          :to="`/events/${current.slug}`"
          target="_blank"
          aria-label="View the event (opens in a new tab)"
        />
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <q-select v-model="form.kind" outlined dense emit-value map-options :options="kinds" label="Kind" />
          <q-input v-model="form.title" outlined label="Title" :maxlength="EVENT_LIMITS.title" counter :error="!!errors.title" :error-message="errors.title" />
          <q-input
            v-model="form.slug"
            outlined
            dense
            label="Address"
            prefix="/events/"
            :readonly="!!current?.publishedAt"
            :hint="current?.publishedAt ? 'Fixed once published, so links and calendars keep working.' : 'Fixed once it is published.'"
            :error="!!errors.slug"
            :error-message="errors.slug"
            @update:model-value="slugTouched = true"
          />
          <q-input
            v-model="form.summary"
            outlined
            type="textarea"
            autogrow
            label="Summary"
            hint="One or two sentences: the Events list, share buttons, link previews and calendars carry it."
            :maxlength="EVENT_LIMITS.summary"
            counter
            :error="!!errors.summary"
            :error-message="errors.summary"
          />

          <div class="events-admin__when">
            <q-select v-model="form.timeZone" outlined dense emit-value map-options :options="zones" label="Time zone" hint="The times below are in this zone." />
            <q-input v-model="form.starts" outlined dense type="datetime-local" label="Starts" stack-label :error="!!errors.starts" :error-message="errors.starts" />
            <q-input v-model="form.ends" outlined dense type="datetime-local" label="Ends" stack-label :error="!!errors.ends" :error-message="errors.ends" />
          </div>
          <div v-if="form.starts && form.ends && zonedInstant(form.starts, form.timeZone) && zonedInstant(form.ends, form.timeZone)" class="text-caption text-grey-7">
            Your own time: {{ eventLocalTime({ startsAt: zonedInstant(form.starts, form.timeZone), endsAt: zonedInstant(form.ends, form.timeZone) }) }}
          </div>

          <div>
            <div class="text-body2 text-weight-medium">How people attend</div>
            <q-option-group v-model="form.attendance" :options="attendances" inline type="radio" />
            <div class="text-caption text-grey-7">
              <template v-if="form.attendance === 'online'">At a link: a stream (YouTube Live, X, Twitch) or a meeting (Zoom, Meet, Jitsi). The site streams nothing itself.</template>
              <template v-else-if="form.attendance === 'in_person'">At a place, perhaps streamed too.</template>
              <template v-else>In the members’ room’s call, for Active members only (it is peer to peer, so a few people at a time). The public may watch the recording afterwards.</template>
            </div>
          </div>
          <template v-if="form.attendance === 'in_person'">
            <q-input v-model="form.place" outlined dense label="Place" placeholder="The Hall" :maxlength="EVENT_LIMITS.place" :error="!!errors.place" :error-message="errors.place" />
            <q-input v-model="form.address" outlined dense label="Address (optional)" placeholder="1 Main St, Austin, TX" :maxlength="EVENT_LIMITS.address" />
          </template>
          <template v-if="form.attendance !== 'members_room'">
            <q-input
              v-model="form.joinUrl"
              outlined
              dense
              :label="form.attendance === 'online' ? 'Link to watch or join' : 'Link to watch online (optional)'"
              placeholder="https://"
              hint="Shown on the event's page until it is over."
              :error="!!errors.joinUrl"
              :error-message="errors.joinUrl"
            />
            <q-input v-model="form.joinLabel" outlined dense label="What the link is (optional)" placeholder="YouTube Live" :maxlength="EVENT_LIMITS.joinLabel" />
          </template>
          <q-banner v-if="errors.place && form.attendance !== 'in_person'" class="bg-red-1 text-black" rounded role="alert">{{ errors.place }}</q-banner>

          <q-input
            v-model="form.speakers"
            outlined
            type="textarea"
            autogrow
            label="Speakers (optional)"
            :hint="`One a line, with what they are if it helps (“Jo Smith, candidate for CA-12”); at most ${EVENT_LIMITS.speakers}.`"
            :error="!!errors.speakers || Object.keys(errors).some((k) => k.startsWith('speakers.'))"
            :error-message="errors.speakers ?? Object.entries(errors).find(([k]) => k.startsWith('speakers.'))?.[1]"
          />
          <q-select
            v-model="form.partnerIds"
            outlined
            dense
            multiple
            use-chips
            emit-value
            map-options
            :options="partnerOptions"
            label="Co-hosted with (optional)"
            :hint="partners.length ? 'Groups from the Partners tab; only those listed with their consent are named in public.' : 'Add the group in the Partners tab first.'"
            :error="!!errors.partnerIds"
            :error-message="errors.partnerIds"
          />

          <div>
            <div class="ustp-header">
              <div class="text-body2 text-weight-medium">More about it (optional)</div>
              <q-btn-toggle
                v-model="preview"
                dense
                flat
                no-caps
                toggle-color="primary"
                :options="[
                  { label: 'Write', value: false },
                  { label: 'Preview', value: true },
                ]"
              />
            </div>
            <q-input
              v-if="!preview"
              v-model="form.body"
              outlined
              type="textarea"
              autogrow
              :input-style="{ minHeight: '8em' }"
              aria-label="More about it"
              hint="Plain text, as in news posts: a blank line starts a paragraph; “## ” a heading, “- ” a list item; https:// addresses become links."
              :maxlength="EVENT_LIMITS.body"
              :error="!!errors.body"
              :error-message="errors.body"
            />
            <q-card v-else flat bordered class="q-pa-md">
              <NewsBody v-if="form.body.trim()" :body="form.body" />
              <div v-else class="text-grey-7">Nothing written yet.</div>
            </q-card>
          </div>

          <div>
            <div class="text-body2 text-weight-medium">Recording (optional)</div>
            <div class="text-caption text-grey-7">Shown on its page: a YouTube video, or one uploaded to this site.</div>
          </div>
          <VideoField
            v-model:upload="form.recordingUpload"
            v-model:link="form.recordingLink"
            :upload-path="VIDEO_UPLOADS"
            :title="form.title || 'this event'"
            @busy="(b) => (videoBusy = b)"
          />
          <q-banner v-if="errors.recording" class="bg-red-1 text-black" rounded role="alert">{{ errors.recording }}</q-banner>
          <q-input
            v-model="form.hashtags"
            outlined
            dense
            label="Hashtags (optional)"
            placeholder="#USTP #Transhumanism"
            hint="Up to 5; share buttons add them after the summary."
            :error="!!errors.hashtags || Object.keys(errors).some((k) => k.startsWith('hashtags.'))"
            :error-message="errors.hashtags ?? Object.entries(errors).find(([k]) => k.startsWith('hashtags.'))?.[1]"
          />
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" :label="current ? 'Save changes' : 'Save draft'" :disable="!dirty || videoBusy" :loading="busy" />
            <q-btn
              v-if="current?.status !== 'published'"
              outline
              no-caps
              color="primary"
              icon="campaign"
              :label="current?.status === 'cancelled' ? 'Publish again' : 'Publish'"
              :disable="!!notReady || busy || videoBusy"
              @click="publish"
            />
            <q-btn v-if="current?.status === 'published' && !over" outline no-caps color="negative" label="Cancel the event" @click="cancel" />
            <q-btn v-if="current && !current.publishedAt" flat no-caps color="negative" label="Delete draft" @click="remove" />
            <q-btn flat no-caps label="Close" @click="editing = false" />
          </div>
          <div v-if="notReady && current?.status !== 'published'" class="text-caption text-grey-7">To publish: {{ notReady }}.</div>
        </q-form>
      </q-card-section>
    </q-card>

    <div v-if="events && events.length === 0 && !editing" class="text-grey-7">No events yet.</div>
    <q-list v-else-if="events" bordered separator class="rounded-borders">
      <q-item v-for="e in events" :key="e.eventId" clickable :active="editing && current?.eventId === e.eventId" @click="open(e)">
        <q-item-section>
          <q-item-label>{{ e.title }}</q-item-label>
          <q-item-label caption>
            {{ EVENT_KIND_NAMES[e.kind] }} · {{ eventLocalTime(e) }} · /events/{{ e.slug }}
            <template v-if="e.recording"> · recording</template>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge v-if="e.status === 'published' && eventPhase(e, now) === 'past'" color="grey-6" label="Over" />
          <q-badge v-else :color="EVENT_STATUS_COLORS[e.status]" :label="EVENT_STATUS_LABELS[e.status]" />
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<style scoped>
.events-admin__when {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}
</style>
