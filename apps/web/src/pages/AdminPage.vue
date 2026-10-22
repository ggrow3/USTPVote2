<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import type { Role } from 'ustp-domain';
import ApplicationsPanel from '../components/admin/ApplicationsPanel.vue';
import ApprovalsPanel from '../components/admin/ApprovalsPanel.vue';
import AuditPanel from '../components/admin/AuditPanel.vue';
import BylawsPanel from '../components/admin/BylawsPanel.vue';
import ElectionsPanel from '../components/admin/ElectionsPanel.vue';
import MembersPanel from '../components/admin/MembersPanel.vue';
import OfficesPanel from '../components/admin/OfficesPanel.vue';
import PhotosPanel from '../components/admin/PhotosPanel.vue';
import SignInMethodsPanel from '../components/admin/SignInMethodsPanel.vue';
import { useRoute } from 'vue-router';
import { usePageTitle } from '../a11y.js';
import { hasRole, session } from '../session.js';

interface Tab {
  readonly name: string;
  readonly label: string;
  readonly roles: readonly Role[];
}

/** Tabs follow the role matrix (design §10.1); the API enforces the same rules. */
const PANELS: Record<string, Component> = {
  applications: ApplicationsPanel,
  members: MembersPanel,
  photos: PhotosPanel,
  bylaws: BylawsPanel,
  elections: ElectionsPanel,
  offices: OfficesPanel,
  approvals: ApprovalsPanel,
  signin: SignInMethodsPanel,
  audit: AuditPanel,
};

const ALL_TABS: readonly Tab[] = [
  { name: 'applications', label: 'Applications', roles: ['membership_admin'] },
  { name: 'members', label: 'Members', roles: ['membership_admin'] },
  { name: 'photos', label: 'Photos', roles: ['membership_admin'] },
  { name: 'bylaws', label: 'Bylaws', roles: ['membership_admin'] },
  { name: 'elections', label: 'Elections', roles: ['election_admin', 'auditor'] },
  { name: 'offices', label: 'Offices', roles: ['membership_admin', 'election_admin', 'auditor'] },
  { name: 'approvals', label: 'Approvals', roles: ['membership_admin', 'election_admin', 'auditor', 'system_admin'] },
  { name: 'signin', label: 'Sign-in methods', roles: ['system_admin'] },
  { name: 'audit', label: 'Audit ledger', roles: ['auditor'] },
];

usePageTitle('Administration');
const tabs = computed(() => ALL_TABS.filter((t) => hasRole(...t.roles)));
const needsMfa = computed(() => !!session.me?.mfa.required && !session.me.mfa.signedInWithMfa);
const requested = String(useRoute().query.tab ?? '');
const tab = ref(tabs.value.some((t) => t.name === requested) ? requested : (tabs.value[0]?.name ?? 'approvals'));
</script>

<template>
  <q-page padding>
    <h1 class="text-h5 q-mb-md">Administration</h1>
    <q-banner v-if="needsMfa" class="bg-orange-2 text-black q-mb-md" rounded>
      Admin tools need two-step verification. Set up an authenticator app on your
      <router-link to="/account">Account page</router-link>, then sign out and sign back in with its code.
    </q-banner>
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
    <q-separator class="q-mb-md" />
    <q-tab-panels v-model="tab" keep-alive>
      <q-tab-panel v-for="t in tabs" :id="`admin-panel-${t.name}`" :key="t.name" :name="t.name" :aria-labelledby="`admin-tab-${t.name}`">
        <component :is="PANELS[t.name]" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>
