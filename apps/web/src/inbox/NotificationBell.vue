<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AppNotificationView } from 'ustp-domain';
import { announce } from '../a11y.js';
import { myNotifications, readAllNotifications, readNotification } from './api.js';
import { inbox, refreshUnread, watchUnread } from './inbox-state.js';
import { badgeText, bellLabel, notificationLine, whenText } from './inbox-text.js';

/**
 * The bell in the header (design §10.13): how many notifications are unread, and the latest of them in a menu, each
 * leading to what it is about. Opening one marks it read. Shown to whoever is signed in with an account.
 */
const router = useRouter();
const items = ref<AppNotificationView[] | null>(null);
const failed = ref(false);
let stop: (() => void) | undefined;

onMounted(() => (stop = watchUnread()));
onBeforeUnmount(() => stop?.());

async function load() {
  failed.value = false;
  try {
    const view = await myNotifications();
    items.value = view.notifications.slice(0, 8);
    inbox.unread = view.unread;
  } catch {
    failed.value = true;
  }
}

async function open(n: AppNotificationView) {
  if (!n.readAt) {
    await readNotification(n.notificationId).catch(() => undefined);
    void refreshUnread();
  }
  await router.push(n.link);
}

async function readAll() {
  try {
    const view = await readAllNotifications();
    items.value = view.notifications.slice(0, 8);
    inbox.unread = view.unread;
    announce('All notifications marked as read.');
  } catch {
    announce('They could not be marked as read. Try again.');
  }
}
</script>

<template>
  <q-btn flat round icon="notifications" :aria-label="bellLabel(inbox.unread)">
    <q-badge v-if="inbox.unread" floating color="red-9" text-color="white" :label="badgeText(inbox.unread)" aria-hidden="true" />
    <q-menu anchor="bottom right" self="top right" max-width="360px" @before-show="load">
      <q-list style="min-width: 280px; max-width: 360px" aria-label="Notifications">
        <q-item-label header class="row items-center no-wrap q-pb-sm">
          <span class="col">Notifications</span>
          <q-btn v-if="inbox.unread" flat dense no-caps size="sm" color="primary" label="Mark all read" @click="readAll" />
        </q-item-label>
        <q-item v-if="failed">
          <q-item-section class="text-negative">The notifications could not be loaded.</q-item-section>
        </q-item>
        <q-item v-else-if="items && !items.length">
          <q-item-section class="text-grey-7">Nothing yet.</q-item-section>
        </q-item>
        <q-item v-for="n in items ?? []" :key="n.notificationId" v-close-popup clickable :class="{ 'text-weight-bold': !n.readAt }" @click="open(n)">
          <q-item-section avatar>
            <q-icon :name="n.kind === 'message' ? 'mail' : 'flag'" :color="n.readAt ? 'grey-7' : 'primary'" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ notificationLine(n) }}</q-item-label>
            <q-item-label caption>{{ n.readAt ? '' : 'Unread · ' }}{{ whenText(n.updatedAt) }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-separator />
        <q-item v-close-popup clickable to="/notifications">
          <q-item-section>See all notifications</q-item-section>
        </q-item>
        <q-item v-close-popup clickable to="/messages">
          <q-item-section>Messages</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>
