<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { preferencesOf, type ApprovalRequestRecord, type ElectionRecord, type ProfilePhotoRecord, type VoterElection } from 'ustp-domain';
import { focusSoon, usePageTitle } from '../a11y.js';
import { api } from '../api.js';
import HomeBackdrop from '../components/HomeBackdrop.vue';
import SignInForm from '../components/SignInForm.vue';
import DailyQuoteCard from '../daily/DailyQuoteCard.vue';
import HomeQuoteFigure from '../governance/HomeQuoteFigure.vue';
import { homeQuoteState } from '../governance/home-quote.js';
import { shown, viewer } from '../governance/navigation.js';
import { AUDIENCE_LABELS } from '../governance/navigation-text.js';
import {
  approvalsStatus,
  ballotStatus,
  electionsStatus,
  homeCards,
  visitorCard,
  waitingStatus,
  type HomeCardKey,
} from '../home.js';
import { applications } from '../membership/api.js';
import { session } from '../session.js';

/**
 * The voting home, `/vote` (design §10.5; the home page until the hub took `/`, §10.6): the party's quote over a
 * sunrise on one side; on the other, signed out, a card to sign in or join, and signed in, a card for each thing the
 * person can do. Phones stack the card under the quote.
 */
const signedIn = computed(() => !!session.user);
/** The daily quote and joke, for those who turned it on in their account (design §4.1). */
const dailyOn = computed(() => preferencesOf(session.me?.account).dailyQuote);
usePageTitle(() => (signedIn.value ? 'Voting home' : 'Member voting'));

const quote = computed(() => (homeQuoteState.quote?.shown ? homeQuoteState.quote : null));
const INTRO = 'Register as a member, cast your ballot, and independently verify that it was counted.';
/** Signed out: the sign-in form and the other ways in that visitors are shown. */
const visitor = computed(() => visitorCard(shown.value.menu));

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

/** Loads each card's line once, including after signing in or out on this page. */
const requested = new Set<HomeCardKey>();
watch(
  [signedIn, cards],
  () => {
    if (!signedIn.value) {
      requested.clear();
      for (const key of Object.keys(status) as HomeCardKey[]) delete status[key];
      return;
    }
    for (const card of cards.value) {
      if (requested.has(card.key)) continue;
      requested.add(card.key);
      LOADERS[card.key]?.().then(
        (line) => (status[card.key] = line),
        () => undefined,
      );
    }
  },
  { immediate: true },
);

// Signing in here replaces the form with the cards, so focus goes to their heading rather than being lost (WCAG 2.4.3).
watch(signedIn, (now) => now && focusSoon('main h1'));
</script>

<template>
  <q-page class="ustp-landing">
    <HomeBackdrop class="ustp-landing__backdrop" />
    <div
      class="ustp-landing__inner"
      :class="{ 'ustp-landing__inner--member': signedIn, 'ustp-landing__inner--solo': signedIn && !quote }"
    >
      <div v-if="!signedIn || quote" class="ustp-landing__lead ustp-scrim">
        <h1 v-if="!signedIn" class="ustp-landing__name">
          <img src="/icons/icon.svg" alt="" width="40" height="40" />
          <span>United States Transhumanist Party — Member Voting</span>
        </h1>
        <HomeQuoteFigure v-if="quote" :quote="quote" />
        <p v-else class="ustp-landing__headline">{{ INTRO }}</p>
      </div>

      <div v-if="!signedIn" class="ustp-landing__side">
        <SignInForm v-if="visitor.signIn" card-class="ustp-landing__card">
          <template #header>
            <q-card-section>
              <h2 class="text-h6">Sign in to USTP Vote</h2>
              <p v-if="quote" class="q-mb-none q-mt-xs">{{ INTRO }}</p>
            </q-card-section>
          </template>
          <template v-if="visitor.links.length" #footer>
            <q-card-section class="ustp-stack">
              <p v-for="l in visitor.links" :key="l.key">
                {{ l.before }}<router-link :to="l.to">{{ l.label }}</router-link>{{ l.after }}
              </p>
            </q-card-section>
          </template>
        </SignInForm>
        <q-card v-else flat bordered class="ustp-landing__card">
          <q-card-section>
            <h2 class="text-h6">Take part</h2>
            <p v-if="quote" class="q-mb-none q-mt-xs">{{ INTRO }}</p>
          </q-card-section>
          <q-card-section class="ustp-stack">
            <p v-for="l in visitor.links" :key="l.key">
              {{ l.before }}<router-link :to="l.to">{{ l.label }}</router-link>{{ l.after }}
            </p>
          </q-card-section>
        </q-card>
      </div>

      <div v-else class="ustp-landing__side">
        <q-card flat bordered class="ustp-landing__card">
          <q-card-section>
            <h1 class="text-h5">{{ name ? `Welcome, ${name}` : 'Welcome' }}</h1>
            <div class="text-caption text-grey-7">{{ who }}</div>
          </q-card-section>
          <q-card-section>
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
          </q-card-section>
        </q-card>
        <DailyQuoteCard v-if="dailyOn" class="ustp-landing__card q-mt-md" />
      </div>
    </div>
  </q-page>
</template>

<style scoped>
/* The picture fills the page behind everything, however tall the cards make it. */
.ustp-landing {
  position: relative;
  overflow: hidden;
}
.ustp-landing__backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
/* One column on phones, the card under the quote; side by side from 1024px, as on a laptop. */
.ustp-landing__inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px 48px;
  align-items: start;
  max-width: 1240px;
  margin: 0 auto;
  padding: clamp(16px, 5vw, 64px) 16px;
}
@media (min-width: 1024px) {
  .ustp-landing__inner {
    grid-template-columns: minmax(0, 1fr) minmax(0, 440px);
    padding-inline: 32px;
  }
  .ustp-landing__inner--member {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  }
  .ustp-landing__inner--solo {
    grid-template-columns: minmax(0, 1fr);
    max-width: 1100px;
  }
  .ustp-landing__lead {
    margin-top: 24px;
  }
}
.ustp-landing__lead {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.ustp-landing__name {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.02em;
}
.ustp-landing__name img {
  flex: none;
  border-radius: 8px;
}
.ustp-landing__headline {
  margin: 0;
  font-size: clamp(1.5rem, 1rem + 1.6vw, 2.25rem);
  line-height: 1.25;
}
/* The card of the layout: white (the dark theme's card colour), rounded and lifted off the picture. */
.ustp-landing__side :deep(.ustp-landing__card) {
  border: 0;
  border-radius: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}
.ustp-landing__side :deep(.ustp-landing__card > .q-card__section:first-child) {
  padding-top: 24px;
}
/* As many 240px columns as fit; one at 320px. */
.ustp-home__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
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
