<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { usingEmulators } from '../firebase.js';
import { hasRole, session, signOut } from '../session.js';

const router = useRouter();
const isAdmin = computed(() => hasRole('membership_admin', 'election_admin', 'auditor', 'system_admin'));
const who = computed(() => session.me?.account?.displayName || session.user?.email || 'Signed in');

async function onSignOut() {
  await signOut();
  await router.push('/');
}
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title>
          <router-link to="/" class="text-white" style="text-decoration: none">USTP Vote</router-link>
        </q-toolbar-title>
        <q-badge v-if="usingEmulators" color="orange" label="Local emulators" class="q-mr-md" />
        <template v-if="session.ready">
          <q-btn-dropdown v-if="session.user" flat no-caps :label="who">
            <q-list>
              <q-item v-close-popup clickable to="/account"><q-item-section>Account</q-item-section></q-item>
              <q-item v-close-popup clickable @click="onSignOut"><q-item-section>Sign out</q-item-section></q-item>
            </q-list>
          </q-btn-dropdown>
          <q-btn v-else flat no-caps label="Sign in" to="/signin" />
        </template>
      </q-toolbar>
      <q-tabs align="left" dense>
        <q-route-tab to="/register" label="Register" />
        <q-route-tab to="/ballot" label="Ballot" />
        <q-route-tab to="/verify" label="Verify" />
        <q-route-tab v-if="isAdmin" to="/admin" label="Admin" />
      </q-tabs>
    </q-header>

    <q-page-container>
      <q-banner v-if="session.error" class="bg-negative text-white">
        Could not load your account: {{ session.error }}
      </q-banner>
      <router-view />
    </q-page-container>
  </q-layout>
</template>
