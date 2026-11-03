<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldErrors } from '../forms.js';
import { COUNTRY_OPTIONS, STATE_OPTIONS, type DetailsForm } from './member-text.js';

/**
 * Preferred name, where a member lives and their phone: the application's fields, for changing them later. A member a
 * Membership Admin recorded as living outside the US (design §5.13) has a country instead of a US state and ZIP code.
 */
const form = defineModel<DetailsForm>({ required: true });
const props = defineProps<{
  errors: FieldErrors;
  /** The signed-in person's own details, which the browser may fill in; off for someone else's. */
  own?: boolean;
  /** City and postal code may be left empty, as when a Membership Admin adds a member (design §5.13). */
  optionalContact?: boolean;
}>();
const auto = (token: string) => (props.own ? token : 'off');

const abroad = computed({
  get: () => form.value.country !== null,
  set: (on: boolean) => (form.value.country = on ? (form.value.country ?? '') : null),
});
/** The country picker's options, narrowed by what has been typed. */
const countries = ref(COUNTRY_OPTIONS);
function filterCountries(typed: string, update: (fn: () => void) => void) {
  const wanted = typed.trim().toLowerCase();
  update(() => (countries.value = wanted ? COUNTRY_OPTIONS.filter((c) => c.label.toLowerCase().includes(wanted)) : COUNTRY_OPTIONS));
}
</script>

<template>
  <q-input
    v-model="form.preferredName"
    outlined
    dense
    hide-bottom-space
    label="Preferred name (optional)"
    :autocomplete="auto('nickname')"
    :error="!!errors.preferredName"
    :error-message="errors.preferredName"
  />
  <q-toggle v-model="abroad" :label="own ? 'I live outside the United States' : 'Lives outside the United States'" />
  <q-select
    v-if="abroad"
    v-model="form.country"
    outlined
    dense
    hide-bottom-space
    emit-value
    map-options
    use-input
    input-debounce="0"
    :options="countries"
    label="Country"
    :error="!!errors.country"
    :error-message="errors.country"
    @filter="filterCountries"
  />
  <q-select
    v-model="form.state"
    outlined
    dense
    hide-bottom-space
    emit-value
    map-options
    :clearable="abroad"
    :options="STATE_OPTIONS"
    :label="abroad ? `US state or territory ${own ? 'you' : 'they'} vote in (optional)` : 'State or territory'"
    :error="!!errors.state"
    :error-message="errors.state"
  />
  <div class="ustp-row">
    <q-input
      v-model="form.city"
      class="ustp-row__wide"
      outlined
      dense
      hide-bottom-space
      :label="optionalContact ? 'City (optional)' : 'City'"
      :autocomplete="auto('address-level2')"
      :error="!!errors.city"
      :error-message="errors.city"
    />
    <q-input
      v-model="form.postalCode"
      outlined
      dense
      hide-bottom-space
      :label="abroad ? 'Postal code (optional)' : optionalContact ? 'ZIP code (optional)' : 'ZIP code'"
      :inputmode="abroad ? 'text' : 'numeric'"
      :autocomplete="auto('postal-code')"
      :error="!!errors.postalCode"
      :error-message="errors.postalCode"
    />
  </div>
  <q-input
    v-model="form.phone"
    outlined
    dense
    hide-bottom-space
    type="tel"
    label="Phone (optional)"
    :autocomplete="auto('tel')"
    :error="!!errors.phone"
    :error-message="errors.phone"
  />
</template>
