<script setup lang="ts">
/** The authenticator-code step of a sign-in to an account with two-step verification (design §4). */
defineProps<{ busy: boolean }>();
const code = defineModel<string>('code', { required: true });
defineEmits<{ submit: []; cancel: [] }>();
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <h2 class="text-subtitle1">Two-step verification</h2>
      <div class="text-caption text-grey-7">Enter the 6-digit code from your authenticator app.</div>
    </q-card-section>
    <q-card-section>
      <q-form class="ustp-form" @submit.prevent="$emit('submit')">
        <q-input
          v-model="code"
          outlined
          dense
          autofocus
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          label="Code"
        />
        <div class="ustp-actions">
          <q-btn type="submit" color="primary" label="Verify" :loading="busy" />
          <q-btn flat no-caps label="Use a different sign-in" :disable="busy" @click="$emit('cancel')" />
        </div>
      </q-form>
    </q-card-section>
  </q-card>
</template>
