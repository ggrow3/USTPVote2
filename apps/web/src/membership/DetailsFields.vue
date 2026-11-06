<script setup lang="ts">
import type { FieldErrors } from '../forms.js';
import type { DetailsForm } from './member-text.js';
import PlaceFields from './PlaceFields.vue';

/** Preferred name, where a member lives and their phone: the application's fields, for changing them later. */
const form = defineModel<DetailsForm>({ required: true });
const props = defineProps<{
  errors: FieldErrors;
  /** The signed-in person's own details, which the browser may fill in; off for someone else's. */
  own?: boolean;
  /** City and ZIP code may be left out, as when a Membership Admin adds a member (design §5.13). */
  optionalContact?: boolean;
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
  <PlaceFields v-model="form" :errors="errors" :own="own" :optional-contact="optionalContact" />
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
