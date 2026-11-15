<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect, type Component } from 'vue';
import { useQuasar } from 'quasar';
import { queueBadge, type AdminSection } from 'ustp-domain';
import { menuFor, readFavourites, saveFavourites, toggleFavourite } from '../components/admin/admin-menu.js';
import AdminSideMenu from '../components/admin/AdminSideMenu.vue';
import ApiKeysPanel from '../claude-key/ApiKeysPanel.vue';
import ApprovalsPanel from '../components/admin/ApprovalsPanel.vue';
import AuditPanel from '../components/admin/AuditPanel.vue';
import CoursePanel from '../components/admin/CoursePanel.vue';
import ElectionsPanel from '../components/admin/ElectionsPanel.vue';
import OfficesPanel from '../offices/OfficesPanel.vue';
import CandidaciesPanel from '../candidacies/CandidaciesPanel.vue';
import TeamsPanel from '../teams/TeamsPanel.vue';
import BillsPanel from '../bills/BillsPanel.vue';
import CommunicationsPanel from '../communications/CommunicationsPanel.vue';
import ForumPanel from '../forum/ForumPanel.vue';
import RoomPanel from '../room/RoomPanel.vue';
import PeoplePanel from '../components/admin/PeoplePanel.vue';
import PhotosPanel from '../components/admin/PhotosPanel.vue';
import SignInMethodsPanel from '../components/admin/SignInMethodsPanel.vue';
import TestingPanel from '../components/admin/TestingPanel.vue';
import PageShell from '../components/PageShell.vue';
import HomeQuotePanel from '../governance/HomeQuotePanel.vue';
import HubPanel from '../governance/HubPanel.vue';
import NavigationPanel from '../governance/NavigationPanel.vue';
import EmailAdminPanel from '../notifications/EmailAdminPanel.vue';
import { shown } from '../governance/navigation.js';
import { guide } from '../guide/tour.js';
import ApplicationsPanel from '../membership/ApplicationsPanel.vue';
import MembersPanel from '../membership/MembersPanel.vue';
import MembershipInboxPanel from '../inbox/MembershipInboxPanel.vue';
import RegistrationFormPanel from '../membership/RegistrationFormPanel.vue';
import FirstStepsPanel from '../membership/FirstStepsPanel.vue';
import SecurityPanel from '../security/SecurityPanel.vue';
import { useRoute, useRouter } from 'vue-router';
import { usePageTitle } from '../a11y.js';
import { acting } from '../acting.js';
import { applicationQueue } from '../membership/queue.js';
import { session } from '../session.js';

/** Each section's panel. Which ones a person sees is the navigation settings' (design §10.5); the API decides what they may do. */
const PANELS: Record<AdminSection, Component> = {
  applications: ApplicationsPanel,
  members: MembersPanel,
  inbox: MembershipInboxPanel,
  photos: PhotosPanel,
  registration: RegistrationFormPanel,
  first_steps: FirstStepsPanel,
  elections: ElectionsPanel,
  offices: OfficesPanel,
  candidacies: CandidaciesPanel,
  teams: TeamsPanel,
  forum: ForumPanel,
  room: RoomPanel,
  approvals: ApprovalsPanel,
  people: PeoplePanel,
  signin: SignInMethodsPanel,
  claude: ApiKeysPanel,
  email: EmailAdminPanel,
  audit: AuditPanel,
  security: SecurityPanel,
  testing: TestingPanel,
  navigation: NavigationPanel,
  hub: HubPanel,
  communications: CommunicationsPanel,
  quote: HomeQuotePanel,
  course: CoursePanel,
  bills: BillsPanel,
};

