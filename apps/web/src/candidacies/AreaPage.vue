<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CONTACT_FEEDS,
  areaSections,
  candidateName,
  contactDistricts,
  fillTemplate,
  personMarks,
  placeholderValues,
  templatesFor,
  type AreaContact,
  type AreaContactsView,
  type ContactDistrict,
  type EmailTemplate,
  type PublicCandidacy,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { confirmAction } from '../communications/admin-forms.js';
import { attempt } from '../dialogs.js';
import { session } from '../session.js';
import { areaContacts, publicCandidacies } from './api.js';
import BallotContests from './BallotContests.vue';
import {
  areaText,
  BLANK_EMAIL,
  CIVIC_CREDIT,
  DISTRICT_LABELS,
  districtPeopleText,
  districtText,
  feedNote,
  localToday,
  recordsCredit,
  mailtoLink,
  profilesNote,
} from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';
import { mapsRefused } from './maps.js';
import OfficeGrid from './OfficeGrid.vue';
import PartyCandidates from './PartyCandidates.vue';

/**
 * Your area (design §5.12): for a signed-in member, the people where they live in three groups (§5.8): the Transhumanist
 * Party's candidates there; their representatives, who holds each office now; and everyone else running, from public
 * records and from the party's communications team. Each representative and other candidate has an email the member
 * can edit and send from their own email app: they pick one of the templates that suit the person, which the page fills
 * in. The site sends nothing and keeps no copy. Each office has the outline of its district; where the map is set up,
 * it shows a pin in each of their districts, with the people of each group there, and the outline of the one they
 * choose (or their state). People Wikidata knows have their biography and experience; the ballot's other contests are
 * listed at the end.
 */
usePageTitle('Your area');
const view = ref<AreaContactsView | null>(null);
const error = ref<string | null>(null);
/** Members' approved candidacies, of which the area's are the party's candidates there. */
const candidacies = ref<PublicCandidacy[] | null>(null);
const candidaciesError = ref<string | null>(null);
const today = localToday();

onMounted(async () => {
  const listed = publicCandidacies().then(
    (list) => (candidacies.value = list),
    (e) => (candidaciesError.value = errorMessage(e)),
  );
  try {
    view.value = await areaContacts();
  } catch (e) {
    error.value = errorMessage(e);
  }
  await listed;
});

const note = computed(() => (view.value ? areaText(view.value.area) : null));
const feedNotes = computed(() =>
  view.value
    ? [...CONTACT_FEEDS.map((f) => feedNote(f, view.value!.feeds[f])), profilesNote(view.value.profiles)].filter((n): n is string => n !== null)
    : [],
);
/** Google's wording, wherever the ballot added someone. */
const fromBallot = computed(() => !!view.value && (view.value.contacts.some((c) => c.source === 'civic') || view.value.ballot.length > 0));

/** The party's candidates, the member's representatives and the others running, each office with its people. */
const sections = computed(() => (view.value ? areaSections(view.value.area, view.value.contacts, candidacies.value ?? [], today) : null));
const marks = (p: AreaContact) => personMarks(p, sections.value?.holders ?? [], sections.value?.party ?? []);

