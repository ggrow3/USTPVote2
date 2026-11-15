<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CONTACT_FEEDS,
  candidateName,
  countryName,
  countryOf,
  DEFAULT_COUNTRY,
  groupAreaContacts,
  NETWORK_NAMES,
  type AreaContact,
  type AreaOfficeGroup,
  type PublicOffice,
  type RepresentativesView,
} from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { session } from '../session.js';
import { myRepresentatives, zipRepresentatives } from './api.js';
import CallDialog from './CallDialog.vue';
import { feedNote, OFFICE_HEADINGS, profilesNote, representativesAreaText } from './candidacy-text.js';
import RepresentativeCard from './RepresentativeCard.vue';
import WriteDialog from './WriteDialog.vue';

/**
 * Your representatives (design §5.19): who holds each office where someone lives, now, and every way to reach them
 * the records give: an email filled in from a template, a phone call with a script to read out, their contact form,
 * website and official accounts. A signed-in member sees their own area, from their membership record; anyone can
 * type a ZIP code instead, which stays in the page: never in the address or the browser's storage, and the api keeps
 * neither it nor who asked. The site sends no email and places no call.
 */
usePageTitle('Your representatives');

/** The member's own area's representatives; null until loaded, or for someone with no US area on record. */
const own = ref<RepresentativesView | null>(null);
const ownError = ref<string | null>(null);
const ownPending = ref(false);
/** A ZIP code someone typed, and who represents it. */
const zipInput = ref('');
const typed = ref<{ readonly zip: string; readonly view: RepresentativesView } | null>(null);
const zipError = ref<string | null>(null);
const zipPending = ref(false);

const member = computed(() => session.me?.member ?? null);
/** A member living outside the United States has no US area: the country, to say so instead. */
const abroad = computed(() => (member.value && countryOf(member.value) !== DEFAULT_COUNTRY ? countryName(countryOf(member.value)) : null));

watch(
  () => (abroad.value ? null : (member.value?.accountId ?? null)),
  async (accountId) => {
    own.value = null;
    ownError.value = null;
    if (!accountId) return;
    ownPending.value = true;
    try {
      const found = await myRepresentatives();
      if ((member.value?.accountId ?? null) === accountId) own.value = found;
    } catch (e) {
      ownError.value = errorMessage(e);
    } finally {
      ownPending.value = false;
    }
  },
  { immediate: true },
);

async function lookUp() {
  const zip = zipInput.value.trim();
  if (!/^[0-9]{5}$/.test(zip)) {
    zipError.value = 'Enter a five-digit ZIP code.';
    return;
  }
  zipError.value = null;
  zipPending.value = true;
  try {
    typed.value = { zip, view: await zipRepresentatives(zip) };
  } catch (e) {
    zipError.value = errorMessage(e);
  } finally {
    zipPending.value = false;
  }
}

/** What the page shows: the typed ZIP code's representatives, else the member's own. */
const view = computed(() => typed.value?.view ?? own.value);
const note = computed(() => (view.value ? representativesAreaText(view.value.area, typed.value?.zip ?? null) : null));
const feedNotes = computed(() => {
  const v = view.value;
  if (!v) return [];
  // Only the records of people in office are asked here.
  return [...CONTACT_FEEDS.filter((f) => f === 'congress' || f === 'openstates').map((f) => feedNote(f, v.feeds[f])), profilesNote(v.profiles)].filter(
    (n): n is string => n !== null,
  );
});

const LEVELS: readonly { readonly id: string; readonly heading: string; readonly offices: readonly PublicOffice[]; readonly empty: string }[] = [
  { id: 'federal', heading: 'In Congress', offices: ['us_president', 'us_senate', 'us_house'], empty: 'Nobody is listed.' },
  { id: 'state', heading: 'In your state', offices: ['statewide', 'state_upper', 'state_lower'], empty: 'Nobody is listed yet.' },
  {
    id: 'local',
    heading: 'In your county and city',
    offices: ['county', 'local'],
    empty: 'Nobody is listed yet: no public record this site reads covers these offices, so the party’s communications team adds them.',
  },
];

/** Each level with its offices; the presidency only when someone is listed for it. */
const levels = computed(() => {
  const v = view.value;
  if (!v) return [];
  const groups = groupAreaContacts(v.area, v.representatives).filter((g) => g.office !== 'us_president' || g.holders.length > 0);
  return LEVELS.map((level) => ({ ...level, groups: groups.filter((g) => level.offices.includes(g.office)) })).filter((level) => level.groups.length > 0);
});

const groupKey = (g: AreaOfficeGroup) => `${g.office}:${g.district.kind}:${g.district.geoid}`;
const groupHeading = (g: AreaOfficeGroup) =>
  g.district.kind === 'nation' || g.district.kind === 'state' ? OFFICE_HEADINGS[g.office] : `${OFFICE_HEADINGS[g.office]} · ${g.district.name}`;

