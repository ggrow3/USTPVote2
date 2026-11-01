<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ROOM_INTRO, ROOM_LIMITS, ROOM_TERMS, tidyRoomIntro, tidyRoomTerms, type RoomSetting, type RoomSettingsView } from 'ustp-domain';
import { attempt, dialog } from '../dialogs.js';
import { roomSettings, saveDoor, setRoomSetting } from './api.js';
import { changedLine, serverLine } from './room-text.js';

/**
 * Admin › Members' room (design §5.10): open or close the room for everyone, switch its model server on or off, and
 * change what members read at the door. A System Admin switches the server, since it decides what the GPU costs;
 * Membership and System Admins do the rest. Each change is ledgered and reaches open room pages at once; new terms send
 * everyone in the room back to the door to accept them.
 */
const settings = ref<RoomSettingsView | null>(null);
const busy = ref<RoomSetting | null>(null);

/** The door's words being edited, and the door as it was when the editor was filled (what a save is based on). */
const intro = ref('');
const terms = ref('');
const base = ref<RoomSettingsView['door'] | null>(null);
const saving = ref(false);

function fill(view: RoomSettingsView) {
  base.value = view.door;
  intro.value = view.door.intro;
  terms.value = view.door.terms.text;
}

async function load() {
  await attempt(async () => {
    settings.value = await roomSettings();
    fill(settings.value);
  });
}
onMounted(load);

const server = computed(() => (settings.value ? serverLine(settings.value.server) : null));

const newIntro = computed(() => !!base.value && tidyRoomIntro(intro.value) !== base.value.intro);
const newTerms = computed(() => !!base.value && tidyRoomTerms(terms.value) !== base.value.terms.text);
const nextVersion = computed(() => (base.value?.terms.version ?? 0) + 1);
const original = computed(() => tidyRoomIntro(intro.value) === ROOM_INTRO && tidyRoomTerms(terms.value) === ROOM_TERMS.text);

function useOriginal() {
  intro.value = ROOM_INTRO;
  terms.value = ROOM_TERMS.text;
}

/** Saves the door's words; new terms first say what they do to the people in the room. */
function saveWords() {
  if (!base.value || !settings.value) return;
  const input = { basedOn: base.value.revision, intro: intro.value, terms: terms.value };
  const done = newTerms.value ? `Version ${nextVersion.value} of the terms is in force` : 'The intro is saved';
  const save = async () => {
    saving.value = true;
    await attempt(async () => {
      settings.value = await saveDoor(input);
      fill(settings.value);
    }, done);
    saving.value = false;
  };
  if (!newTerms.value) {
    void save();
    return;
  }
  const people = settings.value.people;
  const who =
    people === 0
      ? 'Nobody is in the room now; whoever enters next reads them first.'
      : `${people === 1 ? 'The member in the room now goes' : `The ${people} members in the room now go`} back to the door at once, and must accept them to come back; what they posted stays.`;
  dialog({
    title: 'Put the new terms in force?',
    message: `They become version ${nextVersion.value}. ${who} The ledger keeps the new text.`,
    cancel: { flat: true, noCaps: true, label: 'Cancel' },
    ok: { unelevated: true, noCaps: true, color: 'primary', label: 'Put them in force' },
  }).onOk(() => void save());
}

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
      server. Close the room to stop everyone using it for a while; switch the server off to stop its GPU costs; change
      what members read before they enter.
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
            <div v-if="server!.cost" class="text-caption text-grey-7">{{ server!.cost }}</div>
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

      <q-card flat bordered>
        <q-card-section class="row items-center no-wrap q-gutter-md">
          <q-icon name="door_front" size="28px" color="primary" aria-hidden="true" />
          <div class="col">
            <h2 class="text-subtitle1 q-my-none">What members read at the door</h2>
            <div class="text-caption text-grey-7">
              Terms version {{ settings.door.terms.version
              }}<template v-if="changedLine(settings.door.termsChangedBy, settings.door.termsChangedAt)">
                · changed {{ changedLine(settings.door.termsChangedBy, settings.door.termsChangedAt) }}</template
              ><template v-if="changedLine(settings.door.introChangedBy, settings.door.introChangedAt)">
                · intro changed {{ changedLine(settings.door.introChangedBy, settings.door.introChangedAt) }}</template
              >
            </div>
          </div>
        </q-card-section>
        <q-card-section class="q-pt-none room-door">
          <q-input
            v-model="intro"
            outlined
            autogrow
            label="Intro"
            :maxlength="ROOM_LIMITS.intro"
            counter
            hint="The line under the page’s title. It changes at once, and nobody has to accept it. Leave it empty for none."
          />
          <q-input
            v-model="terms"
            outlined
            autogrow
            type="textarea"
            label="Terms"
            :maxlength="ROOM_LIMITS.terms"
            counter
            hint="What members accept before they enter. Leave a blank line between paragraphs."
          />
          <q-banner v-if="newTerms" class="bg-blue-1 text-black" rounded dense>
            <template #avatar><q-icon name="info" /></template>
            Saved, these become version {{ nextVersion }} of the terms: everyone in the room goes back to the door and
            accepts them to come back.
          </q-banner>
          <div class="text-caption text-grey-7">
            Keep the terms true to how the room works. The room itself is set in code, not here: messages are deleted after
            90 days and done action items 90 days after they are done, the assistant runs on the party’s own servers, and
            members use /memory, /forget and /leave-room.
          </div>
        </q-card-section>
        <q-card-actions class="q-px-md q-pb-md">
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="newTerms ? 'Save the new terms…' : 'Save'"
            :disable="!newIntro && !newTerms"
            :loading="saving"
            @click="saveWords"
          />
          <q-btn flat no-caps label="Discard changes" :disable="!newIntro && !newTerms" @click="load" />
          <q-btn flat no-caps label="Use the original wording" :disable="original" @click="useOriginal" />
        </q-card-actions>
      </q-card>

      <div class="text-caption text-grey-7">
        In the room itself, a Membership Admin can also switch just the assistant off with <code>/assistant off</code>
        (now {{ settings.assistantOn ? 'on' : 'off' }}){{ settings.pending ? `; ${settings.pending} question(s) waiting` : '' }}.
      </div>
    </template>
  </div>
</template>

<style scoped>
.room-panel,
.room-door {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
