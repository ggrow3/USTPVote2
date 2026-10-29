<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ElectionRecord, ForumPostView, ForumThread } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { PASS_RULE_PRESETS } from '../election-text.js';
import { draftElections, putOnBallot } from './api.js';

/**
 * An Election Admin puts a proposal on a draft election (design §5.9): the question's title (the post's, unless they
 * change it) and when it passes. Its text is frozen as the post reads now; quorum and the rest are set in the election
 * editor afterwards, like any question.
 */
const props = defineProps<{ post: ForumPostView }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ added: [thread: ForumThread] }>();

const elections = ref<ElectionRecord[] | null>(null);
const electionId = ref<string | null>(null);
const title = ref('');
const preset = ref(0);
const busy = ref(false);
const presets = PASS_RULE_PRESETS.map((p, i) => ({ value: i, label: p.label }));
const options = computed(() => (elections.value ?? []).map((e) => ({ value: e.electionId, label: e.title })));
const chosen = computed(() => elections.value?.find((e) => e.electionId === electionId.value) ?? null);

watch(open, async (shown) => {
  if (!shown) return;
  title.value = props.post.title;
  preset.value = 0;
  electionId.value = null;
  elections.value = null;
  await attempt(async () => {
    elections.value = await draftElections();
    if (elections.value.length === 1) electionId.value = elections.value[0]!.electionId;
  });
});

async function add() {
  if (!electionId.value) return;
  busy.value = true;
  let thread: ForumThread | null = null;
  const done = await attempt(async () => {
    thread = await putOnBallot(props.post.postId, {
      electionId: electionId.value!,
      title: title.value.trim() || null,
      passRule: PASS_RULE_PRESETS[preset.value]!.value,
    });
  }, `Added to ${chosen.value?.title ?? 'the election'}`);
  busy.value = false;
  if (done && thread) {
    emit('added', thread);
    open.value = false;
  }
}
</script>

<template>
  <q-dialog v-model="open" aria-label="Put on a ballot">
    <q-card class="forum-dialog">
      <q-card-section>
        <h2 class="text-h6">Put on a ballot</h2>
        <div class="text-caption text-grey-7">
          Adds this proposal to a draft election as a yes/no question. Its text goes on the ballot exactly as it reads
          now, and the author can no longer change it. An Auditor still approves the election before it is scheduled.
        </div>
      </q-card-section>
      <q-card-section class="ustp-form">
        <div v-if="!elections" class="text-grey-7">Loading the draft elections…</div>
        <q-banner v-else-if="!elections.length" class="bg-blue-1 text-black" rounded>
          There is no draft election. Create one under Admin › Elections, then come back.
        </q-banner>
        <template v-else>
          <q-select v-model="electionId" outlined emit-value map-options :options="options" label="Election" />
          <q-input v-model="title" outlined label="Question title" hint="What the ballot calls it" maxlength="200" />
          <q-select v-model="preset" outlined emit-value map-options :options="presets" label="Passes with" />
        </template>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Cancel" @click="open = false" />
        <q-btn unelevated no-caps color="primary" label="Add to the election" :disable="!electionId" :loading="busy" @click="add" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.forum-dialog {
  width: min(560px, 100vw - 32px);
}
</style>
