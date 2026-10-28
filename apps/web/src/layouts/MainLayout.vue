<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { focusElement, liveRegions } from '../a11y.js';
import { acting } from '../acting.js';
import { usingEmulators } from '../firebase.js';
import { navigationState, shown } from '../governance/navigation.js';
import { MENU_LABELS } from '../governance/navigation-text.js';
import { session, signOut } from '../session.js';
import { toggleTheme } from '../theme.js';
import { linksInRow } from './menu-fit.js';

const TestingBar = defineAsyncComponent(() => import('../components/TestingBar.vue'));

const route = useRoute();
const router = useRouter();
const who = computed(() => acting.persona?.label || session.me?.account?.displayName || session.user?.email || 'Signed in');
/**
 * The links the navigation settings give this person (design §10.5), once their account and the settings are known.
 * Each page still explains itself to someone who reaches it without being one it is for. Sign in is the header's button.
 */
const links = computed(() =>
  session.ready && navigationState.loaded
    ? shown.value.menu.filter((link) => link !== 'signin').map((link) => ({ to: `/${link}`, label: MENU_LABELS[link] }))
    : [],
);

const isActive = (to: string) => route.path === to || route.path.startsWith(`${to}/`);

/** The hub is a page of its own (design §10.6): no header or menu, and its own share and theme buttons. */
const bare = computed(() => !!route.meta.bare);

/**
 * The bar keeps one row (WCAG 1.4.10 at 320 px): the links that do not fit go behind a More button at its end, measured
 * from a hidden copy of the row, so the settings' choice of links and enlarged text never wrap it.
 */
const bar = ref<HTMLElement | null>(null);
const ruler = ref<HTMLElement | null>(null);
const moreBox = ref<HTMLElement | null>(null);
const moreButton = ref<HTMLButtonElement | null>(null);
const inRow = ref(Number.POSITIVE_INFINITY);
const rowLinks = computed(() => links.value.slice(0, inRow.value));
const moreLinks = computed(() => links.value.slice(inRow.value));
const moreOpen = ref(false);

function fitLinks() {
  if (!bar.value || !ruler.value) return;
  const style = getComputedStyle(bar.value);
  const available = bar.value.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const widths = [...ruler.value.children].map((el) => el.getBoundingClientRect().width);
  const more = widths.pop() ?? 0;
  inRow.value = linksInRow(widths, more, available);
}

function closeMore(focusButton = false) {
  moreOpen.value = false;
  if (focusButton) moreButton.value?.focus();
}

/** Closes the list when focus leaves it and its button, as a disclosure should not cover the page it is left on. */
function onMoreFocusOut(event: FocusEvent) {
  if (!moreBox.value?.contains(event.relatedTarget as Node | null)) closeMore();
}

function onPointerDown(event: PointerEvent) {
  if (moreOpen.value && !moreBox.value?.contains(event.target as Node)) closeMore();
}

// The bar's width, and the ruler's as text size and fonts change; measured once at the start too, since a background
// tab gets no resize notices until it is shown. The header comes and goes with the hub, so they are watched afresh
// each time it appears.
const resizes = new ResizeObserver(() => fitLinks());
watch(
  [bar, ruler],
  (now) => {
    resizes.disconnect();
    for (const el of now) if (el) resizes.observe(el);
    fitLinks();
  },
  { flush: 'post' },
);
onMounted(() => {
  fitLinks();
  void document.fonts.ready.then(fitLinks);
  document.addEventListener('pointerdown', onPointerDown);
});
onBeforeUnmount(() => {
  resizes.disconnect();
  document.removeEventListener('pointerdown', onPointerDown);
});
watch(links, () => nextTick(fitLinks), { flush: 'post' });
watch(moreLinks, (rest) => rest.length || closeMore());
watch(() => route.fullPath, () => closeMore());

