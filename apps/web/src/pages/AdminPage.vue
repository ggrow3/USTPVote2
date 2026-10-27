<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import type { AdminSection } from 'ustp-domain';
import ClaudeKeyPanel from '../claude-key/ClaudeKeyPanel.vue';
import ApprovalsPanel from '../components/admin/ApprovalsPanel.vue';
import AuditPanel from '../components/admin/AuditPanel.vue';
import BylawsPanel from '../components/admin/BylawsPanel.vue';
import ElectionsPanel from '../components/admin/ElectionsPanel.vue';
import OfficesPanel from '../components/admin/OfficesPanel.vue';
import PeoplePanel from '../components/admin/PeoplePanel.vue';
import PhotosPanel from '../components/admin/PhotosPanel.vue';
import SignInMethodsPanel from '../components/admin/SignInMethodsPanel.vue';
import TestingPanel from '../components/admin/TestingPanel.vue';
import HomeQuotePanel from '../governance/HomeQuotePanel.vue';
import NavigationPanel from '../governance/NavigationPanel.vue';
import { shown } from '../governance/navigation.js';
import { SECTION_LABELS } from '../governance/navigation-text.js';
import ApplicationsPanel from '../membership/ApplicationsPanel.vue';
import MembersPanel from '../membership/MembersPanel.vue';
import { useRoute } from 'vue-router';
import { usePageTitle } from '../a11y.js';
import { acting } from '../acting.js';
import { session } from '../session.js';

/** Each section's panel. Which ones a person sees is the navigation settings' (design §10.5); the API decides what they may do. */
const PANELS: Record<AdminSection, Component> = {
  applications: ApplicationsPanel,
  members: MembersPanel,
  photos: PhotosPanel,
  bylaws: BylawsPanel,
  elections: ElectionsPanel,
  offices: OfficesPanel,
  approvals: ApprovalsPanel,
  people: PeoplePanel,
  signin: SignInMethodsPanel,
  claude: ClaudeKeyPanel,
  audit: AuditPanel,
  testing: TestingPanel,
  navigation: NavigationPanel,
  quote: HomeQuotePanel,
};

usePageTitle('Administration');
// Testing shows only where the deployment allows test personas (design §10.4).
const tabs = computed(() =>
  shown.value.sections
    .filter((name) => name !== 'testing' || !!session.me?.testing.enabled)
    .map((name) => ({ name, label: SECTION_LABELS[name] })),
);
/** Every role is an admin role, so someone with none is not an officer. The menu can show them Admin (design §10.5). */
const officer = computed(() => !session.me || session.me.roles.length > 0);
const email = computed(() => session.me?.account?.primaryEmail);
const needsMfa = computed(() => !!session.me?.mfa.required && !session.me.mfa.signedInWithMfa);
const requested = String(useRoute().query.tab ?? '');
const tab = ref<string>(tabs.value.some((t) => t.name === requested) ? requested : (tabs.value[0]?.name ?? 'approvals'));
</script>

<template>
  <q-page padding>
    <h1 class="text-h5 q-mb-md">Administration</h1>
    <div v-if="!officer" class="ustp-content">
      <p v-if="acting.persona">
        The admin console is for party officers, and {{ acting.persona.label }}, the test persona you are acting as,
        holds no admin role. Stop acting as them in the bar above to get back to your own tools.
      </p>
      <template v-else>
        <p>
          The admin console is for party officers: Membership Admins, Election Admins, Auditors and System Admins. Your
          account holds none of these roles.
        </p>
        <p>
          A System Admin grants roles. If you have been chosen for one, ask a System Admin to grant it to the account you
          sign in with<template v-if="email">, {{ email }}</template>. Every admin role needs two-step verification,
          which you can set up beforehand on your <router-link to="/account">Account page</router-link>.
        </p>
      </template>
    </div>
    <template v-else>
      <q-banner v-if="needsMfa" class="bg-orange-2 text-black q-mb-md" rounded>
        Admin tools need two-step verification. Set up an authenticator app on your
        <router-link to="/account">Account page</router-link>, then sign out and sign back in with its code.
      </q-banner>
      <p v-if="!tabs.length">
        A System Admin has hidden every section of the console from your roles. Ask them if you need one back.
      </p>
      <q-tabs v-model="tab" dense align="left" class="text-primary" no-caps>
        <q-tab
          v-for="t in tabs"
          :id="`admin-tab-${t.name}`"
          :key="t.name"
          :name="t.name"
          :label="t.label"
          :aria-controls="`admin-panel-${t.name}`"
        />
      </q-tabs>
      <q-separator />
      <!-- Transparent and without side padding, so panels sit on the page, in line with the title and tabs. -->
      <q-tab-panels v-model="tab" keep-alive class="bg-transparent">
        <q-tab-panel
          v-for="t in tabs"
          :id="`admin-panel-${t.name}`"
          :key="t.name"
          :name="t.name"
          :aria-labelledby="`admin-tab-${t.name}`"
          class="q-px-none"
        >
          <component :is="PANELS[t.name]" />
        </q-tab-panel>
      </q-tab-panels>
    </template>
  </q-page>
</template>
