<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { brightAccent, effectiveAccent, hubChanges, type Hub, type HubClickCount, type HubRecord } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { hubClicks, hubSettings, saveHub } from './api.js';
import { applyHub } from './hub.js';
import { describeHubChange } from './hub-text.js';
import HubAnalyticsTab from './HubAnalyticsTab.vue';
import HubLinksTab from './HubLinksTab.vue';
import HubProfileTab from './HubProfileTab.vue';
import './hub-fonts.css';

/**
 * The home page hub's settings (design §10.6), for System Admins: its links and sections, which save as each is
 * changed; the profile, look and Discord card, which save together; and how often each link is followed.
 */
const view = ref<'links' | 'profile' | 'analytics'>('links');
const saved = ref<HubRecord | null>(null);
const clicks = ref<HubClickCount[]>([]);
const busy = ref(false);

async function load() {
  await attempt(async () => {
    [saved.value, clicks.value] = await Promise.all([hubSettings(), hubClicks()]);
  });
}

async function reloadClicks() {
  await attempt(async () => {
    clicks.value = await hubClicks();
  });
}

/**
 * Saves the hub as `next`, from the version on screen, and says what changed. If it is refused (someone saved since,
 * or something cannot be shown), the hub is reloaded, so the page shows what is really saved.
 */
async function commit(next: Hub, done?: () => void) {
  const before = saved.value;
  if (!before || busy.value) return;
  const changes = hubChanges(before, next);
  if (!changes.length) return done?.();
  const title = (id: string) => next.sections.find((s) => s.id === id)?.title ?? '';
  const said = changes.length === 1 ? describeHubChange(changes[0]!, title) : `${changes.length} changes`;
  busy.value = true;
  let ok = false;
  try {
    ok = await attempt(async () => {
      saved.value = await saveHub({ basedOn: before.version, ...next });
      applyHub(saved.value);
    }, `Saved: ${said}.`);
  } finally {
    busy.value = false;
  }
  // After `busy`, so the buttons are enabled again when `done` puts focus back on one.
  if (ok) done?.();
  else await load();
}

onMounted(load);
</script>

<template>
  <div
    class="hub-admin ustp-signal"
    :class="{ 'hub-admin--dark': $q.dark.isActive }"
    :style="saved ? { '--hub-accent': effectiveAccent(saved.profile), '--hub-bright': brightAccent(effectiveAccent(saved.profile)) } : {}"
  >
    <div class="hub-admin__head">
      <div>
        <h2 class="text-subtitle1">The home page hub</h2>
        <div class="text-caption text-grey-7">
          <template v-if="saved?.version">Version {{ saved.version }}, saved {{ new Date(saved.updatedAt!).toLocaleString() }}.</template>
          <template v-else-if="saved">The default: nobody has changed it yet.</template>
        </div>
      </div>
      <q-btn
        flat
        no-caps
        color="primary"
        icon-right="north_east"
        label="View the hub"
        aria-label="View the hub (opens in a new tab)"
        to="/"
        target="_blank"
      />
    </div>
    <p class="hub-admin__intro">
      The home page, the same for everyone: the party's profile, a row of icons, the Discord card and sections of
      links. The voting app's own home is <router-link to="/vote">/vote</router-link>. Changes to links and sections
      are saved as you make them.
    </p>

    <q-tabs v-model="view" dense no-caps align="left" class="hub-admin__tabs" active-class="hub-admin__tab--active" indicator-color="transparent">
      <q-tab id="hub-tab-links" name="links" label="Links" aria-controls="hub-panel-links" />
      <q-tab id="hub-tab-profile" name="profile" label="Profile & Discord" aria-controls="hub-panel-profile" />
      <q-tab id="hub-tab-analytics" name="analytics" label="Analytics" aria-controls="hub-panel-analytics" />
    </q-tabs>

    <q-tab-panels v-if="saved" v-model="view" keep-alive class="bg-transparent">
      <q-tab-panel id="hub-panel-links" name="links" aria-labelledby="hub-tab-links" class="q-px-none">
        <HubLinksTab :saved="saved" :clicks="clicks" :busy="busy" @commit="commit" />
      </q-tab-panel>
      <q-tab-panel id="hub-panel-profile" name="profile" aria-labelledby="hub-tab-profile" class="q-px-none">
        <HubProfileTab :saved="saved" :busy="busy" @commit="commit" />
      </q-tab-panel>
      <q-tab-panel id="hub-panel-analytics" name="analytics" aria-labelledby="hub-tab-analytics" class="q-px-none">
        <HubAnalyticsTab :saved="saved" :clicks="clicks" @refresh="reloadClicks" />
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<style scoped>
/* The hub's look (design §10.6), dense: charcoal cards with hairline borders, mono for small labels and numbers. */
.hub-admin {
  --ha-card: #ffffff;
  --ha-row: #ffffff;
  --ha-tile: #f4efe8;
  --ha-line: #e2dad0;
  --ha-muted: #5c5650;
  --ha-letters: var(--hub-accent, #bd4e00);
  --ustp-focus: var(--hub-accent, #bd4e00);
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 1040px;
}
.hub-admin--dark {
  --ha-card: #1c1c1c;
  --ha-row: #212121;
  --ha-tile: #2b2b2b;
  --ha-line: #424242;
  --ha-muted: #b8b8b8;
  --ha-letters: var(--hub-bright, #ff6900);
  --ha-off: 0.72;
  --ustp-focus: var(--hub-bright, #ff6900);
}
.hub-admin__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.hub-admin__intro {
  max-width: 860px;
  margin: 0;
}
/* Pills, as the hub's own buttons. */
.hub-admin__tabs :deep(.q-tab) {
  min-height: 40px;
  margin-right: 4px;
  border-radius: 999px;
  font-family: var(--signal-body);
  font-size: 0.9375rem;
}
.hub-admin__tabs :deep(.hub-admin__tab--active) {
  background: var(--ha-tile);
  font-weight: 700;
}
</style>
