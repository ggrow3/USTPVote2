<script setup lang="ts">
import { computed } from 'vue';
import { seatNotUp, type AreaContact, type AreaOfficeGroup, type ContactDistrict, type PersonMarks, type SeatNotUp } from 'ustp-domain';
import AreaPerson from './AreaPerson.vue';
import { emptyOfficeText, notUpText, officeShown, runningGapsText } from './candidacy-text.js';
import OfficeCard from './OfficeCard.vue';

/**
 * One group of an area's people on the Candidates and Your area pages (design §5.8) as a grid of office cards: the
 * member's representatives (`holders`) or the others running (`candidates`). With `every`, each office of the area has
 * its card, saying so when nobody is listed; without, only the offices someone runs for do, and a line names the rest.
 * The `person` slot takes each person's side, such as the Your area page's Write button.
 */
const props = defineProps<{
  groups: readonly AreaOfficeGroup[];
  part: 'holders' | 'candidates';
  every: boolean;
  electionYear: number;
  notUp: readonly SeatNotUp[];
  marks: (person: AreaContact) => PersonMarks;
  /** Whether the page's map can outline the district. */
  mappable: (district: ContactDistrict) => boolean;
  /** Link each person's email address too (the Your area page writes to it instead). */
  showEmail?: boolean;
}>();
const emit = defineEmits<{ map: [district: ContactDistrict] }>();
defineSlots<{ person?: (props: { person: AreaContact }) => unknown }>();

const people = (g: AreaOfficeGroup) => (props.part === 'holders' ? g.holders : g.candidates);
const shown = computed(() => props.groups.filter((g) => officeShown(g, props.electionYear)));
const cards = computed(() => (props.every ? shown.value : shown.value.filter((g) => people(g).length)));
const gaps = computed(() => {
  if (props.every) return [];
  const empty = shown.value.filter((g) => !people(g).length);
  return runningGapsText(
    empty.filter((g) => seatNotUp(props.notUp, g)),
    empty.filter((g) => !seatNotUp(props.notUp, g)),
    props.electionYear,
  );
});
const districtKey = (d: Pick<ContactDistrict, 'kind' | 'geoid'>) => `${d.kind}:${d.geoid}`;

/** A seat not up this year says so: under who holds it, or for who runs, when nobody does. */
const note = (g: AreaOfficeGroup) => (seatNotUp(props.notUp, g) && (props.part === 'holders' || !people(g).length) ? notUpText(props.electionYear) : null);
const empty = (g: AreaOfficeGroup) =>
  people(g).length || (props.part === 'candidates' && seatNotUp(props.notUp, g)) ? null : emptyOfficeText(g.office, props.part === 'candidates');
</script>

<template>
  <div>
    <div v-if="cards.length" class="office-grid">
      <OfficeCard
        v-for="g in cards"
        :key="`${g.office}:${districtKey(g.district)}`"
        :office="g.office"
        :district="g.district"
        :mappable="mappable(g.district)"
        :note="note(g)"
        :empty="empty(g)"
        @map="emit('map', g.district)"
      >
        <q-list v-if="people(g).length" dense separator>
          <AreaPerson v-for="c in people(g)" :key="c.contactId" :person="c" :marks="marks(c)" :show-email="showEmail">
            <slot name="person" :person="c" />
          </AreaPerson>
        </q-list>
      </OfficeCard>
    </div>
    <div v-for="line in gaps" :key="line" class="text-caption text-grey-7 q-mt-sm">{{ line }}</div>
  </div>
</template>

<style scoped>
.office-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: 12px;
  align-items: start;
}
</style>
