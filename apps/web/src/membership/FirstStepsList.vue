<script setup lang="ts">
import { firstStepLinkProblem, type FirstStepItem } from 'ustp-domain';

/**
 * The getting started steps (design §5.16), as a member sees them: a step the site ticks is one link; a step the
 * member ticks has a box to tick beside its link, so no control sits inside another. A link to another site opens in
 * a new tab. A link the rules would refuse, as an admin may type one in the preview, is shown as plain words. Ticking
 * only asks: the parent saves it (`tick`), or a preview just shows it.
 */
defineProps<{
  items: readonly FirstStepItem[];
  /** The id of a step whose tick is being saved, to hold its box meanwhile. */
  saving?: string | null;
}>();
const emit = defineEmits<{ tick: [id: string, done: boolean] }>();

const usable = (item: FirstStepItem) => firstStepLinkProblem(item.link) === null;
const linkAttrs = (item: FirstStepItem) => {
  if (!usable(item)) return {};
  return item.external ? { href: item.link, target: '_blank', rel: 'noopener noreferrer' } : { to: item.link };
};
</script>

<template>
  <q-list>
    <template v-for="item in items" :key="item.id">
      <q-item v-if="item.check !== 'self'" v-bind="linkAttrs(item)" :clickable="usable(item)">
        <q-item-section avatar>
          <q-icon :name="item.done ? 'check_circle' : 'radio_button_unchecked'" :color="item.done ? 'positive' : 'grey-6'" aria-hidden="true" />
        </q-item-section>
        <q-item-section>
          <q-item-label>
            {{ item.label }}<span class="sr-only">{{ item.done ? ' (done)' : ' (not done yet)' }}</span>
            <template v-if="item.external && usable(item)">
              <q-icon name="open_in_new" size="xs" class="q-ml-xs" aria-hidden="true" /><span class="sr-only"> (opens in a new tab)</span>
            </template>
          </q-item-label>
          <q-item-label v-if="item.why" caption>{{ item.why }}</q-item-label>
        </q-item-section>
      </q-item>
      <q-item v-else>
        <q-item-section avatar>
          <q-checkbox
            :model-value="item.done"
            dense
            color="positive"
            :disable="saving === item.id"
            :aria-label="`Done: ${item.label}`"
            @update:model-value="(done: boolean) => emit('tick', item.id, done)"
          />
        </q-item-section>
        <q-item-section>
          <q-item-label>
            <span v-if="!usable(item)">{{ item.label }}</span>
            <a v-else-if="item.external" v-bind="linkAttrs(item)"
              >{{ item.label }}<q-icon name="open_in_new" size="xs" class="q-ml-xs" aria-hidden="true" /><span class="sr-only">
                (opens in a new tab)</span
              ></a
            >
            <router-link v-else :to="item.link">{{ item.label }}</router-link>
          </q-item-label>
          <q-item-label v-if="item.why" caption>{{ item.why }}</q-item-label>
        </q-item-section>
      </q-item>
    </template>
  </q-list>
</template>