/** The name the emails and scripts are signed with: the member's, or a gap for a visitor to fill. */
const myName = computed(() => (member.value ? candidateName(member.value) : '[your name]'));
const templates = computed(() => view.value?.templates ?? []);

const writingTo = ref<AreaContact | null>(null);
const calling = ref<AreaContact | null>(null);
const networks = computed(() => [...new Set((view.value?.representatives ?? []).flatMap((p) => (p.social ?? []).map((s) => NETWORK_NAMES[s.network])))]);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div>
        <h1 class="text-h5 q-mb-xs">Your representatives</h1>
        <div class="text-grey-7">
          Who represents you now, in Congress, in your state and where you live, and how to reach them: write an email
          from a template, call their office with a short script to read out, or use their contact form, website or
          official accounts. The email goes from your own email app and the call from your own phone. This site sends
          nothing and keeps no record of who you contact.
        </div>
      </div>

      <q-card flat bordered>
        <q-card-section>
          <div v-if="abroad" class="text-grey-7 q-mb-sm">
            Your membership record says you live in {{ abroad }}, so you have no US representatives on record. Type any US
            ZIP code to see who represents the people there.
          </div>
          <div v-else-if="!session.user" class="text-grey-7 q-mb-sm">
            Type your ZIP code to see who represents you. It is used once to find your districts and is not kept.
            <router-link to="/signin">Sign in</router-link> as a member to open this page on your own area.
          </div>
          <div v-else-if="typed && own" class="q-mb-sm">
            Showing ZIP code {{ typed.zip }}.
            <q-btn flat dense no-caps color="primary" label="Back to my own area" @click="typed = null" />
          </div>
          <div v-else-if="own" class="text-grey-7 q-mb-sm">Showing your own area, from your membership record. To see another, type its ZIP code.</div>
          <div v-else-if="!ownPending" class="text-grey-7 q-mb-sm">Type a ZIP code to see who represents the people there.</div>
          <form class="row items-start no-wrap q-gutter-x-sm representatives-zip" @submit.prevent="lookUp">
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
              class="representatives-zip__input"
            />
            <q-btn type="submit" :outline="!!own" :unelevated="!own" no-caps color="primary" label="Find representatives" :loading="zipPending" />
          </form>
        </q-card-section>
      </q-card>

      <q-banner v-if="ownError && !typed" class="bg-orange-1 text-black" rounded>{{ ownError }}</q-banner>
      <div v-if="ownPending && !view" class="text-grey-7">Loading…</div>

      <template v-if="view">
        <div v-if="note" class="text-grey-7">
          {{ note.text }}
          <router-link v-if="note.link" to="/account">{{ note.link }}</router-link>
        </div>
        <q-banner v-for="n in feedNotes" :key="n" dense rounded class="bg-grey-3 text-black">{{ n }}</q-banner>

        <section v-for="level in levels" :key="level.id" :aria-labelledby="`representatives-${level.id}`">
          <h2 :id="`representatives-${level.id}`" class="text-h6 q-my-sm">{{ level.heading }}</h2>
          <div v-for="g in level.groups" :key="groupKey(g)" class="q-mb-md">
            <h3 class="text-subtitle1 text-weight-medium q-my-xs">{{ groupHeading(g) }}</h3>
            <div v-if="g.holders.length" class="representatives-grid">
              <RepresentativeCard
                v-for="p in g.holders"
                :key="p.contactId"
                :person="p"
                @write="writingTo = p"
                @call="calling = p"
              />
            </div>
            <div v-else class="text-grey-7">{{ level.empty }}</div>
          </div>
        </section>

        <div class="row q-gutter-sm">
          <q-btn v-if="session.user && !typed" flat no-caps color="primary" icon="how_to_vote" label="Your area: who is running for these offices" to="/candidates/area" />
          <q-btn v-else flat no-caps color="primary" icon="campaign" label="Who is running where you live" to="/candidates" />
          <q-btn flat no-caps color="primary" icon="fact_check" label="How Congress voted on the bills the party follows" to="/scorecard" />
        </div>
        <div class="text-caption text-grey-7">
          Members of Congress, their phone numbers and their official accounts<template v-if="networks.length"> ({{ networks.join(', ') }})</template>
          from the congress-legislators project; state legislators from Open States; biographies from Wikipedia and Wikidata.
          County and city officials, and anyone else marked so, are added by the party’s communications team. Being listed
          here is not an endorsement.
        </div>
      </template>
    </div>

    <WriteDialog v-model="writingTo" :templates="templates" :my-name="myName" />
    <CallDialog v-model="calling" :templates="templates" :my-name="myName" />
  </PageShell>
</template>

<style scoped>
.representatives-zip__input {
  width: 9em;
}
.representatives-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
  gap: 12px;
}
</style>
