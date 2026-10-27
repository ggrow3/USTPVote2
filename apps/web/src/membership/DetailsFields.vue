<script setup lang="ts">
import type { FieldErrors } from '../forms.js';
import { STATE_OPTIONS, type DetailsForm } from './member-text.js';

/** Preferred name, where a member lives and their phone: the application's fields, for changing them later. */
const form = defineModel<DetailsForm>({ required: true });
const props = defineProps<{
  errors: FieldErrors;
  /** The signed-in person's own details, which the browser may fill in; off for someone else's. */
  own?: boolean;
}>();
const auto = (token: string) => (props.own ? token : 'off');
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
  <q-select
    v-model="form.state"
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
  <div class="ustp-row">
    <q-input
      v-model="form.city"
      class="ustp-row__wide"
      outlined
      dense
      hide-bottom-space
      label="City"
      :autocomplete="auto('address-level2')"
      :error="!!errors.city"
      :error-message="errors.city"
    />
    <q-input
      v-model="form.postalCode"
      outlined
      dense
      hide-bottom-space
      label="ZIP code"
      inputmode="numeric"
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
