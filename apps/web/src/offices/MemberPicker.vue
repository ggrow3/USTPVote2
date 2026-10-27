<script setup lang="ts">
import { onBeforeUnmount, ref, useId } from 'vue';
import type { MemberMatch } from 'ustp-domain';
import { announce } from '../a11y.js';
import { searchMembers } from './api.js';
import { memberCaption } from './office-text.js';

/**
 * Chooses the Active member to appoint (design §6.4): a combobox that searches members by name once typing pauses.
 * Only members can be appointed, so nothing typed counts until a member is chosen.
 */
const props = defineProps<{
  modelValue: MemberMatch | null;
  /** Why a member cannot be chosen here, or null. */
  unavailable: (match: MemberMatch) => string | null;
  error?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [MemberMatch | null] }>();

const SEARCH_DELAY_MS = 300;
const matches = ref<MemberMatch[]>([]);
const statusId = useId();

let timer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(timer));

/** Quasar's filter: searches once typing pauses; a later search supersedes this one. */
function search(text: string, update: (fn: () => void) => void, abort: () => void) {
  clearTimeout(timer);
  const name = text.trim();
  if (!name) {
    update(() => (matches.value = []));
    return;
  }
  timer = setTimeout(async () => {
    try {
      const found = await searchMembers(name);
      update(() => (matches.value = found));
      const choosable = found.filter((m) => !props.unavailable(m)).length;
      announce(
        found.length === 0
          ? 'No Active member matches.'
          : `${found.length} ${found.length === 1 ? 'member matches' : 'members match'}${choosable < found.length ? `, ${choosable} can be chosen` : ''}. Use the down arrow to choose.`,
      );
    } catch {
      abort();
      announce('The member search failed. Try again.');
    }
  }, SEARCH_DELAY_MS);
}

function chose(value: MemberMatch | null) {
  emit('update:modelValue', value);
  if (value) announce(`${value.legalName} chosen.`);
}

/** Typing something else than the chosen name clears the choice. */
function typed(text: string) {
  if (props.modelValue && text !== props.modelValue.legalName) emit('update:modelValue', null);
}
</script>

<template>
  <div>
    <q-select
      :model-value="modelValue"
      outlined
      dense
      hide-bottom-space
      use-input
      hide-selected
      fill-input
      input-debounce="0"
      label="Member"
      :options="matches"
      option-label="legalName"
      option-value="accountId"
      :option-disable="(o: MemberMatch) => !!unavailable(o)"
      :aria-describedby="statusId"
      :error="!!error"
      :error-message="error"
      @filter="search"
      @input-value="typed"
      @update:model-value="chose"
    >
      <template #option="scope">
        <q-item v-bind="scope.itemProps">
          <q-item-section>
            <q-item-label>{{ scope.opt.legalName }}</q-item-label>
            <q-item-label caption>{{ [memberCaption(scope.opt), unavailable(scope.opt)].filter(Boolean).join(' · ') }}</q-item-label>
          </q-item-section>
        </q-item>
      </template>
      <template #no-option="scope">
        <q-item>
          <q-item-section class="text-grey-7">
            {{ scope.inputValue.trim() ? 'No Active member matches.' : 'Type part of a member’s name.' }}
          </q-item-section>
        </q-item>
      </template>
    </q-select>
    <div :id="statusId" class="ustp-message text-grey-7">
      {{ modelValue ? `Appoints ${modelValue.legalName}${modelValue.state ? ` (${modelValue.state})` : ''}.` : 'Type part of an Active member’s name and choose them.' }}
    </div>
  </div>
</template>
