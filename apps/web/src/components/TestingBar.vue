<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { PersonaSummary } from 'ustp-domain';
import { acting } from '../acting.js';
import { api } from '../api.js';
import { attempt } from '../dialogs.js';
import { actAs } from '../session.js';

/**
 * Testing mode (design §10.4): shown under the menu while this tab acts as a test persona. The layout loads it only
 * then, which also keeps the layout from importing the dialogs (and through them the router that imports the layout).
 */
const router = useRouter();

/** The personas to switch to, loaded as yourself when the menu opens. */
const personas = ref<PersonaSummary[]>([]);
async function loadPersonas() {
  await attempt(async () => {
    personas.value = await api<PersonaSummary[]>('GET', '/v1/testing/personas', undefined, { actAs: null });
  });
}

async function switchTo(persona: PersonaSummary | null) {
  const ok = await attempt(() => actAs(persona && { accountId: persona.accountId, label: persona.label }));
  if (!ok) return;
  if (!persona) await router.push({ path: '/admin', query: { tab: 'testing' } });
  else await router.push(persona.kind === 'voter' ? '/ballot' : '/admin');
}
</script>

<template>
  <div v-if="acting.persona" class="ustp-testing-bar row items-center q-px-md q-py-xs" role="region" aria-label="Testing mode">
    <span class="q-mr-md">
      <strong>Testing:</strong> you are acting as <strong>{{ acting.persona.label }}</strong>. Everything you do is recorded as
      this test persona.
    </span>
    <q-space />
    <q-btn-dropdown flat dense no-caps label="Switch persona" @before-show="loadPersonas">
      <q-list style="min-width: 220px">
        <q-item
          v-for="p in personas"
          :key="p.accountId"
          v-close-popup
          clickable
          :active="p.accountId === acting.persona.accountId"
          @click="switchTo(p)"
        >
          <q-item-section>{{ p.label }}</q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>
    <q-btn flat dense no-caps label="Stop acting" class="q-ml-sm" @click="switchTo(null)" />
  </div>
</template>

<style scoped>
.ustp-testing-bar {
  background: #ffe082;
  color: #000;
  font-size: 14px;
}
</style>
