<script setup lang="ts">
import { usePageTitle } from '../a11y.js';

usePageTitle('Member voting');
</script>

<template>
  <q-page padding>
    <h1 class="text-h5 q-mb-md">United States Transhumanist Party — Member Voting</h1>
    <p>Register as a member, cast your ballot, and independently verify that it was counted.</p>
    <div class="row q-gutter-sm">
      <q-btn color="primary" to="/register" label="Register" />
      <q-btn color="primary" outline to="/ballot" label="Vote" />
      <q-btn color="primary" outline to="/verify" label="Verify a receipt" />
    </div>
  </q-page>
</template>
