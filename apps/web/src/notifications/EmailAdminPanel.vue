<script setup lang="ts">
import { computed } from 'vue';
import { hasRole } from '../session.js';
import AdminTestEmail from './AdminTestEmail.vue';
import MailHealthPanel from './MailHealthPanel.vue';
import MailStopsPanel from './MailStopsPanel.vue';
import NoticeSettingsPanel from './NoticeSettingsPanel.vue';

/**
 * Admin › Email. For System Admins: whether email is set up properly and a test email to themselves (design §10.12), and
 * the settings of all the site's email (§6.8). For them and Membership Admins: the members who get no email (§10.12).
 */
const systemAdmin = computed(() => hasRole('system_admin'));
</script>

<template>
  <div class="ustp-content">
    <template v-if="systemAdmin">
      <MailHealthPanel />
      <AdminTestEmail />
      <NoticeSettingsPanel />
    </template>
    <MailStopsPanel />
  </div>
</template>
