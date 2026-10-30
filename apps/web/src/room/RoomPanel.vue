<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { RoomSetting, RoomSettingsView } from 'ustp-domain';
import { attempt, dialog } from '../dialogs.js';
import { roomSettings, setRoomSetting } from './api.js';
import { changedLine, serverLine } from './room-text.js';

/**
 * Admin › Members' room (design §5.10): open or close the room for everyone, and switch its model server on or off. A
 * System Admin switches the server, since it decides what the GPU costs; Membership and System Admins open and close
 * the room. Each switch is ledgered and reaches open room pages at once.
 */
const settings = ref<RoomSettingsView | null>(null);
const busy = ref<RoomSetting | null>(null);

async function load() {
  await attempt(async () => {
    settings.value = await roomSettings();
  });
}
onMounted(load);

const server = computed(() => (settings.value ? serverLine(settings.value.server) : null));

const CONFIRM: Readonly<Record<RoomSetting, Readonly<Record<'on' | 'off', { title: string; message: string; ok: string; done: string }>>>> = {
  open: {
    off: {
      title: 'Close the members’ room?',
      message: 'Nobody can read or post in it until it is opened again. Nothing in it is deleted, and messages still expire after 90 days.',
      ok: 'Close the room',
      done: 'The room is closed',
    },
    on: {
      title: 'Open the members’ room?',
      message: 'Active members who accepted its terms can use it again at once.',
      ok: 'Open the room',
      done: 'The room is open',
    },
  },
  server: {
    off: {
      title: 'Switch the model server off?',
      message: 'Nothing more goes to the room’s model, so its GPU stops within about 15 minutes and costs nothing. Questions waiting are cancelled; the chat and memory keep working.',
      ok: 'Switch it off',
      done: 'The model server is off',
    },
    on: {
      title: 'Switch the model server on?',
      message: 'Questions reach the model again, and it starts now, so the next one need not wait. While it runs it costs about $1.05 an hour; it stops on its own after about 15 quiet minutes.',
      ok: 'Switch it on',
      done: 'The model server is on and starting',
    },
  },
};

function toggle(setting: RoomSetting, on: boolean) {
  const words = CONFIRM[setting][on ? 'on' : 'off'];
  dialog({
    title: words.title,
    message: words.message,
    cancel: { flat: true, noCaps: true, label: 'Cancel' },
    ok: { unelevated: true, noCaps: true, color: on ? 'primary' : 'negative', label: words.ok },
  }).onOk(async () => {
    busy.value = setting;
    await attempt(async () => {
      settings.value = await setRoomSetting(setting, on);
    }, words.done);
    busy.value = null;
  });
}
</script>

<template>
  <div class="ustp-form room-panel">
    <div class="text-grey-7">
      The members’ room is the chat for Active members who accepted its terms, with an assistant on the party’s own model
      server. Close the room to stop everyone using it for a while; switch the server off to stop its GPU costs.
    </div>
    <div v-if="!settings" class="text-grey-7">Loading…</div>
    <template v-else>
      <q-card flat bordered>
        <q-card-section class="row items-center no-wrap q-gutter-md">
          <q-icon :name="settings.open ? 'forum' : 'lock'" size="28px" :color="settings.open ? 'primary' : 'grey-7'" aria-hidden="true" />
          <div class="col">
            <h2 class="text-subtitle1 q-my-none">The room is {{ settings.open ? 'open' : 'closed' }}</h2>
            <div class="text-caption text-grey-7">
              {{ settings.people }} in the room<template v-if="changedLine(settings.openChangedBy, settings.openChangedAt)">
                · {{ settings.open ? 'opened' : 'closed' }} {{ changedLine(settings.openChangedBy, settings.openChangedAt) }}</template
              >
            </div>
          </div>
          <q-btn
            unelevated
            no-caps
            :color="settings.open ? 'negative' : 'primary'"
            :icon="settings.open ? 'lock' : 'lock_open'"
            :label="settings.open ? 'Close the room' : 'Open the room'"
            :loading="busy === 'open'"
            @click="toggle('open', !settings.open)"
          />
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="row items-center no-wrap q-gutter-md">
          <q-icon name="memory" size="28px" :color="server!.running ? 'primary' : 'grey-7'" aria-hidden="true" />
          <div class="col">
            <h2 class="text-subtitle1 q-my-none">{{ server!.title }}</h2>
            <div class="text-caption text-grey-7">{{ server!.caption }}</div>
            <div v-if="changedLine(settings.server.changedBy, settings.server.changedAt)" class="text-caption text-grey-7">
              Switched {{ settings.server.on ? 'on' : 'off' }} {{ changedLine(settings.server.changedBy, settings.server.changedAt) }}
            </div>
          </div>
          <q-btn
            v-if="settings.canSwitchServer"
            unelevated
            no-caps
            :color="settings.server.on ? 'negative' : 'primary'"
            :icon="settings.server.on ? 'power_settings_new' : 'play_arrow'"
            :label="settings.server.on ? 'Switch the server off' : 'Switch the server on'"
            :loading="busy === 'server'"
            @click="toggle('server', !settings.server.on)"
          />
        </q-card-section>
        <q-card-section v-if="!settings.canSwitchServer" class="q-pt-none text-caption text-grey-7">
          Only a System Admin switches the server, since it decides what the GPU costs.
        </q-card-section>
      </q-card>

      <div class="text-caption text-grey-7">
        In the room itself, a Membership Admin can also switch just the assistant off with <code>/assistant off</code>
        (now {{ settings.assistantOn ? 'on' : 'off' }}){{ settings.pending ? `; ${settings.pending} question(s) waiting` : '' }}.
      </div>
    </template>
  </div>
</template>

<style scoped>
.room-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
