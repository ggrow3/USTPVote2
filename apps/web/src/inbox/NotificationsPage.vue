<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AppNotificationView } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { myNotifications, readAllNotifications, readNotification } from './api.js';
import { inbox, refreshUnread } from './inbox-state.js';
import { NOTIFICATION_ICONS, notificationLine, whenText } from './inbox-text.js';

/**
 * The signed-in account's notifications (design §10.13), newest first: the last 30, each leading to what it is about.
 * They are kept 90 days. How they come by email is chosen on the Account page.
 */
usePageTitle('Notifications');
const router = useRouter();
const items = ref<AppNotificationView[] | null>(null);

async function load() {
  await attempt(async () => {
    const view = await myNotifications();
    items.value = [...view.notifications];
    inbox.unread = view.unread;
  });
}

async function open(n: AppNotificationView) {
  if (!n.readAt) {
    await readNotification(n.notificationId).catch(() => undefined);
    void refreshUnread();
  }
  await router.push(n.link);
}

async function readAll() {
  await attempt(async () => {
    const view = await readAllNotifications();
    items.value = [...view.notifications];
    inbox.unread = view.unread;
  }, 'All marked as read');
}

onMounted(load);
</script>

<template>
  <q-page padding>
    <div class="ustp-page ustp-content">
      <div>
        <h1 class="text-h5 q-my-none">Notifications</h1>
        <p class="q-mb-none">
          What has happened that is yours to see, newest first, kept for 90 days. To have them by email too, as each comes or
          once a day or week, choose on your <router-link to="/account">Account page</router-link>.
        </p>
      </div>
      <div class="ustp-actions">
        <q-btn outline no-caps color="primary" icon="mail" label="Messages" to="/messages" />
        <q-btn v-if="inbox.unread" flat no-caps color="primary" icon="done_all" label="Mark all read" @click="readAll" />
      </div>
      <q-list v-if="items?.length" bordered separator class="rounded-borders" aria-label="Your notifications">
        <q-item v-for="n in items" :key="n.notificationId" clickable :class="{ 'text-weight-bold': !n.readAt }" @click="open(n)">
          <q-item-section avatar>
            <q-icon :name="NOTIFICATION_ICONS[n.kind]" :color="n.readAt ? 'grey-7' : 'primary'" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ notificationLine(n) }}</q-item-label>
            <q-item-label caption>{{ n.readAt ? 'Read' : 'Unread' }} · {{ whenText(n.updatedAt) }}</q-item-label>
          </q-item-section>
          <q-item-section side><q-icon name="chevron_right" /></q-item-section>
        </q-item>
      </q-list>
      <p v-else-if="items" class="text-grey-7 q-my-none">You have no notifications.</p>
    </div>
  </q-page>
</template>
