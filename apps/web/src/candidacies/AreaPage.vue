<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CONTACT_FEEDS,
  candidateName,
  contactDistricts,
  fillTemplate,
  groupAreaContacts,
  placeholderValues,
  type AreaContact,
  type AreaContactsView,
  type ContactDistrict,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt } from '../dialogs.js';
import { session } from '../session.js';
import { areaContacts } from './api.js';
import {
  areaText,
  CONTACT_SOURCE_TEXT,
  DISTRICT_LABELS,
  districtPeopleText,
  districtText,
  electionDay,
  feedNote,
  mailtoLink,
  OFFICE_HEADINGS,
} from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';
import { mapsRefused } from './maps.js';

/**
 * Your area (design §5.12): for a signed-in member, who holds each office where they live and who is running for it,
 * from public records and from the party's communications team, each with an email the member can edit and send from
 * their own email app. The site sends nothing and keeps no copy. Where the map is set up, it shows a pin in each of
 * their districts, with who is in office and running there, and the outline of the one they choose.
 */
usePageTitle('Your area');
const view = ref<AreaContactsView | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    view.value = await areaContacts();
  } catch (e) {
    error.value = errorMessage(e);
  }
});

const note = computed(() => (view.value ? areaText(view.value.area) : null));
const feedNotes = computed(() => (view.value ? CONTACT_FEEDS.map((f) => feedNote(f, view.value!.feeds[f])).filter((n): n is string => n !== null) : []));

/** A heading per district (the nation, the state, then each district), each with its offices. */
const sections = computed(() => {
  if (!view.value) return [];
  const groups = groupAreaContacts(view.value.area, view.value.contacts);
  return contactDistricts(view.value.area).map((district) => ({
    district,
    groups: groups.filter((g) => g.district.kind === district.kind && g.district.geoid === district.geoid),
  }));
});

// The map: a pin per district with a point, and the chosen district's outline (the first, until one is chosen).
const districtKey = (d: Pick<ContactDistrict, 'kind' | 'geoid'>) => `${d.kind}:${d.geoid}`;
const mapLoaded = ref(false);
/** Google can refuse the key after the map has loaded; then the page shows no map. */
const mapReady = computed(() => mapLoaded.value && !mapsRefused.value);
const chosen = ref<string | null>(null);
const mapped = computed(() => (view.value?.area.districts ?? []).filter((d) => d.point));
const shown = computed(() => mapped.value.find((d) => districtKey(d) === chosen.value) ?? mapped.value[0] ?? null);
const markers = computed<MapMarker[]>(() =>
  mapped.value.map((d) => ({ id: districtKey(d), point: d.point!, title: d.name, caption: districtPeopleText(view.value!.contacts, d) })),
);
const outline = computed(() => (shown.value ? { kind: shown.value.kind, geoid: shown.value.geoid } : null));
const onMap = (d: Pick<ContactDistrict, 'kind' | 'geoid'>) => mapReady.value && mapped.value.some((m) => districtKey(m) === districtKey(d));

