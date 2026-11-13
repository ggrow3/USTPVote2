<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { personPath, type AreaContact, type PersonView } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import ShareButtons from '../communications/ShareButtons.vue';
import PageShell from '../components/PageShell.vue';
import { personPage } from './api.js';
import { CONTACT_SOURCE_TEXT, runningText, websiteText } from './candidacy-text.js';
import DistrictOutline from './DistrictOutline.vue';
import PersonBadges from './PersonBadges.vue';
import PersonProfile from './PersonProfile.vue';
import { capitalized, checkedText, personRoleText, personShareable, raceCrumbs } from './race-text.js';

/**
 * A public-record person's own page (design §5.17), for everyone and listed in search: a member of Congress or a
 * candidate the FEC lists, by their official ID. Who they are and for which seat, as their race's records say, their
 * biography and offices held from Wikipedia and Wikidata, their links, their other part (a member running again), who
 * else is listed for the seat, and share buttons. Nobody here has been reviewed or endorsed by the party.
 */
const route = useRoute();
const view = ref<PersonView | null>(null);
const error = ref<string | null>(null);
const missing = ref(false);
const broken = ref(false);

const p = computed(() => view.value?.person ?? null);
usePageTitle(() => (p.value ? `${p.value.name} · ${p.value.role === 'holder' ? p.value.officeTitle : `Candidate for ${p.value.officeTitle}`}` : 'Races'));
const photo = computed(() => (broken.value ? null : (p.value?.photo ?? null)));
const crumbs = computed(() => {
  const v = view.value;
  if (!v) return [];
  const race = v.race;
  const state = race ? v.person.district.state : null;
  return [...raceCrumbs(state, race && race.code !== state ? race : null), { label: v.person.name, to: route.path }];
});
const caption = computed(() => {
  const c = p.value;
  return c ? [c.party, CONTACT_SOURCE_TEXT[c.source], c.role === 'candidate' ? runningText(c.election) : null].filter(Boolean).join(' · ') : '';
});
const links = computed(() => {
  const c = p.value;
  if (!c) return [];
  return [
    c.website ? { icon: 'language', label: `Website: ${websiteText(c.website)}`, href: c.website } : null,
    c.contactUrl ? { icon: 'contact_mail', label: 'Contact form', href: c.contactUrl } : null,
    c.sourceUrl ? { icon: 'fact_check', label: c.source === 'fec' ? 'FEC filing' : 'Public record', href: c.sourceUrl } : null,
  ].filter((l): l is { icon: string; label: string; href: string } => l !== null);
});
const initials = computed(() =>
  (p.value?.name ?? '')
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .map((w) => w[0]!.toUpperCase())
    .filter((_, i, all) => i === 0 || i === all.length - 1)
    .join(''),
);
const alsoText = computed(() => {
  const v = view.value;
  if (!v?.also) return null;
  return v.person.role === 'holder' ? `Running again in ${v.electionYear}` : 'Holds the seat now';
});
const otherLine = (o: AreaContact) => [o.role === 'holder' ? `Holds it now` : runningText(o.election), o.party].filter(Boolean).join(' · ');
const shareable = computed(() => (view.value ? personShareable(view.value) : null));

