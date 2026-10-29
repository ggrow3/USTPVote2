<script setup lang="ts">
import { reactive, ref } from 'vue';
import { createPostSchema, editPostSchema, FORUM_LIMITS, FORUM_POST_KINDS, type ForumPostKind } from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { KIND_CAPTIONS, KIND_LABELS } from './forum-text.js';

/**
 * A new post (its kind, title and text) or the author's change to one (title and text; the kind stays). `save` gets
 * the checked input; an error it throws is shown, by its fields where the API names them.
 */
const props = defineProps<{
  initial?: { kind: ForumPostKind; title: string; body: string };
  /** Editing keeps the kind. */
  editing?: boolean;
  save: (input: { kind: ForumPostKind; title: string; body: string }) => Promise<unknown>;
}>();
const emit = defineEmits<{ done: []; cancel: [] }>();

const form = reactive({ kind: props.initial?.kind ?? 'discussion', title: props.initial?.title ?? '', body: props.initial?.body ?? '' });
const errors = ref<FieldErrors>({});
const busy = ref(false);
const kinds = FORUM_POST_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }));

async function submit() {
  const checked = props.editing
    ? validate(editPostSchema, { title: form.title, body: form.body })
    : validate(createPostSchema, { kind: form.kind, title: form.title, body: form.body });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  busy.value = true;
  const saved = await attempt(async () => {
    try {
      await props.save({ kind: form.kind, title: checked.data.title, body: checked.data.body });
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  });
  busy.value = false;
  if (saved) emit('done');
}
</script>

<template>
  <q-form class="ustp-form" @submit.prevent="submit">
    <div v-if="!editing">
      <q-btn-toggle v-model="form.kind" no-caps unelevated toggle-color="primary" :options="kinds" aria-label="Kind of post" />
      <div class="text-caption text-grey-7 q-mt-xs">{{ KIND_CAPTIONS[form.kind] }}</div>
    </div>
    <q-input
      v-model="form.title"
      outlined
      label="Title"
      :maxlength="FORUM_LIMITS.title"
      counter
      :error="!!errors.title"
      :error-message="errors.title"
      autofocus
    />
    <q-input
      v-model="form.body"
      outlined
      type="textarea"
      autogrow
      :label="form.kind === 'proposal' ? 'The proposal’s text' : 'Text (optional)'"
      :hint="form.kind === 'proposal' ? 'Write it as it would go on a ballot. Leave a blank line between paragraphs.' : 'Leave a blank line between paragraphs; links work.'"
      :maxlength="FORUM_LIMITS.body"
      input-style="min-height: 8em"
      :error="!!errors.body"
      :error-message="errors.body"
    />
    <div class="ustp-actions">
      <q-btn unelevated no-caps color="primary" type="submit" :loading="busy" :label="editing ? 'Save' : 'Post'" />
      <q-btn flat no-caps label="Cancel" @click="emit('cancel')" />
    </div>
  </q-form>
</template>
