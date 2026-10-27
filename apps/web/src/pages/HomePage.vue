<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import type { ApprovalRequestRecord, ElectionRecord, ProfilePhotoRecord, VoterElection } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api } from '../api.js';
import { shown, viewer } from '../governance/navigation.js';
import { AUDIENCE_LABELS } from '../governance/navigation-text.js';
import { approvalsStatus, ballotStatus, electionsStatus, homeCards, waitingStatus, type HomeCardKey } from '../home.js';
import { applications } from '../membership/api.js';
import { session } from '../session.js';

const signedIn = computed(() => !!session.user);
/** Signed out: the public page's buttons, for the menu pages visitors are shown (design §10.5); the first one is filled. */
const PUBLIC_BUTTONS = [
  { link: 'register', to: '/register', label: 'Register' },
  { link: 'ballot', to: '/ballot', label: 'Vote' },
  { link: 'verify', to: '/verify', label: 'Verify a receipt' },
  { link: 'offices', to: '/offices', label: 'Offices' },
] as const;
const publicButtons = computed(() => PUBLIC_BUTTONS.filter((b) => shown.value.menu.includes(b.link)));
usePageTitle(() => (signedIn.value ? 'Home' : 'Member voting'));

const membership = computed(() => (viewer.value.membership === 'signed_out' ? 'no_membership' : viewer.value.membership));
const cards = computed(() => homeCards(shown.value, membership.value, !!session.me?.testing.enabled));
/** The name they go by: their preferred or legal name as a member, else the one on their login. */
const name = computed(() => session.me?.member?.preferredName || session.me?.member?.legalName || session.me?.account?.displayName);
/** "Active member · Election Admin": who the cards are for. */
const who = computed(() => [membership.value, ...viewer.value.roles].map((a) => AUDIENCE_LABELS[a]).join(' · '));

/**
 * A line of what is waiting, for the cards that have one; a card whose count cannot be loaded just has none. The API
 * returns at most 100 applications and 50 photos by default.
 */
const status = reactive<Partial<Record<HomeCardKey, string>>>({});
const LOADERS: Partial<Record<HomeCardKey, () => Promise<string>>> = {
  ballot: async () => ballotStatus(await api<VoterElection[]>('GET', '/v1/elections')),
  'admin/applications': async () => waitingStatus((await applications('pending')).length, 'application', 100),
  'admin/photos': async () =>
    waitingStatus((await api<ProfilePhotoRecord[]>('GET', '/v1/admin/photos?status=needs_review')).length, 'photo', 50),
  'admin/elections': async () => electionsStatus(await api<ElectionRecord[]>('GET', '/v1/admin/elections')),
  'admin/approvals': async () =>
    approvalsStatus(
      await api<ApprovalRequestRecord[]>('GET', '/v1/admin/approvals?status=pending'),
      session.me?.account?.accountId,
      session.me?.roles ?? [],
    ),
};

onMounted(() => {
  if (!signedIn.value) return;
  for (const card of cards.value) {
    LOADERS[card.key]?.().then(
      (line) => (status[card.key] = line),
      () => undefined,
    );
  }
});
</script>

<template>
  <q-page padding>
    <div v-if="!signedIn" class="ustp-content">
      <h1 class="text-h5">United States Transhumanist Party — Member Voting</h1>
      <p>Register as a member, cast your ballot, and independently verify that it was counted.</p>
      <div v-if="publicButtons.length" class="ustp-actions">
        <q-btn v-for="(b, i) in publicButtons" :key="b.link" color="primary" :outline="i > 0" :to="b.to" :label="b.label" />
      </div>
    </div>
    <div v-else class="ustp-content ustp-home">
      <div>
        <h1 class="text-h5">{{ name ? `Welcome, ${name}` : 'Welcome' }}</h1>
        <div class="text-caption text-grey-7">{{ who }}</div>
      </div>
      <ul class="ustp-home__cards" aria-label="What you can do">
        <li v-for="card in cards" :key="card.key">
          <q-card flat bordered class="ustp-home__card">
            <q-card-section>
              <h2 class="text-subtitle1">{{ card.title }}</h2>
              <p class="q-mb-none">{{ card.text }}</p>
              <p v-if="status[card.key]" class="q-mb-none q-mt-sm text-weight-medium">{{ status[card.key] }}</p>
            </q-card-section>
            <q-card-section class="ustp-actions">
              <q-btn color="primary" outline no-caps :to="card.to" :label="card.action" />
            </q-card-section>
          </q-card>
        </li>
      </ul>
    </div>
  </q-page>
</template>

<style scoped>
.ustp-home {
  max-width: 1100px;
}
/* As many 260px columns as fit; one at 320px. */
.ustp-home__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ustp-home__card {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.ustp-home__card > .q-card__section:first-child {
  flex: 1;
}
</style>
