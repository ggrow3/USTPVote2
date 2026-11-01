<script setup lang="ts">
import { nextTick, reactive } from 'vue';
import type { AreaContact } from 'ustp-domain';
import { FIRST_SHOWN, firstShown, showMoreText } from './candidacy-text.js';
import AreaPerson from './AreaPerson.vue';

/**
 * The people of one office's card on the Candidates and Your area pages (design §5.8): who holds the office, then who
 * is running for it, each list showing its first four with *Show N more* under it for the rest. The default slot takes
 * each person's side, such as the Your area page's Write button.
 */
const props = defineProps<{
  holders: readonly AreaContact[];
  candidates: readonly AreaContact[];
  /** Head each list with *In office* or *Running*. */
  labelled?: boolean;
  /** Link each person's email address too. */
  showEmail?: boolean;
}>();
defineSlots<{ default?(props: { person: AreaContact }): unknown }>();

const open = reactive<Record<string, boolean>>({});

async function toggle(title: string, button: Event): Promise<void> {
  open[title] = !open[title];
  // Shown fewer, the button moves up the page: keep it in view.
  const at = button.currentTarget as HTMLElement | null;
  await nextTick();
  if (!open[title]) at?.scrollIntoView({ block: 'nearest' });
}
</script>

<template>
  <template v-for="part in [
    { title: 'In office', people: props.holders },
    { title: 'Running', people: props.candidates },
  ]" :key="part.title">
    <template v-if="part.people.length">
      <q-list dense separator>
        <q-item-label v-if="labelled" header class="office-people__part">{{ part.title }}</q-item-label>
        <AreaPerson v-for="c in firstShown(part.people, open[part.title] ?? false)" :key="c.contactId" :person="c" :show-email="showEmail">
          <slot :person="c" />
        </AreaPerson>
      </q-list>
      <div v-if="part.people.length > FIRST_SHOWN" class="office-people__more">
        <q-btn
          flat
          dense
          no-caps
          color="primary"
          :icon="open[part.title] ? 'expand_less' : 'expand_more'"
          :label="showMoreText(part.people.length, open[part.title] ?? false)"
          :aria-expanded="open[part.title] ? 'true' : 'false'"
          @click="toggle(part.title, $event)"
        />
      </div>
    </template>
  </template>
</template>

<style scoped>
.office-people__part {
  padding: 4px 16px 0;
  min-height: 0;
}
.office-people__more {
  padding: 0 8px 6px;
}
</style>
