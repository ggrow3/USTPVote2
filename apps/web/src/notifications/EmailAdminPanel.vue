<script setup lang="ts">
import MailHealthPanel from './MailHealthPanel.vue';
import NoticeSettingsPanel from './NoticeSettingsPanel.vue';

/**
 * Admin › Email, for System Admins: whether email is set up properly (design §10.12), and the settings of the election
 * emails and the site's other emails (§6.8).
 */
</script>

<template>
  <div class="ustp-content">
    <MailHealthPanel />
    <NoticeSettingsPanel />
  </div>
</template>
