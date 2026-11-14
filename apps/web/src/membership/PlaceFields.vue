<script setup lang="ts">
import { computed, ref } from 'vue';
import { countryAsked, DEFAULT_COUNTRY, DEFAULT_PLACE_RULES, foldName, type PlaceRules } from 'ustp-domain';
import type { FieldErrors } from '../forms.js';
import { COUNTRY_OPTIONS, STATE_OPTIONS, type PlaceForm } from './member-text.js';

/**
 * Where someone lives (design §5.2): the country, then in the United States the state, city and ZIP code; elsewhere
 * the state, province or region, city and postcode, all optional. The registration form's settings say which of them
 * are asked and which are needed in the United States (`rules`). The application and the details forms share it.
 */
const place = defineModel<PlaceForm>({ required: true });
const props = defineProps<{
  errors: FieldErrors;
  /** The signed-in person's own details, which the browser may fill in; off for someone else's. */
  own?: boolean;
  /** City and ZIP code may be left out in the US too, as when a Membership Admin adds a member (design §5.13). */
  optionalContact?: boolean;
  /** Which fields are asked and which are needed; everything, when not given. */
  rules?: PlaceRules;
}>();
const auto = (token: string) => (props.own ? token : 'off');
const asked = computed<PlaceRules>(() => {
  const rules = props.rules ?? DEFAULT_PLACE_RULES;
  return props.optionalContact ? { ...rules, city: 'optional', postalCode: 'optional' } : rules;
});
/** Without the country, everyone is taken to live in the United States. */
const us = computed(() => countryAsked(place.value, asked.value) === DEFAULT_COUNTRY);
const label = (text: string, field: 'state' | 'city' | 'postalCode') =>
  us.value && asked.value[field] === 'required' ? text : `${text} (optional)`;

/** Typing in the country picker narrows its list, with or without accents ("aland" finds Åland Islands). */
const typed = ref('');
const countryOptions = computed(() => {
  const text = foldName(typed.value.trim());
  return text ? COUNTRY_OPTIONS.filter((o) => foldName(o.label).includes(text)) : COUNTRY_OPTIONS;
});
</script>

<template>
  <q-select
    v-if="asked.country !== 'hidden'"
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
  <template v-if="asked.state !== 'hidden'">
    <q-select
      v-if="us"
      v-model="place.state"
      outlined
      dense
      hide-bottom-space
      emit-value
      map-options
      :clearable="asked.state !== 'required'"
      :options="STATE_OPTIONS"
      :label="label('State or territory', 'state')"
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
  </template>
  <div v-if="asked.city !== 'hidden' || asked.postalCode !== 'hidden'" class="ustp-row">
    <q-input
      v-if="asked.city !== 'hidden'"
      v-model="place.city"
      class="ustp-row__wide"
      outlined
      dense
      hide-bottom-space
      :label="label('City', 'city')"
      :autocomplete="auto('address-level2')"
      :error="!!errors.city"
      :error-message="errors.city"
    />
    <q-input
      v-if="asked.postalCode !== 'hidden'"
      v-model="place.postalCode"
      outlined
      dense
      hide-bottom-space
      :label="us ? label('ZIP code', 'postalCode') : 'Postcode (optional)'"
      :inputmode="us ? 'numeric' : 'text'"
      :autocomplete="auto('postal-code')"
      :error="!!errors.postalCode"
      :error-message="errors.postalCode"
    />
  </div>
</template>
