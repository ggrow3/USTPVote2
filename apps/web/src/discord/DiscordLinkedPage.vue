<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { DISCORD_STATE_KEY, finishDiscordLink } from './api.js';
import { returnProblem } from './discord-link-text.js';

/**
 * Where Discord sends a member back after they sign in there to link their account (design §10.18, "Linking"). It
 * checks that this tab started the sign-in, hands Discord's code to the site, and goes back to the Account page. The
 * code is taken out of the address at once, so it is not left in the tab's history.
 */
const route = useRoute();
const router = useRouter();
const problem = ref<string | null>(null);
const done = ref(false);

onMounted(async () => {
  const one = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const query = { error: one(route.query.error), code: one(route.query.code), state: one(route.query.state) };
  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(DISCORD_STATE_KEY);
    sessionStorage.removeItem(DISCORD_STATE_KEY);
  } catch {
    // No storage in this browser: the return cannot be checked, and is refused below.
  }
  await router.replace({ path: route.path });
  problem.value = returnProblem(query, expected);
  if (problem.value) return;
  try {
    await finishDiscordLink(query.code!, query.state!);
    done.value = true;
    await router.replace('/account');
  } catch (e) {
    problem.value = errorMessage(e);
  }
});
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <h1 class="text-h5 q-my-none">Connecting Discord</h1>
      <p v-if="problem" role="alert">{{ problem }}</p>
      <p v-else role="status">{{ done ? 'Linked. Taking you back to your account…' : 'Finishing the link…' }}</p>
      <p v-if="problem"><router-link to="/account">Back to your account</router-link></p>
    </div>
  </PageShell>
</template>
