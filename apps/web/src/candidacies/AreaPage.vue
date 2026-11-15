<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  CONTACT_FEEDS,
  areaSections,
  candidateName,
  contactDistricts,
  countryName,
  countryOf,
  DEFAULT_COUNTRY,
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
import { areaContacts, publicCandidacies, zipAreaContacts } from './api.js';
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
 * Your area (design §5.12): for a signed-in member in their own area, and for anyone in the area of a ZIP code they
 * type (kept in the page only: never in the address or the browser's storage), the people there in three groups (§5.8): the Transhumanist
 * Party's candidates there; their representatives, who holds each office now; and everyone else running, from public
 * records and from the party's communications team. Each representative and other candidate has an email the member
 * can edit and send from their own email app: they pick one of the templates that suit the person, which the page fills
 * in. The site sends nothing and keeps no copy. Each office has the outline of its district; where the map is set up,
 * it shows a pin in each of their districts, with the people of each group there, and the outline of the one they
 * choose (or their state). People Wikidata knows have their biography and experience; the ballot's other contests are
 * listed at the end.
 */
usePageTitle('Your area');
/** The member's own area; null until loaded, and for a visitor or a member with no US area on record. */
const own = ref<AreaContactsView | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
/** A ZIP code someone typed, and its area. */
const zipInput = ref('');
const typed = ref<{ readonly zip: string; readonly view: AreaContactsView } | null>(null);
const zipError = ref<string | null>(null);
const zipPending = ref(false);
/** What the page shows: the typed ZIP code's area, else the member's own. */
const view = computed(() => typed.value?.view ?? own.value);
/** Members' approved candidacies, of which the area's are the party's candidates there. */
const candidacies = ref<PublicCandidacy[] | null>(null);
const candidaciesError = ref<string | null>(null);
const today = localToday();
/** A member living outside the United States has no US area: the country, to say so instead (design §5.12). */
const abroad = computed(() => {
  const member = session.me?.member;
  return member && countryOf(member) !== DEFAULT_COUNTRY ? countryName(countryOf(member)) : null;
});

onMounted(() =>
  publicCandidacies().then(
    (list) => (candidacies.value = list),
    (e) => (candidaciesError.value = errorMessage(e)),
  ),
);

// A member's own area, once the session knows who they are; a visitor types a ZIP code instead.
watch(
  () => (abroad.value ? null : (session.me?.member?.accountId ?? null)),
  async (accountId) => {
    own.value = null;
    error.value = null;
    if (!accountId) return;
    loading.value = true;
    try {
      const found = await areaContacts();
      if ((session.me?.member?.accountId ?? null) === accountId) own.value = found;
    } catch (e) {
      error.value = errorMessage(e);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

/** Looks up the area of the typed ZIP code, and shows it. */
async function lookUp() {
  const zip = zipInput.value.trim();
  if (!/^[0-9]{5}$/.test(zip)) {
    zipError.value = 'Enter a five-digit ZIP code.';
    return;
  }
  zipError.value = null;
  zipPending.value = true;
  try {
    typed.value = { zip, view: await zipAreaContacts(zip) };
  } catch (e) {
    zipError.value = errorMessage(e);
  } finally {
    zipPending.value = false;
  }
}

/** "in your area", or "in ZIP code 92130" for a typed one. */
const whereText = computed(() => (typed.value ? `in ZIP code ${typed.value.zip}` : 'in your area'));
const note = computed(() => (view.value ? areaText(view.value.area, typed.value?.zip ?? null) : null));
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
// Another area has other districts.
watch(view, () => (chosen.value = null));
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
  // A visitor fills in their own name.
  const values = placeholderValues(contact, districtText(contact), me ? candidateName(me) : '[your name]');
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
          The Transhumanist Party’s candidates where you live, your representatives, and everyone else running there, with
          their websites, contact forms and official social media accounts. Write to any of your representatives or the
          other candidates: the email is filled in for you to change as you like, and goes from your own email app. This
          site does not send it or keep a copy.
        </div>
      </div>

      <q-card flat bordered>
        <q-card-section>
          <div v-if="abroad" class="text-grey-7 q-mb-sm">
            Your membership record says you live in {{ abroad }}, so there are no US offices to list for you. Type any US
            ZIP code to see its area. If you have moved, change where you live on your
            <router-link to="/account">Account page</router-link>.
          </div>
          <div v-else-if="!session.user" class="text-grey-7 q-mb-sm">
            Type your ZIP code to see your area. It is used once to find your districts and is not kept.
            <router-link to="/signin">Sign in</router-link> as a member and this page opens on your own area.
          </div>
          <div v-else-if="typed && own" class="q-mb-sm">
            Showing ZIP code {{ typed.zip }}.
            <q-btn flat dense no-caps color="primary" label="Back to my own area" @click="typed = null" />
          </div>
          <div v-else-if="own" class="text-grey-7 q-mb-sm">Showing your own area, from your membership record. To see another, type its ZIP code.</div>
          <div v-else-if="!loading" class="text-grey-7 q-mb-sm">Type a ZIP code to see its area.</div>
          <form class="row items-start no-wrap q-gutter-x-sm" @submit.prevent="lookUp">
            <q-input
              v-model="zipInput"
              outlined
              dense
              label="ZIP code"
              inputmode="numeric"
              autocomplete="postal-code"
              maxlength="5"
              :error="zipError !== null"
              :error-message="zipError ?? undefined"
              hide-bottom-space
              class="area-zip__input"
            />
            <q-btn type="submit" :outline="!!own" :unelevated="!own" no-caps color="primary" label="Show this area" :loading="zipPending" />
          </form>
        </q-card-section>
      </q-card>

      <q-banner v-if="error && !typed" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="loading && !view" class="text-grey-7">Loading…</div>
      <template v-if="view">
        <div v-if="note">
          <div class="text-grey-7">
            {{ note.text }}
            <router-link v-if="note.link" to="/account">{{ note.link }}</router-link>
          </div>
          <div v-if="view.area.districts.length" class="row q-gutter-xs q-mt-xs" role="list" :aria-label="typed ? 'The districts there' : 'Your districts'">
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
          <h2 id="area-party-heading" class="text-h6 q-my-sm">Transhumanist Party candidates {{ whereText }}</h2>
          <div class="text-grey-7 q-mb-sm">
            Members of the party running for office here, in their own words. A Membership Admin reviews each candidacy
            before it appears; being listed is not an endorsement.
          </div>
          <q-banner v-if="candidaciesError" class="bg-orange-1 text-black" rounded>{{ candidaciesError }}</q-banner>
          <div v-else-if="!candidacies" class="text-grey-7">Loading…</div>
          <PartyCandidates v-else-if="sections.party.length" :candidacies="sections.party" :holders="sections.holders" />
          <div v-else class="text-grey-7">No Transhumanist Party candidates {{ whereText }} yet.</div>
          <q-btn flat no-caps color="primary" icon="campaign" label="All of the party’s candidates" to="/candidates" class="q-mt-xs" />
        </section>

        <section v-if="sections" aria-labelledby="area-representatives-heading">
          <h2 id="area-representatives-heading" class="text-h6 q-my-sm">{{ typed ? `Representatives ${whereText}` : 'Your representatives' }}</h2>
          <div class="text-grey-7 q-mb-sm">Who holds each office {{ typed ? 'there' : 'where you vote' }}, now.</div>
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
          <h2 id="area-running-heading" class="text-h6 q-my-sm">Others running {{ whereText }}</h2>
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
.area-zip__input {
  width: 9em;
}
.area-email {
  width: 640px;
  max-width: 100%;
}
:deep(.area-email-body) {
  min-height: 12em;
}
</style>
