<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CONTACT_FEEDS,
  candidateName,
  contactDistricts,
  fillTemplate,
  groupAreaContacts,
  placeholderValues,
  templatesFor,
  type AreaContact,
  type AreaContactsView,
  type ContactDistrict,
  type EmailTemplate,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { confirmAction } from '../communications/admin-forms.js';
import { attempt } from '../dialogs.js';
import { session } from '../session.js';
import { areaContacts } from './api.js';
import AreaPerson from './AreaPerson.vue';
import BallotContests from './BallotContests.vue';
import {
  areaText,
  BLANK_EMAIL,
  CIVIC_CREDIT,
  DISTRICT_LABELS,
  districtPeopleText,
  districtText,
  feedNote,
  mailtoLink,
  OFFICE_HEADINGS,
  profilesNote,
} from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';
import { mapsRefused } from './maps.js';

/**
 * Your area (design §5.12): for a signed-in member, who holds each office where they live and who is running for it,
 * from public records and from the party's communications team, each with an email the member can edit and send from
 * their own email app: they pick one of the templates that suit the person, which the page fills in. The site sends
 * nothing and keeps no copy. Where the map is set up, it shows a pin in each of their districts, with who is in office
 * and running there, and the outline of the one they choose. People Wikidata knows have their biography and experience;
 * the ballot's other contests are listed at the end.
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
const feedNotes = computed(() =>
  view.value
    ? [...CONTACT_FEEDS.map((f) => feedNote(f, view.value!.feeds[f])), profilesNote(view.value.profiles)].filter((n): n is string => n !== null)
    : [],
);
/** Google's wording, wherever the ballot added someone. */
const fromBallot = computed(() => !!view.value && (view.value.contacts.some((c) => c.source === 'civic') || view.value.ballot.length > 0));

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

/** The template list's choice that starts from a blank email: no template ID is empty. */
const BLANK = '';

/**
 * The email being written: to whom, the templates that suit them, the one chosen, the text as it filled in, and the
 * text as the member has edited it.
 */
const writing = ref<{
  contact: AreaContact;
  offered: EmailTemplate[];
  templateId: string;
  filled: { subject: string; body: string };
  subject: string;
  body: string;
} | null>(null);
const open = computed({
  get: () => writing.value !== null,
  set: (v) => {
    if (!v) writing.value = null;
  },
});

const templateOptions = computed(() => [
  ...(writing.value?.offered ?? []).map((t) => ({ value: t.templateId, label: t.name })),
  { value: BLANK, label: 'Blank email' },
]);

/** The text of a template (or the blank email) filled in for the person. */
function filledFor(contact: AreaContact, template: Pick<EmailTemplate, 'subject' | 'body'>) {
  const me = session.me?.member;
  const values = placeholderValues(contact, districtText(contact), me ? candidateName(me) : '');
  return { subject: fillTemplate(template.subject, values), body: fillTemplate(template.body, values) };
}

function write(contact: AreaContact) {
  const offered = templatesFor(view.value!.templates, contact);
  const first = offered[0];
  const filled = filledFor(contact, first ?? BLANK_EMAIL);
  writing.value = { contact, offered, templateId: first?.templateId ?? BLANK, filled, ...filled };
}

/** Fills in another template; text the member changed is replaced only once they say so. */
async function choose(templateId: string) {
  const w = writing.value;
  if (!w || templateId === w.templateId) return;
  const edited = w.subject !== w.filled.subject || w.body !== w.filled.body;
  if (edited && !(await confirmAction('Replace your changes?', 'The email you changed is replaced by the template you chose.', 'Replace'))) return;
  const filled = filledFor(w.contact, w.offered.find((t) => t.templateId === templateId) ?? BLANK_EMAIL);
  writing.value = { ...w, templateId, filled, ...filled };
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
                <AreaPerson v-for="c in part.people" :key="c.contactId" :person="c">
                  <q-item-section side top>
                    <q-btn unelevated no-caps color="primary" icon="mail" label="Write" :aria-label="`Write to ${c.name}`" @click="write(c)" />
                  </q-item-section>
                </AreaPerson>
              </q-list>
            </template>
          </q-card>
        </section>
        <BallotContests :contests="view.ballot" />
        <div class="text-caption text-grey-7">
          Candidates for Congress and President from the FEC; members of Congress from the congress-legislators project;
          biographies from Wikipedia and Wikidata, by FEC and Congress ID.
          <a v-if="fromBallot" :href="CIVIC_CREDIT.url" target="_blank" rel="noopener noreferrer">{{ CIVIC_CREDIT.text }}</a>
        </div>
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
          <q-select
            :model-value="writing.templateId"
            outlined
            dense
            emit-value
            map-options
            :options="templateOptions"
            label="Template"
            class="q-mb-sm"
            @update:model-value="choose"
          />
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
.area-email {
  width: 640px;
  max-width: 100%;
}
:deep(.area-email-body) {
  min-height: 12em;
}
</style>
