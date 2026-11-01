<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AreaContact, ContactPhoto, PersonMarks } from 'ustp-domain';
import { CONTACT_SOURCE_TEXT, districtText, MARK_TEXT, runningText } from './candidacy-text.js';
import DistrictMap from './DistrictMap.vue';
import DistrictOutline from './DistrictOutline.vue';
import { mapsRefused } from './maps.js';
import PersonBadges from './PersonBadges.vue';

/** One of a person's links, as their row on the page shows it. */
export interface PersonLink {
  readonly icon: string;
  readonly label: string;
  readonly href: string | null;
  /** Opens in a new tab: every link but email. */
  readonly away: boolean;
}

/**
 * A person on the Candidates or Your area page, opened from their photo or name (design §5.12): a larger photo, what
 * they are to the member in full (§5.8), their office, party and district, their links named in full, and the area
 * they represent, or would, on the map where it is set up and drawn from its outline where it is not.
 */
const props = defineProps<{
  person: AreaContact;
  marks: PersonMarks;
  /** Their photo, or null when there is none or it did not load. */
  photo: ContactPhoto | null;
  initials: string;
  links: readonly PersonLink[];
}>();
const open = defineModel<boolean>({ required: true });

const where = computed(() => districtText(props.person));
/** What each of their badges means, said in full. */
const meanings = computed(() => (['party', 'representative'] as const).filter((m) => props.marks[m]).map((m) => MARK_TEXT[m].meaning));
const caption = computed(() =>
  [props.person.party, CONTACT_SOURCE_TEXT[props.person.source], props.person.role === 'candidate' ? runningText(props.person.election) : null].filter(Boolean).join(' · '),
);
/** The nation has no outline; any other district is drawn. */
const outline = computed(() => (props.person.district.kind === 'nation' ? null : { kind: props.person.district.kind, geoid: props.person.district.geoid }));
/** Set once the map shows: until then, and wherever it cannot, the outline is drawn instead. */
const mapShown = ref(false);
</script>

<template>
  <q-dialog v-model="open">
    <q-card class="person-dialog">
      <q-card-section class="person-dialog__head">
        <q-avatar size="96px" rounded class="person-dialog__photo">
          <img v-if="photo" :src="photo.url" :alt="`Photo of ${person.name}`" referrerpolicy="no-referrer" />
          <span v-else aria-hidden="true">{{ initials }}</span>
        </q-avatar>
        <div class="person-dialog__who">
          <h2 class="text-h6 q-my-none">
            {{ person.name }}
            <PersonBadges :marks="marks" :incumbent="person.incumbent" />
          </h2>
          <div v-if="meanings.length" class="q-my-xs">
            <div v-for="m in meanings" :key="m" class="text-caption">{{ m }}</div>
          </div>
          <div>{{ person.role === 'holder' ? person.officeTitle : `Running for ${person.officeTitle}` }}</div>
          <div class="text-grey-7">{{ caption }}</div>
          <div class="text-grey-7">{{ where }}</div>
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div class="text-caption text-grey-7 q-mb-xs">
          {{ person.role === 'holder' ? 'The area they represent' : 'The area they would represent' }}: {{ where }}
        </div>
        <DistrictMap v-if="outline" optional :outline="outline" :label="`Map of ${where}`" height="240px" @ready="mapShown = true" />
        <div v-if="!outline || !mapShown || mapsRefused" class="person-dialog__outline">
          <DistrictOutline :district="person.district" :size="160" />
        </div>
      </q-card-section>
      <q-card-section v-if="links.length" class="q-pt-none person-dialog__links">
        <template v-for="l in links" :key="l.icon">
          <q-btn
            v-if="l.href"
            flat
            dense
            no-caps
            color="primary"
            :icon="l.icon"
            :label="l.label"
            :href="l.href"
            :target="l.away ? '_blank' : undefined"
            :rel="l.away ? 'noopener noreferrer' : undefined"
          />
          <span v-else class="text-caption text-grey-7"><q-icon :name="l.icon" size="16px" class="q-mr-xs" />{{ l.label }}</span>
        </template>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn v-close-popup flat no-caps label="Close" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.person-dialog {
  width: 520px;
  max-width: 100%;
}
.person-dialog__head {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.person-dialog__who {
  flex: 1;
  min-width: 0;
}
.person-dialog__photo {
  background: rgba(127, 127, 127, 0.18);
  font-size: 32px;
  font-weight: 500;
}
.person-dialog__photo img {
  object-fit: cover;
}
.person-dialog__outline {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}
.person-dialog__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}
</style>