usePageTitle('Administration');
/** The sections this person has starred, kept in this browser for their account. */
const accountId = computed(() => session.me?.account?.accountId ?? null);
const favourites = ref<AdminSection[]>(readFavourites(accountId.value));
watch(accountId, (now) => (favourites.value = readFavourites(now)));
function star(section: AdminSection): void {
  favourites.value = toggleFavourite(favourites.value, section);
  saveFavourites(accountId.value, favourites.value);
}
// Testing shows only where the deployment allows test personas, and never while acting as one (design §10.4).
const groups = computed(() =>
  menuFor(
    shown.value.sections.filter((name) => name !== 'testing' || (!!session.me?.testing.enabled && !session.me.testing.operator)),
    favourites.value,
  ),
);
/** The sections in the side menu's order, favourites first, so the first one opens when the address names none. */
const tabs = computed(() => groups.value.flatMap((g) => g.sections));
/** Every role is an admin role, so someone with none is not an officer. The menu can show them Admin (design §10.5). */
const officer = computed(() => !session.me || session.me.roles.length > 0);
const email = computed(() => session.me?.account?.primaryEmail);
const needsMfa = computed(() => !!session.me?.mfa.required && !session.me.mfa.signedInWithMfa);
/** A System or Site Admin signed in another way while Google sign-in is required of them (design §4). */
const needsGoogle = computed(() => !!session.me?.signIn?.googleRequired);
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
/** Under 1024px the menu folds into a button that opens it as a drawer, leaving the section the page's width. */
const narrow = computed(() => $q.screen.lt.md);
const drawer = ref(false);
watch(narrow, (now) => {
  if (!now) drawer.value = false;
});
const drawerNav = ref<HTMLElement | null>(null);
/** Opening the drawer puts focus on the section shown, so Tab and Shift+Tab go on from where the person is. */
function focusShown(): void {
  drawerNav.value?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
}
const pending = computed(() => applicationQueue.summary?.pending ?? 0);
/** The fixed header's height (the testing bar makes it taller), so the side menu stays in view just under it. */
const headerHeight = ref(64);
let headerWatch: ResizeObserver | null = null;
onMounted(() => {
  const header = document.querySelector<HTMLElement>('.q-header');
  if (!header || typeof ResizeObserver === 'undefined') return;
  headerWatch = new ResizeObserver(() => (headerHeight.value = header.offsetHeight));
  headerWatch.observe(header);
});
onUnmounted(() => headerWatch?.disconnect());
/** Tabs that moved: the bylaws are edited in the Registration form tab now (design §5.2), so old links still reach them. */
const MOVED_TABS: Readonly<Record<string, AdminSection>> = { bylaws: 'registration' };
const tabAsked = (asked: unknown) => MOVED_TABS[String(asked ?? '')] ?? String(asked ?? '');
const requested = tabAsked(route.query.tab);
const tab = ref<string>(tabs.value.some((t) => t.name === requested) ? requested : (tabs.value[0]?.name ?? 'approvals'));
if (route.query.tab !== undefined && route.query.tab !== tab.value) void router.replace({ query: { ...route.query, tab: tab.value } });
// A link to another section while the console is open, such as a walkthrough's Next or a row of the side menu, opens
// that section; a section picked here is kept in the address (`?tab=`), so such a link is never to the address already
// shown, and a reload stays on it. Neither is a page visit (§10.7), and the admin pages have no analytics.
watch(
  () => route.query.tab,
  (now) => {
    const asked = tabAsked(now);
    if (tabs.value.some((t) => t.name === asked)) tab.value = asked;
  },
);
watch(tab, (now) => {
  if (route.query.tab !== now) void router.replace({ query: { ...route.query, tab: now } });
});
// The section shown, for the walkthrough's steps on a section (design §10.11).
watchEffect(() => (guide.openTab = officer.value && tabs.value.some((t) => t.name === tab.value) ? tab.value : null));
onUnmounted(() => (guide.openTab = null));
const shownSection = computed(() => tabs.value.find((t) => t.name === tab.value) ?? null);
</script>

