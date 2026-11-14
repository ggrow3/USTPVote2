<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  DISCORD_FEED_KINDS,
  DISCORD_KIND_LABELS,
  DISCORD_LOOP_LABELS,
  DISCORD_LOOPS,
  DISCORD_POLL_ANSWER_LIMIT,
  DISCORD_POLL_QUESTION_LIMIT,
  discordKindPhrase,
  discordQuestionSchema,
  discordRolesSet,
  discordSettingsSchema,
  type DiscordAdminView,
  type DiscordFeedKind,
  type DiscordLoop,
} from 'ustp-domain';
import { announce, focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { addDiscordQuestion, discordView, postDiscordStartHere, removeDiscordQuestion, saveDiscordSettings, sendDiscordTest } from './api.js';
import {
  CHANNEL_HELP,
  COMMANDS_INTRO,
  commandsText,
  DISCORD_INTRO,
  DISCORD_NEVER,
  discordBlockers,
  discordStateText,
  linkBlockerText,
  linkProblems,
  linksText,
  LOOPS_HELP,
  MEMBERS_LOOP_HELP,
  postStatusText,
  QUESTIONS_INTRO,
  questionStatusText,
  ROLE_HELP,
  START_HERE_INTRO,
  startHereText,
  testText,
} from './discord-text.js';

/**
 * The Discord bot (design §10.18), for Communications Admins: whether the app posts to the party's Discord server, the
 * channel for each kind of post, a test post to each, the weekly posts and their questions, the Start here message,
 * the server and role linked members get, where its slash commands stand, and what it posted lately. The bot's token
 * and the client secret that linking needs are a System Admin's to add, under Admin › API keys.
 */
const view = ref<DiscordAdminView | null>(null);
const enabled = ref(false);
const channels = ref<Record<DiscordFeedKind, string>>({ news: '', votes: '', events: '', legislation: '', courses: '', community: '' });
const guildId = ref('');
const memberRoleId = ref('');
const loops = ref<Record<DiscordLoop, boolean>>({ digest: false, question: false, members: false });
const question = ref('');
const answers = ref('');
const questionErrors = ref<FieldErrors>({});
const working = ref(false);
const errors = ref<FieldErrors>({});
const saving = ref(false);
let poll: ReturnType<typeof setTimeout> | null = null;

const blockers = computed(() => (view.value ? discordBlockers(view.value) : []));

function show(next: DiscordAdminView, form = true) {
  view.value = next;
  if (form) {
    enabled.value = next.settings.enabled;
    for (const kind of DISCORD_FEED_KINDS) channels.value[kind] = next.settings.channels[kind] ?? '';
    guildId.value = next.settings.guildId ?? '';
    memberRoleId.value = next.settings.memberRoleId ?? '';
    loops.value = { ...next.settings.loops };
  }
  // A test post and the Start here message go with the worker's next tick: look again until they have.
  if (poll) clearTimeout(poll);
  poll = next.test?.status === 'waiting' || next.startHere?.status === 'waiting' ? setTimeout(refresh, 15_000) : null;
}

async function refresh() {
  try {
    const before = view.value?.test?.status;
    const startBefore = view.value?.startHere?.status;
    const next = await discordView();
    show(next, false);
    if (before === 'waiting' && next.test && next.test.status !== 'waiting') announce(testText(next.test));
    if (startBefore === 'waiting' && next.startHere && next.startHere.status !== 'waiting') announce(startHereText(next.startHere));
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
    guildId: guildId.value.trim() || null,
    memberRoleId: memberRoleId.value.trim() || null,
    loops: { ...loops.value },
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

const rolesSet = computed(() => !!view.value && discordRolesSet(view.value.settings));
const waitingQuestions = computed(() => view.value?.questions.filter((q) => q.status === 'waiting') ?? []);

/** The Start here message goes to the community channel as saved. */
const canStartHere = computed(
  () =>
    !!view.value &&
    view.value.mode !== 'off' &&
    view.value.canLink &&
    !!view.value.tokenSet &&
    !!view.value.settings.channels.community &&
    channels.value.community.trim() === view.value.settings.channels.community &&
    view.value.startHere?.status !== 'waiting',
);

async function startHere() {
  await attempt(async () => {
    show(await postDiscordStartHere(), false);
    announce('The Start here message goes within a minute.');
  });
}

async function addQuestion() {
  const input = {
    question: question.value,
    answers: answers.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  };
  const checked = validate(discordQuestionSchema, input);
  if (!checked.ok) {
    questionErrors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  questionErrors.value = {};
  working.value = true;
  try {
    show(await addDiscordQuestion(checked.data), false);
    question.value = '';
    answers.value = '';
    announce('The question is added to the end of the line.');
  } catch (e) {
    questionErrors.value = apiFieldErrors(e);
    if (Object.keys(questionErrors.value).length) await focusFirstInvalid();
    else await attempt(() => Promise.reject(e));
  } finally {
    working.value = false;
  }
}

async function removeQuestion(questionId: string) {
  await attempt(async () => {
    show(await removeDiscordQuestion(questionId), false);
    announce('The question is removed.');
  });
}

/** The first of the answers' errors, whichever line it is about. */
const answersError = computed(() => Object.entries(questionErrors.value).find(([field]) => field === 'answers' || field.startsWith('answers.'))?.[1]);

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

          <h3 class="text-subtitle2 q-mb-none">Weekly posts</h3>
          <q-toggle v-for="loop in DISCORD_LOOPS" :key="loop" v-model="loops[loop]" :label="DISCORD_LOOP_LABELS[loop]" :disable="saving" />
          <div class="text-caption text-grey-7">{{ LOOPS_HELP }} {{ MEMBERS_LOOP_HELP }}</div>

          <h3 class="text-subtitle2 q-mb-none">The Member role</h3>
          <div class="ustp-row">
            <q-input
              v-model="guildId"
              outlined
              dense
              class="ustp-row__wide"
              inputmode="numeric"
              autocomplete="off"
              spellcheck="false"
              name="discord-guild"
              label="Server ID"
              :error="!!errors.guildId"
              :error-message="errors.guildId"
              :disable="saving"
            />
            <q-input
              v-model="memberRoleId"
              outlined
              dense
              class="ustp-row__wide"
              inputmode="numeric"
              autocomplete="off"
              spellcheck="false"
              name="discord-member-role"
              label="Member role ID"
              :error="!!errors.memberRoleId"
              :error-message="errors.memberRoleId"
              :disable="saving"
            />
          </div>
          <div class="text-caption text-grey-7">{{ ROLE_HELP }}</div>
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" label="Save" :loading="saving" />
          </div>
        </q-form>
      </q-card-section>
    </q-card>

    <section aria-labelledby="discord-links-heading">
      <h2 id="discord-links-heading" class="text-subtitle1">Linked members</h2>
      <p class="q-my-none" role="status">
        <q-icon :name="view.linkBlocker ? 'info' : 'check_circle'" size="20px" aria-hidden="true" class="q-mr-xs" />{{ linkBlockerText(view.linkBlocker) ?? 'Members can connect Discord on their Account page.' }}
      </p>
      <p class="q-mb-none">{{ linksText(view.links, rolesSet) }}</p>
      <ul v-if="linkProblems(view.links, rolesSet).length" class="discord-blockers">
        <li v-for="p in linkProblems(view.links, rolesSet)" :key="p">{{ p }}</li>
      </ul>
    </section>

    <section aria-labelledby="discord-start-heading">
      <h2 id="discord-start-heading" class="text-subtitle1">Start here message</h2>
      <p class="text-body2 q-mt-none">{{ START_HERE_INTRO }}</p>
      <p class="q-mt-none" role="status">
        <q-icon
          :name="view.startHere?.status === 'failed' ? 'warning' : view.startHere?.status === 'posted' ? 'check_circle' : view.startHere ? 'schedule' : 'info'"
          size="20px"
          aria-hidden="true"
          class="q-mr-xs"
        />{{ startHereText(view.startHere) }}
      </p>
      <q-btn outline no-caps color="primary" icon="push_pin" :label="view.startHere?.messageId ? 'Bring the Start here message up to date' : 'Post the Start here message'" :disable="!canStartHere" @click="startHere" />
    </section>

    <section aria-labelledby="discord-questions-heading">
      <h2 id="discord-questions-heading" class="text-subtitle1">Questions of the week</h2>
      <p class="text-body2 q-mt-none">{{ QUESTIONS_INTRO }}</p>
      <div v-if="view.questions.length === 0" class="text-grey-7 q-mb-md">No question is waiting.</div>
      <q-list v-else bordered separator class="rounded-borders q-mb-md">
        <q-item v-for="q in view.questions" :key="q.questionId">
          <q-item-section>
            <q-item-label>{{ q.question }}</q-item-label>
            <q-item-label caption>{{ q.answers.join(' · ') }}</q-item-label>
            <q-item-label caption>{{ questionStatusText(q, waitingQuestions.indexOf(q)) }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="q.status === 'waiting'" side>
            <q-btn flat no-caps color="negative" icon="delete" label="Remove" :aria-label="`Remove the question: ${q.question}`" @click="removeQuestion(q.questionId)" />
          </q-item-section>
        </q-item>
      </q-list>
      <q-form class="ustp-form" novalidate @submit.prevent="addQuestion">
        <q-input
          v-model="question"
          outlined
          dense
          name="discord-question"
          label="Question"
          :maxlength="DISCORD_POLL_QUESTION_LIMIT"
          counter
          :error="!!questionErrors.question"
          :error-message="questionErrors.question"
          :disable="working"
        />
        <q-input
          v-model="answers"
          outlined
          dense
          type="textarea"
          autogrow
          name="discord-answers"
          label="Answers, one to a line"
          :hint="`Two to ten answers, each up to ${DISCORD_POLL_ANSWER_LIMIT} characters.`"
          :error="!!answersError"
          :error-message="answersError"
          :disable="working"
        />
        <div class="ustp-actions">
          <q-btn type="submit" outline no-caps color="primary" icon="add" label="Add question" :loading="working" />
        </div>
      </q-form>
    </section>

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
