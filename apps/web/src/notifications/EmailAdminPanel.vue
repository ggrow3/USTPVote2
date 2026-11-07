<script setup lang="ts">
import { computed, ref } from 'vue';
import { hasRole } from '../session.js';
import AdminTestEmail from './AdminTestEmail.vue';
import MailHealthPanel from './MailHealthPanel.vue';
import MailStopsPanel from './MailStopsPanel.vue';
import NoticeSettingsPanel from './NoticeSettingsPanel.vue';
import SendEmailPanel from './SendEmailPanel.vue';

/**
 * Admin › Email, the Email Administration page. For System and Membership Admins: an email to members, and the members who
 * get no email (design §10.12). For System Admins too: the settings of all the site's email (§6.8), whether email is set
 * up properly, and a test email to a System Admin (§10.12).
 */
const systemAdmin = computed(() => hasRole('system_admin'));
const tab = ref('send');
</script>

<template>
  <div class="ustp-content">
    <h2 class="text-h6 q-my-none">Email administration</h2>
    <q-tabs v-model="tab" align="left" no-caps dense class="text-primary" aria-label="Email administration">
      <q-tab name="send" label="Email members" />
      <q-tab name="stops" label="Who gets no email" />
      <q-tab v-if="systemAdmin" name="settings" label="Settings" />
      <q-tab v-if="systemAdmin" name="setup" label="Setup and test" />
    </q-tabs>
    <q-separator />
    <q-tab-panels v-model="tab" keep-alive class="bg-transparent">
      <q-tab-panel name="send" class="q-px-none"><SendEmailPanel /></q-tab-panel>
      <q-tab-panel name="stops" class="q-px-none"><MailStopsPanel /></q-tab-panel>
      <q-tab-panel v-if="systemAdmin" name="settings" class="q-px-none"><NoticeSettingsPanel /></q-tab-panel>
      <q-tab-panel v-if="systemAdmin" name="setup" class="q-px-none">
        <div class="ustp-content">
          <MailHealthPanel />
          <AdminTestEmail />
        </div>
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>