<template>
  <PageShell width="console">
    <h1 class="text-h5 q-mb-md">Administration</h1>
    <div v-if="!officer" class="ustp-content">
      <p v-if="acting.persona">
        The admin console is for party officers, and {{ acting.persona.label }}, the test persona you are acting as,
        holds no admin role. Stop acting as them in the bar above to get back to your own tools.
      </p>
      <template v-else>
        <p>
          The admin console is for party officers: Membership Admins, Election Admins, Auditors, System Admins, Site
          Admins, Course Administrators and Communications Admins. Your account holds none of these roles.
        </p>
        <p>
          A System or Site Admin grants roles. If you have been chosen for one, ask one of them to grant it to the account you
          sign in with<template v-if="email">, {{ email }}</template>. Every admin role needs two-step verification,
          which you can set up beforehand on your <router-link to="/account">Account page</router-link>.
        </p>
      </template>
    </div>
    <template v-else>
      <q-banner v-if="needsGoogle" class="bg-orange-2 text-black q-mb-md" rounded>
        System and Site Admins must sign in with Google. Sign out, then choose “Continue with Google” with the Google
        account of your address.
      </q-banner>
      <q-banner v-if="needsMfa" class="bg-orange-2 text-black q-mb-md" rounded>
        Admin tools need two-step verification. Set up an authenticator app on your
        <router-link to="/account">Account page</router-link>, then sign out and sign back in with its code.
      </q-banner>
      <p v-if="!tabs.length">
        A System or Site Admin has hidden every section of the console from your roles. Ask them if you need one back.
      </p>
      <div v-else class="admin-console" :class="{ 'admin-console--narrow': narrow }" :style="{ '--admin-header': `${headerHeight}px` }">
        <!-- Narrow screens: the section shown, as a button that opens the menu in a drawer. -->
        <q-btn
          v-if="narrow"
          outline
          no-caps
          align="left"
          color="primary"
          class="admin-console__menu-button"
          aria-haspopup="dialog"
          :aria-expanded="drawer ? 'true' : 'false'"
          @click="drawer = true"
        >
          <q-icon name="menu" class="q-mr-sm" />
          <span class="sr-only">Admin sections: </span>
          <q-icon v-if="shownSection" :name="shownSection.icon" size="20px" class="q-mr-sm" />
          <span class="ellipsis">{{ shownSection?.label ?? 'Sections' }}</span>
          <q-badge v-if="pending && tab !== 'applications'" color="warning" text-color="black" class="q-ml-sm">
            {{ queueBadge(pending) }}<span class="sr-only"> applications waiting</span>
          </q-badge>
        </q-btn>
        <nav v-else class="admin-console__nav" aria-label="Admin sections">
          <AdminSideMenu :groups="groups" :current="tab" :pending="pending" :favourites="favourites" id-prefix="admin-menu" @star="star" />
        </nav>
        <!-- Each section's panel is kept once opened, as the tabs kept theirs. -->
        <section
          :id="shownSection ? `admin-panel-${shownSection.name}` : undefined"
          class="admin-console__section"
          :aria-label="shownSection?.label"
        >
          <KeepAlive>
            <component :is="PANELS[shownSection.name]" v-if="shownSection" :key="shownSection.name" />
          </KeepAlive>
        </section>
      </div>
      <q-dialog
        v-model="drawer"
        position="left"
        full-height
        square
        class="admin-drawer-dialog"
        aria-labelledby="admin-drawer-title"
        @show="focusShown"
      >
        <q-card class="admin-drawer">
          <div class="admin-drawer__head">
            <q-btn v-close-popup flat round icon="close" aria-label="Close the menu" />
            <span id="admin-drawer-title" class="admin-drawer__title">Administration</span>
          </div>
          <nav ref="drawerNav" class="admin-drawer__nav" aria-label="Admin sections">
            <AdminSideMenu
              :groups="groups"
              :current="tab"
              :pending="pending"
              :favourites="favourites"
              id-prefix="admin-drawer"
              @chosen="drawer = false"
              @star="star"
            />
          </nav>
        </q-card>
      </q-dialog>
    </template>
  </PageShell>
</template>

<style scoped>
/* The side menu beside the section shown, as the Cloud console's (design §10.1). */
.admin-console {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.admin-console--narrow {
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}
/* Stays in view under the header while a long section scrolls, and scrolls itself if it is taller than the window. */
.admin-console__nav {
  position: sticky;
  top: calc(var(--admin-header) + 16px);
  max-height: calc(100vh - var(--admin-header) - 32px);
  overflow-y: auto;
  padding-right: 12px;
  border-right: 1px solid rgba(0, 0, 0, 0.12);
}
.body--dark .admin-console__nav {
  border-right-color: rgba(255, 255, 255, 0.12);
}
.admin-console__menu-button {
  justify-self: start;
  max-width: 100%;
  min-height: 44px;
}
.body--dark .admin-console__menu-button {
  color: var(--q-accent) !important;
}
/* The drawer: the menu down the left edge, with its close button at the top. */
.admin-drawer {
  display: flex;
  flex-direction: column;
  width: min(320px, 85vw);
}
.admin-drawer__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}
.body--dark .admin-drawer__head {
  border-bottom-color: rgba(255, 255, 255, 0.12);
}
.admin-drawer__title {
  font-size: 1.25rem;
  font-weight: 600;
}
.admin-drawer__nav {
  flex: 1;
  overflow-y: auto;
  padding: 16px 12px;
}
</style>

<style>
/* The drawer runs the screen's full height, as a side menu does: Quasar leaves 24px above and below a dialog. */
.admin-drawer-dialog .q-dialog__inner--left {
  padding-top: 0;
  padding-bottom: 0;
}
</style>
