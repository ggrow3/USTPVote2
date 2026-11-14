<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  DISCORD_FEED_KINDS,
  DISCORD_KIND_LABELS,
  discordKindPhrase,
  discordSettingsSchema,
  type DiscordAdminView,
  type DiscordFeedKind,
} from 'ustp-domain';
import { announce, focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { discordView, saveDiscordSettings, sendDiscordTest } from './api.js';
import { CHANNEL_HELP, COMMANDS_INTRO, commandsText, DISCORD_INTRO, DISCORD_NEVER, discordBlockers, discordStateText, postStatusText, testText } from './discord-text.js';

/**
 * The Discord bot (design §10.18), for Communications Admins: whether the app posts to the party's Discord server, the
 * channel for each kind of post, a test post to each, where its slash commands stand, and what it posted lately. The bot's token is a System Admin's to
 * add, under Admin › API keys.
 */
const view = ref<DiscordAdminView | null>(null);
const enabled = ref(false);
const channels = ref<Record<DiscordFeedKind, string>>({ news: '', votes: '', events: '', legislation: '', courses: '' });
const errors = ref<FieldErrors>({});
const saving = ref(false);
let poll: ReturnType<typeof setTimeout> | null = null;

const blockers = computed(() => (view.value ? discordBlockers(view.value) : []));

function show(next: DiscordAdminView, form = true) {
  view.value = next;
  if (form) {
    enabled.value = next.settings.enabled;
    for (const kind of DISCORD_FEED_KINDS) channels.value[kind] = next.settings.channels[kind] ?? '';
  }
  // A test post goes with the worker's next tick: look again until it has.
  if (poll) clearTimeout(poll);
  poll = next.test?.status === 'waiting' ? setTimeout(refresh, 15_000) : null;
}

async function refresh() {
  try {
    const before = view.value?.test?.status;
    const next = await discordView();
    show(next, false);
    if (before === 'waiting' && next.test && next.test.status !== 'waiting') announce(testText(next.test));
  } catch {
    // The page keeps what it has; the next look, or a reload, says more.
  }
}

async function save() {
  if (!view.value) return;
  const input = {
    basedOn: view.value.settings.version,
    enabled: enabled.value,
    channels: Object.fromEntries(DISCORD_FEED_KINDS.map((kind) => [kind, channels.value[kind].trim() || null])),
  };
  const checked = validate(discordSettingsSchema, input);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  saving.value = true;
  try {
    show(await saveDiscordSettings(checked.data));
    announce('Saved.');
  } catch (e) {
    errors.value = apiFieldErrors(e);
    if (Object.keys(errors.value).length) await focusFirstInvalid();
    else await attempt(() => Promise.reject(e));
  } finally {
    saving.value = false;
  }
}

/** A test goes to the channel as saved, so one typed and not yet saved cannot be tried. */
const canTest = (kind: DiscordFeedKind) =>
  !!view.value && view.value.mode !== 'off' && view.value.canLink && !!view.value.tokenSet && !!view.value.settings.channels[kind] && channels.value[kind].trim() === view.value.settings.channels[kind];

async function test(kind: DiscordFeedKind) {
  await attempt(async () => {
    show(await sendDiscordTest(kind), false);
    announce('The test post goes within a minute.');
  });
}

onMounted(() =>
  attempt(async () => {
    show(await discordView());
  }),
);
onBeforeUnmount(() => {
  if (poll) clearTimeout(poll);
});
</script>

<template>
  <div v-if="view" class="ustp-content">
    <p class="text-body2 q-my-none">{{ DISCORD_INTRO }}</p>
    <p class="text-body2 text-grey-7 q-my-none">{{ DISCORD_NEVER }}</p>

    <q-card flat bordered tag="section" aria-labelledby="discord-settings-heading">
      <q-card-section>
        <h2 id="discord-settings-heading" class="text-subtitle1">Where the bot posts</h2>
        <p class="q-mb-none" role="status">
          <q-icon :name="view.settings.enabled && !blockers.length ? 'check_circle' : 'info'" size="20px" aria-hidden="true" class="q-mr-xs" />{{ discordStateText(view) }}
        </p>
        <ul v-if="blockers.length" class="discord-blockers">
          <li v-for="b in blockers" :key="b">{{ b }}</li>
        </ul>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <q-toggle v-model="enabled" label="Post to Discord" :disable="saving" />
          <div class="text-caption text-grey-7">
            Switched on, the bot starts from that moment: nothing that happened before is posted. {{ CHANNEL_HELP }}
          </div>
          <div v-for="kind in DISCORD_FEED_KINDS" :key="kind" class="ustp-row">
            <q-input
              v-model="channels[kind]"
              outlined
              dense
              class="ustp-row__wide"
              inputmode="numeric"
              autocomplete="off"
              spellcheck="false"
              :name="`discord-channel-${kind}`"
              :label="`${DISCORD_KIND_LABELS[kind]}: channel ID`"
              :error="!!errors[`channels.${kind}`]"
              :error-message="errors[`channels.${kind}`]"
              :disable="saving"
            />
            <q-btn
              flat
              no-caps
              icon="send"
              label="Send a test post"
              :aria-label="`Send a test post to the channel for ${discordKindPhrase(kind)}`"
              :disable="!canTest(kind) || view.test?.status === 'waiting'"
              @click="test(kind)"
            />
          </div>
          <div class="text-caption text-grey-7">
            A test post goes to a channel once it is saved and the bot has its token, whether or not the bot is switched on.
          </div>
          <p v-if="view.test" class="q-mb-none" role="status">
            <q-icon :name="view.test.status === 'failed' ? 'warning' : view.test.status === 'sent' ? 'check_circle' : 'schedule'" size="20px" aria-hidden="true" class="q-mr-xs" />{{ testText(view.test) }}
          </p>
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" label="Save" :loading="saving" />
          </div>
        </q-form>
      </q-card-section>
    </q-card>

    <section aria-labelledby="discord-commands-heading">
      <h2 id="discord-commands-heading" class="text-subtitle1">Slash commands</h2>
      <p class="text-body2 q-mt-none">{{ COMMANDS_INTRO }}</p>
      <p class="q-mb-none" role="status">
        <q-icon :name="view.commands.registered ? 'check_circle' : view.commands.problem ? 'warning' : 'info'" size="20px" aria-hidden="true" class="q-mr-xs" />{{ commandsText(view.commands, view.tokenSet) }}
      </p>
    </section>

    <section aria-labelledby="discord-recent-heading">
      <h2 id="discord-recent-heading" class="text-subtitle1">What the bot posted lately</h2>
      <div v-if="view.recent.length === 0" class="text-grey-7">Nothing yet.</div>
      <q-list v-else bordered separator class="rounded-borders">
        <q-item v-for="p in view.recent" :key="p.ref">
          <q-item-section>
            <q-item-label><a :href="p.url" target="_blank" rel="noopener noreferrer">{{ p.title }}</a></q-item-label>
            <q-item-label caption>{{ DISCORD_KIND_LABELS[p.kind] }} · {{ postStatusText(p) }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="p.status !== 'sent'" side>
            <q-badge :color="p.status === 'failed' ? 'negative' : 'orange-9'" :label="p.status === 'failed' ? 'Not posted' : 'Unfinished'" />
          </q-item-section>
        </q-item>
      </q-list>
    </section>
  </div>
</template>

<style scoped>
.discord-blockers {
  margin: 8px 0 0;
  padding-left: 20px;
}
</style>
