<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import type { MyReferrals } from 'ustp-domain';
import { APP_NAME } from '../app-name.js';
import { errorMessage } from '../api.js';
import { myReferrals } from './api.js';

/**
 * A member's own referral link (design §5.17) on their Account page: copy it or share it, and see how many joined by
 * it and how many applied and wait. Never who: the people who came by it are not told it was the member's link, nor is
 * the member told who they are.
 */
const $q = useQuasar();
const mine = ref<MyReferrals | null>(null);
const problem = ref<string | null>(null);
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

onMounted(async () => {
  try {
    mine.value = await myReferrals();
  } catch (e) {
    problem.value = errorMessage(e);
  }
});

async function copy() {
  if (!mine.value?.link) return;
  try {
    await navigator.clipboard.writeText(mine.value.link);
    $q.notify({ type: 'positive', message: 'Your link is copied.' });
  } catch {
    $q.notify({ type: 'warning', message: 'Could not copy: select the link and copy it yourself.' });
  }
}

async function share() {
  if (!mine.value?.link) return;
  try {
    await navigator.share({ title: 'Join the U.S. Transhumanist Party', text: 'I am a member of the U.S. Transhumanist Party. Join me:', url: mine.value.link });
  } catch {
    // Closed without sharing.
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<template>
  <q-card flat bordered tag="section" aria-labelledby="invite-title">
    <q-card-section>
      <h2 id="invite-title" class="text-subtitle1">Invite people to join</h2>
      <div class="text-caption text-grey-7">
        Your own link to the Register page. Someone who opens it and applies within 30 days counts for you, and for your
        teams on the leaderboard, once a Membership Admin approves them.
      </div>
    </q-card-section>
    <q-card-section v-if="problem" class="q-pt-none" role="alert">{{ problem }}</q-card-section>
    <q-card-section v-else-if="!mine" class="q-pt-none text-grey-7">Loading…</q-card-section>
    <q-card-section v-else-if="!mine.eligible" class="q-pt-none">
      Referral links are for Active members.
      <template v-if="mine.joined || mine.waiting">
        Before, {{ plural(mine.joined, 'person', 'people') }} joined by yours.
      </template>
    </q-card-section>
    <template v-else>
      <q-card-section class="q-pt-none ustp-stack">
        <q-input :model-value="mine.link ?? ''" outlined dense readonly label="Your link" @focus="(e: Event) => (e.target as HTMLInputElement).select()" />
        <div class="ustp-actions">
          <q-btn unelevated no-caps color="primary" icon="content_copy" label="Copy link" @click="copy" />
          <q-btn v-if="canShare" outline no-caps color="primary" icon="share" label="Share" @click="share" />
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none" role="status">
        <strong>{{ plural(mine.joined, 'person', 'people') }}</strong> joined by your link<template v-if="mine.waiting">, and
          {{ plural(mine.waiting, 'more applied and waits', 'more applied and wait') }} for a decision</template
        >. You are never told who, and they are not told it was your link.
      </q-card-section>
      <q-card-section class="q-pt-none text-caption text-grey-7">
        Teams compare how many their members brought in on the <router-link to="/teams">Teams</router-link> page. Only
        you see your own count. {{ APP_NAME }} keeps no record of who opened your link.
      </q-card-section>
    </template>
  </q-card>
</template>