function showOnMap(d: Pick<ContactDistrict, 'kind' | 'geoid'>) {
  chosen.value = districtKey(d);
  document.getElementById('area-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const running = (c: AreaContact) => (c.election && /^\d{4}-\d{2}-\d{2}$/.test(c.election) ? `Election ${electionDay(c.election)}` : `Running in ${c.election ?? 'the next election'}`);
const caption = (c: AreaContact) => [c.officeTitle, c.party, CONTACT_SOURCE_TEXT[c.source]].filter(Boolean).join(' · ');

/** The email being written: to whom, and its text, filled in from the office's template and editable. */
const writing = ref<{ contact: AreaContact; subject: string; body: string } | null>(null);
const open = computed({
  get: () => writing.value !== null,
  set: (v) => {
    if (!v) writing.value = null;
  },
});

function write(contact: AreaContact) {
  const template = view.value!.templates[contact.office];
  const me = session.me?.member;
  const values = placeholderValues(contact, districtText(contact), me ? candidateName(me) : '');
  writing.value = { contact, subject: fillTemplate(template.subject, values), body: fillTemplate(template.body, values) };
}

async function copy() {
  const w = writing.value;
  if (!w) return;
  const to = w.contact.email ? `To: ${w.contact.email}\n` : '';
  await attempt(() => navigator.clipboard.writeText(`${to}Subject: ${w.subject}\n\n${w.body}`), 'Copied');
}
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div>
        <h1 class="text-h5 q-mb-xs">Your area</h1>
        <div class="text-grey-7">
          Who holds each office where you live, and who is running for it. Write to any of them: the email is filled in for
          you to change as you like, and goes from your own email app. This site does not send it or keep a copy.
        </div>
      </div>

      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!view" class="text-grey-7">Loading…</div>
      <template v-else>
        <div v-if="note">
          <div class="text-grey-7">
            {{ note.text }}
            <router-link v-if="note.link" to="/account">{{ note.link }}</router-link>
          </div>
          <div v-if="view.area.districts.length" class="row q-gutter-xs q-mt-xs" role="list" aria-label="Your districts">
            <q-chip
              v-for="d in view.area.districts"
              :key="districtKey(d)"
              role="listitem"
              dense
              square
              :outline="!mapReady || shown?.geoid !== d.geoid || shown?.kind !== d.kind"
              color="primary"
              :text-color="mapReady && shown?.geoid === d.geoid && shown?.kind === d.kind ? 'white' : undefined"
              icon="place"
              :clickable="onMap(d)"
              :title="DISTRICT_LABELS[d.kind]"
              :aria-pressed="onMap(d) ? shown?.geoid === d.geoid && shown?.kind === d.kind : undefined"
              @click="onMap(d) && (chosen = districtKey(d))"
            >
              {{ d.name }}
            </q-chip>
          </div>
          <div v-if="mapReady && mapped.length > 1" class="text-caption text-grey-7 q-mt-xs">Choose a district, or a pin, to see its lines on the map.</div>
        </div>
        <div v-if="mapped.length" id="area-map">
          <DistrictMap
            optional
            :markers="markers"
            :outline="outline"
            :label="`Map of your districts, showing ${shown?.name ?? 'your area'}`"
            height="320px"
            @ready="mapLoaded = true"
            @select="chosen = $event"
          />
        </div>
        <q-banner v-for="n in feedNotes" :key="n" dense rounded class="bg-grey-3 text-black">{{ n }}</q-banner>
        <div>
          <q-btn flat no-caps color="primary" icon="campaign" label="Party members running in your area" to="/candidates" />
        </div>

        <section v-for="s in sections" :key="`${s.district.kind}:${s.district.geoid}`" class="area-section">
          <h2 class="text-h6 q-my-sm">{{ districtText(s) }}</h2>
          <q-card v-for="g in s.groups" :key="g.office" flat bordered class="q-mb-md">
            <q-card-section class="q-pb-xs row items-center no-wrap">
              <h3 class="text-subtitle1 text-weight-medium q-my-none col">{{ OFFICE_HEADINGS[g.office] }}</h3>
              <q-btn
                v-if="onMap(g.district)"
                flat
                dense
                no-caps
                color="primary"
                icon="map"
                label="On the map"
                :aria-label="`Show ${g.district.name} on the map`"
                @click="showOnMap(g.district)"
              />
            </q-card-section>
            <q-card-section v-if="!g.holders.length && !g.candidates.length" class="text-grey-7 q-pt-none">
              No one is listed for this office yet.
            </q-card-section>
            <template v-for="part in [
              { title: 'In office', people: g.holders },
              { title: 'Running', people: g.candidates },
            ]" :key="part.title">
              <q-list v-if="part.people.length" separator>
                <q-item-label header class="q-py-sm">{{ part.title }}</q-item-label>
                <q-item v-for="c in part.people" :key="c.contactId" class="area-person">
                  <q-item-section>
                    <q-item-label class="text-weight-medium">
                      {{ c.name }}
                      <q-badge v-if="c.incumbent" outline color="primary" class="q-ml-xs">Incumbent</q-badge>
                    </q-item-label>
                    <q-item-label caption>{{ caption(c) }}</q-item-label>
                    <q-item-label v-if="c.role === 'candidate'" caption>{{ running(c) }}</q-item-label>
                    <q-item-label caption class="area-links">
                      <a v-if="c.website" :href="c.website" target="_blank" rel="noopener noreferrer">Website</a>
                      <a v-if="c.contactUrl" :href="c.contactUrl" target="_blank" rel="noopener noreferrer">Contact form</a>
                      <a v-if="c.sourceUrl" :href="c.sourceUrl" target="_blank" rel="noopener noreferrer">Public record</a>
                    </q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-btn unelevated no-caps color="primary" icon="mail" label="Write" :aria-label="`Write to ${c.name}`" @click="write(c)" />
                  </q-item-section>
                </q-item>
              </q-list>
            </template>
          </q-card>
        </section>
      </template>
    </div>

    <q-dialog v-model="open">
      <q-card v-if="writing" class="area-email">
        <q-card-section>
          <h2 class="text-h6 q-my-none">Write to {{ writing.contact.name }}</h2>
          <div class="text-grey-7">{{ writing.contact.officeTitle }} · {{ districtText(writing.contact) }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div v-if="writing.contact.email" class="q-mb-sm">To: {{ writing.contact.email }}</div>
          <q-banner v-else dense rounded class="bg-grey-3 text-black q-mb-sm">
            No email address is listed for {{ writing.contact.name }}.
            <template v-if="writing.contact.contactUrl">Copy the text and paste it into their contact form.</template>
            <template v-else>Copy the text and send it through their website or office.</template>
          </q-banner>
          <q-input v-model="writing.subject" outlined dense label="Subject" class="q-mb-sm" />
          <q-input v-model="writing.body" outlined type="textarea" autogrow label="Email" input-class="area-email-body" />
        </q-card-section>
        <q-card-actions align="left" class="q-px-md q-pb-md">
          <q-btn
            v-if="writing.contact.email"
            unelevated
            no-caps
            color="primary"
            icon="send"
            label="Open in my email app"
            :href="mailtoLink(writing.contact.email, writing.subject, writing.body)"
          />
          <q-btn outline no-caps color="primary" icon="content_copy" label="Copy text" @click="copy" />
          <q-btn
            v-if="writing.contact.contactUrl"
            flat
            no-caps
            color="primary"
            icon="open_in_new"
            label="Open their contact form"
            :href="writing.contact.contactUrl"
            target="_blank"
            rel="noopener noreferrer"
          />
          <q-btn v-close-popup flat no-caps label="Close" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </PageShell>
</template>

<style scoped>
.area-person {
  align-items: flex-start;
}
.area-links a {
  white-space: nowrap;
}
.area-links a + a {
  margin-left: 12px;
}
.area-email {
  width: 640px;
  max-width: 100%;
}
:deep(.area-email-body) {
  min-height: 12em;
}
</style>