async function onSignOut() {
  await signOut();
  await router.push('/vote');
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
watch(bare, (now) => now && (document.documentElement.style.scrollPaddingTop = ''));
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <a v-if="!bare" href="#main" class="ustp-skip-link" @click.prevent="focusMain">Skip to main content</a>
    <q-header v-if="!bare" elevated class="bg-primary text-white">
      <q-resize-observer @resize="onHeaderResize" />
      <q-toolbar>
        <q-toolbar-title shrink style="flex: none">
          <router-link to="/" class="text-white" style="text-decoration: none">USTP Vote</router-link>
        </q-toolbar-title>
        <q-space />
        <q-badge v-if="usingEmulators" color="orange" text-color="black" label="Local emulators" class="q-mr-md gt-xs" />
        <q-btn
          flat
          round
          :icon="$q.dark.isActive ? 'dark_mode' : 'light_mode'"
          aria-label="Dark theme"
          :aria-pressed="$q.dark.isActive ? 'true' : 'false'"
          @click="toggleTheme"
        />
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
          <q-btn v-else-if="shown.menu.includes('signin')" flat no-caps label="Sign in" to="/signin" />
        </template>
      </q-toolbar>
      <!-- Links, not tabs: each one loads a page (tab semantics would promise panels on this page). -->
      <nav ref="bar" aria-label="Main" class="row q-px-sm bg-black ustp-nav">
        <router-link
          v-for="l in rowLinks"
          :key="l.to"
          :to="l.to"
          class="ustp-nav-link"
          :class="{ 'ustp-nav-link--active': isActive(l.to) }"
        >
          {{ l.label }}
        </router-link>
        <!-- A disclosure, not an ARIA menu: its items are the same page links, in the same tab order. -->
        <div v-if="moreLinks.length" ref="moreBox" class="ustp-nav-more" @keydown.esc="closeMore(true)" @focusout="onMoreFocusOut">
          <button
            ref="moreButton"
            type="button"
            class="ustp-nav-link ustp-nav-more__button"
            :class="{ 'ustp-nav-link--active': moreLinks.some((l) => isActive(l.to)), 'ustp-nav-more__button--open': moreOpen }"
            :aria-expanded="moreOpen"
            aria-controls="ustp-nav-more"
            @click="moreOpen = !moreOpen"
          >
            More
          </button>
          <ul v-show="moreOpen" id="ustp-nav-more" class="ustp-nav-more__list">
            <li v-for="l in moreLinks" :key="l.to">
              <router-link :to="l.to" class="ustp-nav-more__link" :class="{ 'ustp-nav-more__link--active': isActive(l.to) }">
                {{ l.label }}
              </router-link>
            </li>
          </ul>
        </div>
        <!-- Every link and More at their rendered width, for fitLinks; never seen or read, and in a box of no size so it
             cannot widen the page. -->
        <div class="ustp-nav-ruler-box" aria-hidden="true">
          <div ref="ruler" class="ustp-nav-ruler">
            <span v-for="l in links" :key="l.to" class="ustp-nav-link">{{ l.label }}</span>
            <span class="ustp-nav-link ustp-nav-more__button">More</span>
          </div>
        </div>
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
  position: relative;
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
/* Phones (Quasar's xs): tighter, so more links fit beside More (three at 320 px). */
@media (max-width: 599.98px) {
  .ustp-nav-link {
    padding: 8px 8px 6px;
    letter-spacing: 0.04em;
  }
}
.ustp-nav-ruler-box {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}
.ustp-nav-ruler {
  display: flex;
  width: max-content;
}
.ustp-nav-ruler > * {
  flex: none;
}
/* At the end of the row, so its list opens under it and inside the bar's width. */
.ustp-nav-more {
  position: relative;
  margin-left: auto;
}
.ustp-nav-more__button {
  border-top: 0;
  border-right: 0;
  border-left: 0;
  background: none;
  font-family: inherit;
  line-height: inherit;
  cursor: pointer;
}
.ustp-nav-more__button--open {
  background: rgba(255, 255, 255, 0.1);
}
.ustp-nav-more__list {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 1;
  min-width: 10rem;
  max-width: calc(100vw - 16px);
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: #000;
  /* The edge shows on the dark theme's page too, where the shadow does not. */
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-top: 0;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
}
.ustp-nav-more__link {
  display: block;
  padding: 10px 16px 10px 13px;
  border-left: 3px solid transparent;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-decoration: none;
  text-transform: uppercase;
}
.ustp-nav-more__link:hover {
  background: rgba(255, 255, 255, 0.1);
}
.ustp-nav-more__link--active {
  border-left-color: var(--q-accent);
}
</style>
