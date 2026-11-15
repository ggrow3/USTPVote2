<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { fillTemplate, phoneLink, placeholderValues, templatesFor, type AreaContact, type EmailTemplate } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { districtText } from './candidacy-text.js';

/**
 * A phone call to a representative's office, from the Representatives page (design §5.19): the office's number, which
 * a phone dials at a tap, and a script to read out, chosen from the call scripts that suit the person and filled in
 * for them. The site places no call and keeps no record of one.
 */
const props = defineProps<{
  /** Whom the call is to; null while the dialog is closed. */
  modelValue: AreaContact | null;
  templates: readonly EmailTemplate[];
  /** The caller's name, for `{myName}`. */
  myName: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [contact: AreaContact | null] }>();

const open = computed({
  get: () => props.modelValue !== null,
  set: (v) => {
    if (!v) emit('update:modelValue', null);
  },
});

const offered = computed(() => (props.modelValue ? templatesFor(props.templates, props.modelValue, 'call') : []));
const scriptId = ref<string | null>(null);
watch(
  () => props.modelValue,
  () => (scriptId.value = offered.value[0]?.templateId ?? null),
  { immediate: true },
);
const options = computed(() => offered.value.map((t) => ({ value: t.templateId, label: t.name })));

/** The chosen script, filled in for the person. */
const script = computed(() => {
  const contact = props.modelValue;
  const chosen = offered.value.find((t) => t.templateId === scriptId.value);
  return contact && chosen ? fillTemplate(chosen.body, placeholderValues(contact, districtText(contact), props.myName)) : null;
});
const dial = computed(() => (props.modelValue?.phone ? phoneLink(props.modelValue.phone) : null));

const copy = () => attempt(() => navigator.clipboard.writeText(script.value ?? ''), 'Copied');
</script>

<template>
  <q-dialog v-model="open">
    <q-card v-if="modelValue" class="area-call">
      <q-card-section>
        <h2 class="text-h6 q-my-none">Call {{ modelValue.name }}</h2>
        <div class="text-grey-7">{{ modelValue.officeTitle }} · {{ districtText(modelValue) }}</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div v-if="modelValue.phone && dial" class="area-call__number">
          <q-icon name="call" size="22px" class="q-mr-sm" aria-hidden="true" />
          <a :href="dial" :aria-label="`Call ${modelValue.name}’s office at ${modelValue.phone}`">{{ modelValue.phone }}</a>
        </div>
        <q-banner v-else dense rounded class="bg-grey-3 text-black">
          No phone number is listed for {{ modelValue.name }}.
          <template v-if="modelValue.website">Their website lists their offices.</template>
        </q-banner>
        <div class="text-grey-7 q-mt-sm">
          You will most likely speak to a member of staff, or leave a message. Say where you live, say what you are asking
          for, and keep it short: offices count calls by subject.
        </div>
      </q-card-section>
      <q-card-section v-if="options.length" class="q-pt-none">
        <q-select v-model="scriptId" outlined dense emit-value map-options :options="options" label="What to say" class="q-mb-sm" />
        <div v-if="script" class="area-call__script" tabindex="0" role="group" aria-label="Call script">{{ script }}</div>
      </q-card-section>
      <q-card-actions align="left" class="q-px-md q-pb-md">
        <q-btn v-if="dial" unelevated no-caps color="primary" icon="call" label="Call now" :href="dial" />
        <q-btn v-if="script" outline no-caps color="primary" icon="content_copy" label="Copy script" @click="copy" />
        <q-btn
          v-if="!dial && modelValue.website"
          flat
          no-caps
          color="primary"
          icon="open_in_new"
          label="Open their website"
          :href="modelValue.website"
          target="_blank"
          rel="noopener noreferrer"
        />
        <q-btn v-close-popup flat no-caps label="Close" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.area-call {
  width: 640px;
  max-width: 100%;
}
.area-call__number {
  display: flex;
  align-items: center;
  font-size: 1.5rem;
  font-weight: 500;
}
.area-call__number a {
  color: inherit;
}
.area-call__script {
  white-space: pre-wrap;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.12);
  line-height: 1.6;
}
</style>
