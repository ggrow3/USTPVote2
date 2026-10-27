<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { focusElement, liveRegions } from '../a11y.js';
import { acting } from '../acting.js';
import { usingEmulators } from '../firebase.js';
import { navigationState, shown } from '../governance/navigation.js';
import { MENU_LABELS } from '../governance/navigation-text.js';
import { session, signOut } from '../session.js';

const TestingBar = defineAsyncComponent(() => import('../components/TestingBar.vue'));

const route = useRoute();
const router = useRouter();
const who = computed(() => acting.persona?.label || session.me?.account?.displayName || session.user?.email || 'Signed in');
/**
 * The links the navigation settings give this person (design §10.5), once their account and the settings are known.
 * Each page still explains itself to someone who reaches it without being one it is for.
 */
const links = computed(() =>
  session.ready && navigationState.loaded ? shown.value.menu.map((link) => ({ to: `/${link}`, label: MENU_LABELS[link] })) : [],
);

async function onSignOut() {
  await signOut();
  await router.push('/');
}

/** The new page's main heading, so keyboard and screen reader users start at the content (WCAG 2.4.3). */
function focusMain() {
  focusElement(document.querySelector('main h1'));
}

// Not on the first load: the browser starts at the top of the document then, as on any page.
watch(() => route.path, focusMain, { flush: 'post' });

/** Keeps whatever the browser scrolls to (a focused control, a skip target) clear of the fixed header (WCAG 2.4.11). */
function onHeaderResize({ height }: { height: number }) {
  document.documentElement.style.scrollPaddingTop = `${height + 8}px`;
}
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <a href="#main" class="ustp-skip-link" @click.prevent="focusMain">Skip to main content</a>
    <q-header elevated class="bg-primary text-white">
      <q-resize-observer @resize="onHeaderResize" />
      <q-toolbar>
        <q-toolbar-title shrink style="flex: none">
          <router-link to="/" class="text-white" style="text-decoration: none">USTP Vote</router-link>
        </q-toolbar-title>
        <q-space />
        <q-badge v-if="usingEmulators" color="orange" text-color="black" label="Local emulators" class="q-mr-md gt-xs" />
        <template v-if="session.ready">
          <!-- On phones only the icon shows, so the title is not squeezed out (WCAG 1.4.10). -->
          <q-btn-dropdown
            v-if="session.user"
            flat
            no-caps
            icon="account_circle"
            :label="$q.screen.gt.xs ? who : undefined"
            :aria-label="`Account: ${who}`"
          >
            <q-list>
              <q-item v-close-popup clickable to="/account"><q-item-section>Account</q-item-section></q-item>
              <q-item v-close-popup clickable @click="onSignOut"><q-item-section>Sign out</q-item-section></q-item>
            </q-list>
          </q-btn-dropdown>
          <q-btn v-else flat no-caps label="Sign in" to="/signin" />
        </template>
      </q-toolbar>
      <!-- Links, not tabs: each one loads a page (tab semantics would promise panels on this page). -->
      <nav aria-label="Main" class="row q-px-sm bg-black ustp-nav">
        <router-link
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="ustp-nav-link"
          :class="{ 'ustp-nav-link--active': route.path === l.to || route.path.startsWith(`${l.to}/`) }"
        >
          {{ l.label }}
        </router-link>
      </nav>
      <TestingBar v-if="acting.persona" />
    </q-header>

    <q-page-container>
      <q-banner v-if="session.error" class="bg-negative text-white">
        Could not load your account: {{ session.error }}
      </q-banner>
      <!-- Keyed by persona, so switching reloads every page's data as the new persona. -->
      <router-view :key="acting.persona?.accountId ?? 'self'" />
    </q-page-container>

    <div class="sr-only" role="status">{{ liveRegions.polite }}</div>
    <div class="sr-only" role="alert">{{ liveRegions.assertive }}</div>
  </q-layout>
</template>

<style scoped>
/* Its links' height while they load, so the page does not move when they appear. */
.ustp-nav {
  min-height: 38px;
}
.ustp-nav-link {
  padding: 8px 16px 6px;
  border-bottom: 3px solid transparent;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.0892857143em;
  text-decoration: none;
  text-transform: uppercase;
}
.ustp-nav-link:hover {
  background: rgba(255, 255, 255, 0.1);
}
.ustp-nav-link--active {
  border-bottom-color: var(--q-accent);
}
/* Phones (Quasar's xs): tighter, so all four links keep to one row at 320 px; they still wrap if text is enlarged. */
@media (max-width: 599.98px) {
  .ustp-nav-link {
    padding: 8px 8px 6px;
    letter-spacing: 0.04em;
  }
}
</style>
