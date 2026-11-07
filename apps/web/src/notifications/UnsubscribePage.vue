<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { isUnsubscribeToken } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { unsubscribeLink, unsubscribeLinkStatus } from './api.js';

/**
 * Where an email's Unsubscribe link leads (design §10.12), with no sign-in. Opening it changes nothing, since mail
 * scanners open links by themselves: the button unsubscribes. The page never says whose link it is.
 */
usePageTitle('Unsubscribe');
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
    state.value = (await unsubscribeLinkStatus(token.value)).unsubscribed ? 'done' : 'ready';
  } catch (e) {
    failed(e);
  }
});

async function unsubscribe() {
  working.value = true;
  try {
    await unsubscribeLink(token.value!);
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
      <h1 class="text-h5 q-my-none">Unsubscribe from party email</h1>
      <p>
        If you unsubscribe, the US Transhumanist Party will send you no more email: no notice that voting has opened, no
        reminder before it closes, and no confirmation that your vote was recorded.
      </p>
      <p>
        You can still sign in and vote, but you will have to check the site for elections yourself, and you will not be
        told by email if someone votes using your account.
      </p>
      <p class="text-caption text-grey-7">Emails you ask for yourself, such as a password reset or a sign-in link, still come.</p>
      <div class="ustp-actions">
        <q-btn color="primary" no-caps label="Unsubscribe" :loading="working" @click="unsubscribe" />
      </div>
    </div>

    <div v-else-if="state === 'done'" class="ustp-content" role="status">
      <h1 class="text-h5 q-my-none">You are unsubscribed</h1>
      <p>The US Transhumanist Party will send you no more email.</p>
      <p>Changed your mind? Sign in and open <router-link to="/account">your Account page</router-link> to turn email back on.</p>
    </div>

    <div v-else-if="state === 'invalid'" class="ustp-content">
      <h1 class="text-h5 q-my-none">This link does not work</h1>
      <p>
        Use the Unsubscribe link in your most recent email from the party, or sign in and unsubscribe on
        <router-link to="/account">your Account page</router-link>.
      </p>
    </div>

    <div v-else-if="state === 'failed'" class="ustp-content">
      <h1 class="text-h5 q-my-none">Something went wrong</h1>
      <p role="alert">You are not unsubscribed yet: {{ problem }}. Open the link in your email again in a little while.</p>
    </div>

    <q-spinner v-else size="32px" aria-label="Loading" />
  </PageShell>
</template>