watch(
  () => route.params.id as string,
  async (id) => {
    view.value = null;
    error.value = null;
    missing.value = false;
    broken.value = false;
    try {
      view.value = await personPage(id);
    } catch (e) {
      missing.value = e instanceof ApiError && e.status === 404;
      error.value = errorMessage(e);
    }
  },
  { immediate: true },
);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <nav v-if="crumbs.length" aria-label="Breadcrumbs" class="person-crumbs">
        <template v-for="(c, i) in crumbs" :key="c.to">
          <span v-if="i" aria-hidden="true" class="text-grey-6">›</span>
          <router-link v-if="i < crumbs.length - 1" :to="c.to">{{ c.label }}</router-link>
          <span v-else aria-current="page">{{ c.label }}</span>
        </template>
      </nav>
      <div v-else><router-link to="/races">← Every state’s races</router-link></div>

      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>
        {{ missing ? 'The public records list nobody at this address for this election.' : error }}
        <template v-if="missing" #action><q-btn flat no-caps color="primary" label="Every state’s races" to="/races" /></template>
      </q-banner>
      <div v-else-if="!view || !p" class="text-grey-7">Loading…</div>
      <template v-else>
        <q-card flat bordered>
          <q-card-section class="person-page__head">
            <q-avatar size="112px" rounded class="person-page__photo">
              <img v-if="photo" :src="photo.url" :alt="`Photo of ${p.name}`" referrerpolicy="no-referrer" @error="broken = true" />
              <span v-else aria-hidden="true">{{ initials }}</span>
            </q-avatar>
            <div class="person-page__who">
              <h1 class="text-h5 q-my-none">
                {{ p.name }}
                <PersonBadges :marks="{ party: false, representative: false }" :incumbent="p.incumbent" />
              </h1>
              <div class="q-mt-xs">{{ personRoleText(view) }}</div>
              <div class="text-grey-7">{{ caption }}</div>
              <div v-if="alsoText && view.also" class="q-mt-xs">
                <router-link v-if="personPath(view.also.contactId)" :to="personPath(view.also.contactId)!">{{ alsoText }}</router-link>
                <template v-else>{{ alsoText }}</template>
              </div>
              <div v-if="links.length" class="person-page__links q-mt-sm">
                <q-btn
                  v-for="l in links"
                  :key="l.icon"
                  flat
                  dense
                  no-caps
                  color="primary"
                  :icon="l.icon"
                  :label="l.label"
                  :href="l.href"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              </div>
            </div>
            <div v-if="p.district.kind !== 'nation'" class="person-page__outline">
              <DistrictOutline :district="p.district" :size="120" />
              <div class="text-caption text-grey-7 text-center">{{ capitalized(view.race?.seat ?? p.district.name) }}</div>
            </div>
          </q-card-section>
          <q-card-section v-if="p.profile" class="q-pt-none">
            <PersonProfile :person="{ name: p.name, photo, profile: p.profile }" />
          </q-card-section>
        </q-card>

        <div v-if="shareable">
          <div class="text-caption text-grey-7 q-mb-xs">Share this page</div>
          <ShareButtons :item="shareable" />
        </div>

        <section v-if="view.others.length" aria-labelledby="person-others-heading">
          <h2 id="person-others-heading" class="text-h6 q-mb-xs">Also listed for {{ p.officeTitle }}, {{ view.race?.seat ?? 'the United States' }}</h2>
          <q-list bordered separator class="rounded-borders">
            <q-item v-for="o in view.others" :key="o.contactId" :clickable="!!personPath(o.contactId)" :to="personPath(o.contactId) ?? undefined">
              <q-item-section>
                <q-item-label>{{ o.name }} <PersonBadges :marks="{ party: false, representative: false }" :incumbent="o.incumbent" /></q-item-label>
                <q-item-label caption>{{ otherLine(o) }}</q-item-label>
              </q-item-section>
              <q-item-section v-if="personPath(o.contactId)" side><q-icon name="chevron_right" /></q-item-section>
            </q-item>
          </q-list>
        </section>

        <div class="text-caption text-grey-7">
          From public records{{ p.source === 'fec' ? ': the FEC’s list of candidates who have filed and reported raising money' : ': the congress-legislators project’s list of members of Congress' }}.
          Not reviewed or endorsed by the Transhumanist Party. Records read {{ checkedText(view.checkedAt) }}, once a day.
          <router-link v-if="view.race" :to="view.race.path">{{ view.race.title }}</router-link>
        </div>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.person-crumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.person-page__head {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.person-page__who {
  flex: 1;
  min-width: 220px;
}
.person-page__photo {
  background: rgba(127, 127, 127, 0.18);
  font-size: 36px;
  font-weight: 500;
}
.person-page__photo img {
  object-fit: cover;
}
.person-page__links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}
.person-page__outline {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 160px;
}
</style>
