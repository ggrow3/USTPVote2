<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue';
import { NEWSLETTER_PENDING_DAYS, newsletterAddressSchema, type NewsletterLookup, type NewsletterSummary } from 'ustp-domain';
import { attempt, dialog } from '../dialogs.js';
import { lookUpSubscriber, newsletterSummary, removeSubscriber } from './api.js';

/**
 * Admin › Email › Newsletter (design §10.15), for Membership, System and Site Admins: how many are on the newsletter's
 * list and waiting to confirm, and one address at a time, to answer someone who writes in and take them off the list.
 * Never the list itself. Emails to the list are written under "Email members".
 */
const summary = ref<NewsletterSummary | null>(null);
const email = ref('');
const found = ref<(NewsletterLookup & { email: string }) | null>(null);
const problem = ref<string | null>(null);

async function load() {
  await attempt(async () => {
    summary.value = await newsletterSummary();
  });
}
onMounted(load);
onActivated(load);

async function lookUp() {
  problem.value = null;
  found.value = null;
  const checked = newsletterAddressSchema.safeParse({ email: email.value });
  if (!checked.success) {
    problem.value = 'Enter a whole email address.';
    return;
  }
  await attempt(async () => {
    found.value = { ...(await lookUpSubscriber(checked.data.email)), email: checked.data.email };
  });
}

function remove() {
  const address = found.value?.email;
  if (!address) return;
  dialog({
    title: 'Take this address off the list?',
    message: `${address} is deleted from the newsletter's list and gets no more newsletters. Only its owner can sign it up again.`,
    cancel: true,
    ok: { label: 'Take it off', color: 'negative', noCaps: true },
  }).onOk(() => {
    void attempt(async () => {
      await removeSubscriber(address);
      found.value = null;
      email.value = '';
      await load();
    }, 'Taken off the list and deleted.');
  });
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">Newsletter</h2>
      <p class="q-mb-none">
        People not ready to join sign up on the public Newsletter page and confirm from the email that follows. To write to
        them, choose “Newsletter subscribers” under Email members. Unsubscribing deletes their address; a sign-up never
        confirmed is deleted after {{ NEWSLETTER_PENDING_DAYS }} days.
      </p>
    </div>

    <div v-if="summary" class="row q-gutter-md text-body2" role="status">
      <span><strong>{{ summary.confirmed }}</strong> on the list</span>
      <span>{{ summary.confirmedLast30Days }} joined in the last 30 days</span>
      <span>{{ summary.pending }} waiting to confirm</span>
    </div>

    <q-card flat bordered tag="section" aria-labelledby="newsletter-lookup">
      <q-card-section>
        <h3 id="newsletter-lookup" class="text-subtitle2 q-my-none">Find an address</h3>
        <div class="text-caption text-grey-7">For someone who asks whether they are on the list, or to be taken off it. One whole address at a time.</div>
      </q-card-section>
      <q-card-section class="ustp-form q-pt-none">
        <q-form class="row q-col-gutter-sm items-start" @submit.prevent="lookUp">
          <div class="col-12 col-sm-8">
            <q-input v-model="email" outlined dense type="email" label="Email address" :error="!!problem" :error-message="problem ?? undefined" />
          </div>
          <div class="col-12 col-sm-4">
            <q-btn type="submit" outline no-caps label="Find" />
          </div>
        </q-form>
        <div v-if="found" role="status">
          <template v-if="!found.found">{{ found.email }} is not on the list, nor waiting to confirm.</template>
          <template v-else>
            <p class="q-mb-sm">
              {{ found.email }}
              <template v-if="found.status === 'confirmed'">is on the list, since {{ when(found.confirmedAt) }}.</template>
              <template v-else>signed up {{ when(found.signedUpAt) }} and has not confirmed.</template>
            </p>
            <q-btn flat no-caps color="negative" icon="delete" label="Take it off the list" @click="remove" />
          </template>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>
