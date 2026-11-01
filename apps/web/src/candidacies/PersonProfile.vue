<script setup lang="ts">
import { positionText, WIKIPEDIA_LICENCE, type AreaContact } from 'ustp-domain';

/**
 * What public records say about a person on the Candidates or Your area page (design §5.12): who to credit for their
 * photo, and, folded away, the start of their Wikipedia article, the offices they have held, where they studied and
 * their work, from Wikidata. Wikipedia's text is credited and licensed as CC BY-SA 4.0 asks.
 */
defineProps<{ person: Pick<AreaContact, 'name' | 'photo' | 'profile'> }>();
</script>

<template>
  <div v-if="person.photo" class="text-caption text-grey-7">
    <a v-if="person.photo.creditUrl" :href="person.photo.creditUrl" target="_blank" rel="noopener noreferrer">{{ person.photo.credit }}</a>
    <template v-else>{{ person.photo.credit }}</template>
  </div>
  <q-expansion-item
    v-if="person.profile"
    dense
    dense-toggle
    switch-toggle-side
    :label="`About ${person.name}`"
    header-class="person-profile__toggle text-primary"
    class="person-profile"
  >
    <div class="person-profile__body">
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
      </div>
    </div>
  </q-expansion-item>
</template>

<style scoped>
.person-profile {
  margin-left: -8px;
}
:deep(.person-profile__toggle) {
  padding-left: 0;
  min-height: 32px;
}
.person-profile__body {
  padding: 0 8px 8px;
  max-width: 64ch;
}
.person-profile__body ul {
  padding-left: 20px;
}
</style>