// The map: a pin per district with a point, and the chosen district's outline (the first, until one is chosen); an
// office of the whole state outlines the state.
const districtKey = (d: Pick<ContactDistrict, 'kind' | 'geoid'>) => `${d.kind}:${d.geoid}`;
const mapLoaded = ref(false);
/** Google can refuse the key after the map has loaded; then the page shows no map. */
const mapReady = computed(() => mapLoaded.value && !mapsRefused.value);
const chosen = ref<string | null>(null);
const mapped = computed(() => (view.value?.area.districts ?? []).filter((d) => d.point));
/** The member's state, as its offices' cards name it. */
const stateDistrict = computed(() => (view.value ? (contactDistricts(view.value.area).find((d) => d.kind === 'state') ?? null) : null));
const shown = computed<ContactDistrict | null>(
  () =>
    mapped.value.find((d) => districtKey(d) === chosen.value) ??
    (stateDistrict.value && districtKey(stateDistrict.value) === chosen.value ? stateDistrict.value : null) ??
    mapped.value[0] ??
    null,
);
const markers = computed<MapMarker[]>(() => {
  const s = sections.value;
  if (!s) return [];
  const people = { party: s.party, holders: s.holders, others: s.running.flatMap((g) => g.candidates) };
  return mapped.value.map((d) => ({ id: districtKey(d), point: d.point!, title: d.name, caption: districtPeopleText(people, d) }));
});
const outline = computed(() => (shown.value ? { kind: shown.value.kind, geoid: shown.value.geoid } : null));
const onMap = (d: Pick<ContactDistrict, 'kind' | 'geoid'>) => mapReady.value && (d.kind === 'state' || mapped.value.some((m) => districtKey(m) === districtKey(d)));

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
          The Transhumanist Party’s candidates where you live, your representatives, and everyone else running there. Write
          to any of your representatives or the other candidates: the email is filled in for you to change as you like,
          and goes from your own email app. This site does not send it or keep a copy.
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
            :label="`Map of your districts, showing ${shown ? districtText({ district: shown }) : 'your area'}`"
            height="320px"
            @ready="mapLoaded = true"
            @select="chosen = $event"
          />
        </div>
        <q-banner v-for="n in feedNotes" :key="n" dense rounded class="bg-grey-3 text-black">{{ n }}</q-banner>
        <section v-if="sections" aria-labelledby="area-party-heading">
          <h2 id="area-party-heading" class="text-h6 q-my-sm">Transhumanist Party candidates in your area</h2>
          <div class="text-grey-7 q-mb-sm">
            Members of the party running for office here, in their own words. A Membership Admin reviews each candidacy
            before it appears; being listed is not an endorsement.
          </div>
          <q-banner v-if="candidaciesError" class="bg-orange-1 text-black" rounded>{{ candidaciesError }}</q-banner>
          <div v-else-if="!candidacies" class="text-grey-7">Loading…</div>
          <PartyCandidates v-else-if="sections.party.length" :candidacies="sections.party" :holders="sections.holders" />
          <div v-else class="text-grey-7">No Transhumanist Party candidates in your area yet.</div>
          <q-btn flat no-caps color="primary" icon="campaign" label="All of the party’s candidates" to="/candidates" class="q-mt-xs" />
        </section>

        <section v-if="sections" aria-labelledby="area-representatives-heading">
          <h2 id="area-representatives-heading" class="text-h6 q-my-sm">Your representatives</h2>
          <div class="text-grey-7 q-mb-sm">Who holds each office where you vote, now.</div>
          <OfficeGrid
            :groups="sections.representatives"
            part="holders"
            every
            :election-year="view.electionYear"
            :not-up="view.notUp"
            :marks="marks"
            :mappable="onMap"
            @map="showOnMap"
          >
            <template #person="{ person }">
              <q-item-section side top>
                <q-btn outline dense no-caps size="sm" color="primary" icon="mail" label="Write" :aria-label="`Write to ${person.name}`" @click="write(person)" />
              </q-item-section>
            </template>
          </OfficeGrid>
        </section>

        <section v-if="sections" aria-labelledby="area-running-heading">
          <h2 id="area-running-heading" class="text-h6 q-my-sm">Others running in your area</h2>
          <div class="text-grey-7 q-mb-sm">
            Everyone else running for these offices, from public records and the party’s communications team. None of
            them has been reviewed or endorsed by the party.
          </div>
          <OfficeGrid
            :groups="sections.running"
            part="candidates"
            :every="false"
            :election-year="view.electionYear"
            :not-up="view.notUp"
            :marks="marks"
            :mappable="onMap"
            @map="showOnMap"
          >
            <template #person="{ person }">
              <q-item-section side top>
                <q-btn outline dense no-caps size="sm" color="primary" icon="mail" label="Write" :aria-label="`Write to ${person.name}`" @click="write(person)" />
              </q-item-section>
            </template>
          </OfficeGrid>
        </section>
        <BallotContests :contests="view.ballot" />
        <div class="text-caption text-grey-7">
          {{ recordsCredit(true, view.feeds.sos === 'ok') }}
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
