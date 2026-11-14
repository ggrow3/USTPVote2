<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import type { DiscordLinkView } from 'ustp-domain';
import { announce } from '../a11y.js';
import { errorMessage } from '../api.js';
import { DISCORD_STATE_KEY, myDiscord, setDiscordCelebrate, startDiscordLink, unlinkDiscord } from './api.js';
import { CELEBRATE_HELP, CELEBRATE_LABEL, LINK_INTRO, LINK_TELLS, roleText, showsDiscordCard, UNLINK_CONFIRM } from './discord-link-text.js';

/**
 * Connect Discord, on the Account page (design §10.18, "Linking"): a member signs in to Discord, and the bot gives
 * them the Member role on the party's server while their membership is Active. The card says what linking gives away
 * before they start, and is not shown where the site has no Discord linking set up.
 */
const $q = useQuasar();
const view = ref<DiscordLinkView | null>(null);
const problem = ref<string | null>(null);
const busy = ref(false);

const shown = computed(() => !!view.value && showsDiscordCard(view.value));
const linkedOn = computed(() => (view.value?.link ? new Date(view.value.link.linkedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''));

onMounted(async () => {
  try {
    view.value = await myDiscord();
  } catch (e) {
    problem.value = errorMessage(e);
  }
});

async function connect() {
  busy.value = true;
  try {
    const start = await startDiscordLink();
    // Kept in this tab only, to check that Discord sends back the sign-in this tab started.
    sessionStorage.setItem(DISCORD_STATE_KEY, start.state);
    window.location.assign(start.url);
  } catch (e) {
    busy.value = false;
    $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

async function celebrate(value: boolean) {
  busy.value = true;
  try {
    view.value = await setDiscordCelebrate(value);
    announce(value ? 'The weekly post may name you.' : 'The weekly post will not name you.');
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    busy.value = false;
  }
}

function unlink() {
  $q.dialog({ title: 'Unlink Discord?', message: UNLINK_CONFIRM, cancel: true, ok: { label: 'Unlink', color: 'negative', noCaps: true, unelevated: true }, focus: 'cancel' }).onOk(async () => {
    busy.value = true;
    try {
      view.value = await unlinkDiscord();
      announce('Discord is unlinked.');
    } catch (e) {
      $q.notify({ type: 'negative', message: errorMessage(e) });
    } finally {
      busy.value = false;
    }
  });
}
</script>

<template>
  <q-card v-if="problem || shown" flat bordered tag="section" aria-labelledby="discord-link-title">
    <q-card-section>
      <h2 id="discord-link-title" class="text-subtitle1">Discord</h2>
      <div class="text-caption text-grey-7">{{ LINK_INTRO }}</div>
    </q-card-section>
    <q-card-section v-if="problem" class="q-pt-none" role="alert">{{ problem }}</q-card-section>
    <template v-else-if="view && view.link">
      <q-card-section class="q-pt-none ustp-stack">
        <div>
          <q-icon name="link" size="20px" aria-hidden="true" class="q-mr-xs" />Linked to
          <strong>{{ view.link.discordName ?? 'your Discord account' }}</strong> since {{ linkedOn }}.
        </div>
        <div role="status">
          <q-icon :name="view.link.role === 'given' ? 'check_circle' : 'info'" size="20px" aria-hidden="true" class="q-mr-xs" />{{ roleText(view) }}
        </div>
        <div>
          <q-toggle :model-value="view.link.celebrate" :label="CELEBRATE_LABEL" :disable="busy" @update:model-value="celebrate" />
          <div class="text-caption text-grey-7">{{ CELEBRATE_HELP }}</div>
        </div>
        <div class="ustp-actions">
          <q-btn outline no-caps color="negative" icon="link_off" label="Unlink Discord" :disable="busy" @click="unlink" />
        </div>
      </q-card-section>
    </template>
    <template v-else-if="view">
      <q-card-section class="q-pt-none ustp-stack">
        <p class="q-my-none">{{ LINK_TELLS }}</p>
        <p v-if="!view.activeMember" class="q-my-none text-grey-8">The Member role is for Active members: you can connect now, and the role follows once your membership is Active.</p>
        <div class="ustp-actions">
          <q-btn unelevated no-caps color="primary" icon="link" label="Connect Discord" :loading="busy" @click="connect" />
        </div>
      </q-card-section>
    </template>
  </q-card>
</template>
