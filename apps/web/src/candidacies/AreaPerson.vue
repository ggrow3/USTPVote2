<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AreaContact } from 'ustp-domain';
import { CONTACT_SOURCE_TEXT, electionDay } from './candidacy-text.js';
import PersonProfile from './PersonProfile.vue';

/**
 * One person on the Candidates or Your area page (design §5.12): their photo where the records have one, the office,
 * party and source, the election they run in, links to their site and public record, and their profile. The default
 * slot takes the item's side, such as the Your area page's Write button.
 */
const props = defineProps<{
  person: AreaContact;
  /** Link the person's email address too (the Your area page writes to it instead). */
  showEmail?: boolean;
}>();

/** A photo that does not load (a campaign's link can break) is left out, with its credit. */
const broken = ref(false);
const shown = computed(() => (broken.value ? { ...props.person, photo: null } : props.person));
const caption = computed(() => [props.person.officeTitle, props.person.party, CONTACT_SOURCE_TEXT[props.person.source]].filter(Boolean).join(' · '));
const running = computed(() => {
  const e = props.person.election;
  return e && /^\d{4}-\d{2}-\d{2}$/.test(e) ? `Election ${electionDay(e)}` : `Running in ${e ?? 'the next election'}`;
});
</script>

<template>
  <q-item class="area-person">
    <q-item-section v-if="shown.photo" avatar top>
      <q-avatar size="56px" rounded>
        <img :src="shown.photo.url" :alt="`Photo of ${person.name}`" referrerpolicy="no-referrer" loading="lazy" @error="broken = true" />
      </q-avatar>
    </q-item-section>
    <q-item-section>
      <q-item-label class="text-weight-medium">
        {{ person.name }}
        <q-badge v-if="person.incumbent" outline color="primary" class="q-ml-xs">Incumbent</q-badge>
      </q-item-label>
      <q-item-label caption>{{ caption }}</q-item-label>
      <q-item-label v-if="person.role === 'candidate'" caption>{{ running }}</q-item-label>
      <q-item-label caption class="area-person__links">
        <a v-if="person.website" :href="person.website" target="_blank" rel="noopener noreferrer">Website</a>
        <a v-if="showEmail && person.email" :href="`mailto:${person.email}`">Email</a>
        <a v-if="person.contactUrl" :href="person.contactUrl" target="_blank" rel="noopener noreferrer">Contact form</a>
        <a v-if="person.sourceUrl" :href="person.sourceUrl" target="_blank" rel="noopener noreferrer">Public record</a>
      </q-item-label>
      <PersonProfile :person="shown" />
    </q-item-section>
    <slot />
  </q-item>
</template>

<style scoped>
.area-person {
  align-items: flex-start;
}
.area-person__links a {
  white-space: nowrap;
}
.area-person__links a + a {
  margin-left: 12px;
}
</style>
