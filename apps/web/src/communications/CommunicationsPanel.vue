<script setup lang="ts">
import { onMounted, ref } from 'vue';
import BotsAdmin from './BotsAdmin.vue';
import CalendarAdmin from './CalendarAdmin.vue';
import NewsAdmin from './NewsAdmin.vue';
import PressKitAdmin from './PressKitAdmin.vue';
import ShareKitAdmin from './ShareKitAdmin.vue';
import SuggestionsAdmin from './SuggestionsAdmin.vue';
import { suggestions } from './api.js';

/**
 * Communications, for Communications Admins (design §10.7): news and press releases, the share kit for members, the
 * social media calendar, suggestions from the public, the press kit and the party's bots. The home page's Link hub,
 * with the party's social accounts, is its own section beside this one.
 */
type View = 'news' | 'share' | 'calendar' | 'suggestions' | 'press' | 'bots';
const view = ref<View>('news');
const unread = ref(0);
const TABS: readonly { name: View; label: string; icon: string }[] = [
  { name: 'news', label: 'News', icon: 'article' },
  { name: 'share', label: 'Share kit', icon: 'share' },
  { name: 'calendar', label: 'Calendar', icon: 'event' },
  { name: 'suggestions', label: 'Suggestions', icon: 'lightbulb' },
  { name: 'press', label: 'Press kit', icon: 'mic' },
  { name: 'bots', label: 'Bots', icon: 'smart_toy' },
];

// How many suggestions wait unread, shown on the tab before it is opened; it keeps the count once it is.
onMounted(async () => {
  try {
    unread.value = (await suggestions()).filter((s) => s.status === 'new').length;
  } catch {
    // The tab says so when it is opened.
  }
});
</script>

<template>
  <div>
    <q-tabs v-model="view" dense no-caps align="left" class="text-primary" outside-arrows>
      <q-tab v-for="t in TABS" :id="`comms-tab-${t.name}`" :key="t.name" :name="t.name" :icon="t.icon" :label="t.label" :aria-controls="`comms-panel-${t.name}`">
        <q-badge v-if="t.name === 'suggestions' && unread" color="orange-9" floating :label="unread" :aria-label="`${unread} new`" />
      </q-tab>
    </q-tabs>
    <q-separator />
    <q-tab-panels v-model="view" keep-alive class="bg-transparent">
      <q-tab-panel id="comms-panel-news" name="news" aria-labelledby="comms-tab-news" class="q-px-none"><NewsAdmin /></q-tab-panel>
      <q-tab-panel id="comms-panel-share" name="share" aria-labelledby="comms-tab-share" class="q-px-none"><ShareKitAdmin /></q-tab-panel>
      <q-tab-panel id="comms-panel-calendar" name="calendar" aria-labelledby="comms-tab-calendar" class="q-px-none"><CalendarAdmin /></q-tab-panel>
      <q-tab-panel id="comms-panel-suggestions" name="suggestions" aria-labelledby="comms-tab-suggestions" class="q-px-none">
        <SuggestionsAdmin @unread="unread = $event" />
      </q-tab-panel>
      <q-tab-panel id="comms-panel-press" name="press" aria-labelledby="comms-tab-press" class="q-px-none"><PressKitAdmin /></q-tab-panel>
      <q-tab-panel id="comms-panel-bots" name="bots" aria-labelledby="comms-tab-bots" class="q-px-none"><BotsAdmin /></q-tab-panel>
    </q-tab-panels>
  </div>
</template>
