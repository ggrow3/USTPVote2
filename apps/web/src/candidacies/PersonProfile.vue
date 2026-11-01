<script setup lang="ts">
import { positionText, WIKIPEDIA_LICENCE, type AreaContact } from 'ustp-domain';

/**
 * What public records say about a person on the Candidates or Your area page (design §5.12), as their *About* unfolds
 * it: the start of their Wikipedia article, the offices they have held, where they studied and their work, from
 * Wikidata, and who to credit for their photo. Wikipedia's text is credited and licensed as CC BY-SA 4.0 asks.
 */
defineProps<{ person: Pick<AreaContact, 'name' | 'photo'> & { readonly profile: NonNullable<AreaContact['profile']> } }>();
</script>

<template>
  <div class="person-profile">
    <p v-if="person.profile.summary" class="q-mb-xs">{{ person.profile.summary }}</p>
    <div v-if="person.profile.summary" class="text-caption text-grey-7 q-mb-sm">
      From
      <a :href="person.profile.articleUrl ?? person.profile.wikidataUrl" target="_blank" rel="noopener noreferrer">Wikipedia</a>,
      under <a :href="WIKIPEDIA_LICENCE.url" target="_blank" rel="noopener noreferrer">{{ WIKIPEDIA_LICENCE.name }}</a>.
    </div>
    <template v-if="person.profile.positions.length">
      <div class="text-weight-medium">Offices held</div>
      <ul class="q-my-xs">
        <li v-for="p in person.profile.positions" :key="`${p.title}|${p.place}|${p.start}`">{{ positionText(p) }}</li>
      </ul>
    </template>
    <div v-if="person.profile.education.length">Studied at {{ person.profile.education.join(', ') }}</div>
    <div v-if="person.profile.occupations.length">Work: {{ person.profile.occupations.join(', ') }}</div>
    <div class="text-caption text-grey-7 q-mt-xs">
      Offices, study and work from
      <a :href="person.profile.wikidataUrl" target="_blank" rel="noopener noreferrer">Wikidata</a>, as its editors wrote them; the party has not
      checked them.
      <template v-if="person.photo">
        <a v-if="person.photo.creditUrl" :href="person.photo.creditUrl" target="_blank" rel="noopener noreferrer">{{ person.photo.credit }}</a>
        <template v-else>{{ person.photo.credit }}</template>.
      </template>
    </div>
  </div>
</template>

<style scoped>
.person-profile {
  padding: 4px 0 6px;
  max-width: 64ch;
  color: inherit;
  font-size: 0.875rem;
}
.person-profile ul {
  padding-left: 20px;
}
</style>
