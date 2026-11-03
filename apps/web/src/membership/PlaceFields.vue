<script setup lang="ts">
import { computed, ref } from 'vue';
import { DEFAULT_COUNTRY, foldName } from 'ustp-domain';
import type { FieldErrors } from '../forms.js';
import { COUNTRY_OPTIONS, STATE_OPTIONS, type PlaceForm } from './member-text.js';

/**
 * Where someone lives (design §5.2): the country, then in the United States the state, city and ZIP code, all needed;
 * elsewhere the state, province or region, city and postcode, all optional. The application and the details forms
 * share it.
 */
const place = defineModel<PlaceForm>({ required: true });
const props = defineProps<{
  errors: FieldErrors;
  /** The signed-in person's own details, which the browser may fill in; off for someone else's. */
  own?: boolean;
  /** City and ZIP code may be left out in the US too, as when a Membership Admin adds a member (design §5.13). */
  optionalContact?: boolean;
}>();
const auto = (token: string) => (props.own ? token : 'off');
const us = computed(() => place.value.country === DEFAULT_COUNTRY);

/** Typing in the country picker narrows its list, with or without accents ("aland" finds Åland Islands). */
const typed = ref('');
const countryOptions = computed(() => {
  const text = foldName(typed.value.trim());
  return text ? COUNTRY_OPTIONS.filter((o) => foldName(o.label).includes(text)) : COUNTRY_OPTIONS;
});
</script>

<template>
  <q-select
    v-model="place.country"
    outlined
    dense
    hide-bottom-space
    emit-value
    map-options
    use-input
    fill-input
    hide-selected
    input-debounce="0"
    :options="countryOptions"
    label="Country"
    :error="!!errors.country"
    :error-message="errors.country"
    @filter="(text: string, update: (fn: () => void) => void) => update(() => (typed = text))"
  >
    <template #no-option>
      <q-item><q-item-section class="text-grey-7">No country matches</q-item-section></q-item>
    </template>
  </q-select>
  <q-select
    v-if="us"
    v-model="place.state"
    outlined
    dense
    hide-bottom-space
    emit-value
    map-options
    :options="STATE_OPTIONS"
    label="State or territory"
    :error="!!errors.state"
    :error-message="errors.state"
  />
  <q-input
    v-else
    v-model="place.region"
    outlined
    dense
    hide-bottom-space
    label="State, province or region (optional)"
    :autocomplete="auto('address-level1')"
    :error="!!errors.region"
    :error-message="errors.region"
  />
  <div class="ustp-row">
    <q-input
      v-model="place.city"
      class="ustp-row__wide"
      outlined
      dense
      hide-bottom-space
      :label="us && !optionalContact ? 'City' : 'City (optional)'"
      :autocomplete="auto('address-level2')"
      :error="!!errors.city"
      :error-message="errors.city"
    />
    <q-input
      v-model="place.postalCode"
      outlined
      dense
      hide-bottom-space
      :label="us ? (optionalContact ? 'ZIP code (optional)' : 'ZIP code') : 'Postcode (optional)'"
      :inputmode="us ? 'numeric' : 'text'"
      :autocomplete="auto('postal-code')"
      :error="!!errors.postalCode"
      :error-message="errors.postalCode"
    />
  </div>
</template>
