<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { isUnsubscribeToken } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { confirmNewsletter, newsletterConfirmStatus } from './api.js';

/**
 * Where the newsletter's confirmation email leads (design §10.15), with no sign-in. Opening it changes nothing, since
 * mail scanners open links by themselves: the button confirms. The page never says whose address it is.
 */
usePageTitle('Confirm your sign-up');
const route = useRoute();
const token = computed(() => (isUnsubscribeToken(route.query.token) ? route.query.token : null));
const state = ref<'loading' | 'invalid' | 'ready' | 'done' | 'failed'>('loading');
const problem = ref('');
const working = ref(false);

function failed(e: unknown) {
  state.value = e instanceof ApiError && e.status === 404 ? 'invalid' : 'failed';
  problem.value = errorMessage(e);
}

onMounted(async () => {
  if (!token.value) {
    state.value = 'invalid';
    return;
  }
  try {
    state.value = (await newsletterConfirmStatus(token.value)).confirmed ? 'done' : 'ready';
  } catch (e) {
    failed(e);
  }
});

async function confirm() {
  working.value = true;
  try {
    await confirmNewsletter(token.value!);
    state.value = 'done';
  } catch (e) {
    failed(e);
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <PageShell>
    <div v-if="state === 'ready'" class="ustp-content">
      <h1 class="text-h5 q-my-none">Confirm your sign-up</h1>
      <p>Press Confirm to get the U.S. Transhumanist Party's newsletter at the address this link was sent to.</p>
      <div class="ustp-actions">
        <q-btn color="primary" no-caps label="Confirm" :loading="working" @click="confirm" />
      </div>
      <p class="text-caption text-grey-7">Did not sign up? Close this page: without confirming, nothing more comes, and the address is deleted.</p>
    </div>

    <div v-else-if="state === 'done'" class="ustp-content" role="status">
      <h1 class="text-h5 q-my-none">You are on the list</h1>
      <p>The next newsletter comes to you. Each one has a link to leave the list, which deletes your address.</p>
      <p>
        Want more than news? <router-link to="/register">Apply to join the party</router-link>, or look around the
        <router-link to="/courses">free courses</router-link>.
      </p>
    </div>

    <div v-else-if="state === 'invalid'" class="ustp-content">
      <h1 class="text-h5 q-my-none">This link does not work</h1>
      <p>
        It may be from an older email: only the latest confirmation link works, and a sign-up never confirmed is deleted
        after a week. <router-link to="/newsletter">Sign up again</router-link> to get a new one.
      </p>
    </div>

    <div v-else-if="state === 'failed'" class="ustp-content">
      <h1 class="text-h5 q-my-none">Something went wrong</h1>
      <p role="alert">Your sign-up is not confirmed yet: {{ problem }}. Open the link in your email again in a little while.</p>
    </div>

    <q-spinner v-else size="32px" aria-label="Loading" />
  </PageShell>
</template>
