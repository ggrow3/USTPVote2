<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { BillSettingsView } from 'ustp-domain';
import { announce } from '../a11y.js';
import { errorMessage } from '../api.js';
import { refreshBillsAccess } from './access.js';
import { billSettings, saveBillSettings } from './api.js';
import { day, keySourceText } from './bill-text.js';

/**
 * Admin › Bills (design §5.14), for System Admins: which teams are the legislative team that has the Bills page, and
 * which api.data.gov key it uses. Who is on a team stays with its leads and Membership Admins.
 */
const settings = ref<BillSettingsView | null>(null);
const chosen = ref<string[]>([]);
const error = ref('');
const saving = ref(false);

/** Teams to pick from: those not archived, and an archived one already named (shown so it can be taken off). */
const teams = computed(() => settings.value?.teams.filter((t) => !t.archived || settings.value!.teamIds.includes(t.teamId)) ?? []);
const changed = computed(() => {
  const saved = settings.value?.teamIds ?? [];
  return chosen.value.length !== saved.length || chosen.value.some((id) => !saved.includes(id));
});

async function load() {
  error.value = '';
  try {
    settings.value = await billSettings();
    chosen.value = [...settings.value.teamIds];
  } catch (e) {
    error.value = errorMessage(e);
  }
}
onMounted(load);

async function save() {
  if (!settings.value) return;
  saving.value = true;
  error.value = '';
  try {
    settings.value = await saveBillSettings(chosen.value, settings.value.version);
    chosen.value = [...settings.value.teamIds];
    await refreshBillsAccess();
    announce('Saved: who has the Bills page.');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="ustp-stack">
    <div>
      <h2 class="text-subtitle1">Bills in Congress</h2>
      <div class="text-grey-7">
        The Bills page finds bills in Congress, opens their actions and text, and keeps a watchlist with tags and notes. It
        is for the legislative team: the Active members of the teams named here, and System Admins. Membership Admins and
        the teams' leads decide who is on each team, under Teams.
      </div>
    </div>
    <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
    <div v-if="!settings && !error" class="text-grey-7">Loading…</div>
    <template v-else-if="settings">
      <q-card flat bordered tag="section" aria-labelledby="bills-teams-heading">
        <q-card-section>
          <h3 id="bills-teams-heading" class="text-subtitle1">Teams with the Bills page</h3>
          <div class="text-caption text-grey-7">
            <template v-if="settings.updatedBy">Last changed by {{ settings.updatedBy.name }} on {{ day(settings.updatedAt) }}.</template>
            <template v-else>No team named yet, so only System Admins have the page.</template>
          </div>
        </q-card-section>
        <q-card-section>
          <p v-if="!teams.length" class="text-grey-7">There are no teams yet. Membership Admins create them under Admin › Teams.</p>
          <div v-else class="column" role="group" aria-labelledby="bills-teams-heading">
            <q-checkbox v-for="t in teams" :key="t.teamId" v-model="chosen" :val="t.teamId" :disable="t.archived && !chosen.includes(t.teamId)">
              {{ t.name }} <span class="text-grey-7">({{ t.members === 1 ? '1 person' : `${t.members} people` }}<template v-if="t.archived">, archived: it gives nobody the page until restored</template>)</span>
            </q-checkbox>
          </div>
          <div class="ustp-actions q-mt-md">
            <q-btn color="primary" no-caps label="Save" :disable="!changed" :loading="saving" @click="save" />
          </div>
        </q-card-section>
      </q-card>
      <p class="text-grey-8">
        {{ keySourceText(settings.keySource) }}
        <router-link to="/admin?tab=claude">Open the API keys tab</router-link>
      </p>
    </template>
  </div>
</template>
