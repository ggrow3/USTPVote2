<script setup lang="ts">
import { usePageTitle } from '../a11y.js';
import { canRegister } from '../session.js';

usePageTitle('Member voting');
</script>

<template>
  <q-page padding>
    <div class="ustp-content">
      <h1 class="text-h5">United States Transhumanist Party — Member Voting</h1>
      <p v-if="canRegister">Register as a member, cast your ballot, and independently verify that it was counted.</p>
      <p v-else>Cast your ballot, and independently verify that it was counted.</p>
      <div class="ustp-actions">
        <!-- Registered members no longer see Register, and Vote becomes the main action. -->
        <q-btn v-if="canRegister" color="primary" to="/register" label="Register" />
        <q-btn color="primary" :outline="canRegister" to="/ballot" label="Vote" />
        <q-btn color="primary" outline to="/verify" label="Verify a receipt" />
      </div>
    </div>
  </q-page>
</template>
