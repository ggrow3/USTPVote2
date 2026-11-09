<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NOTIFICATION_EMAIL_CHOICES, type NotificationEmailChoice, type NotificationEmailView } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { notificationEmail, setNotificationEmail } from './api.js';
import { EMAIL_CHOICE_LABELS, emailCaveat } from './inbox-text.js';

/**
 * How the member has their in-app notifications by email (design §10.13), on the Account page: not at all (the default),
 * as each comes, or a daily or weekly digest of what they have not read. Always within their unsubscribe and the site's
 * email switches, which the card says when they keep these from coming.
 */
const view = ref<NotificationEmailView | null>(null);
const saving = ref(false);
const options = NOTIFICATION_EMAIL_CHOICES.map((c) => ({ value: c, label: EMAIL_CHOICE_LABELS[c].label }));
const caveat = computed(() => (view.value ? emailCaveat(view.value) : null));
const next = computed(() =>
  view.value?.digestDueAt ? new Date(view.value.digestDueAt).toLocaleString(undefined, { weekday: 'long', dateStyle: 'medium', timeStyle: 'short' }) : null,
);

onMounted(() =>
  attempt(async () => {
    view.value = await notificationEmail();
  }),
);

async function choose(choice: NotificationEmailChoice) {
  if (!view.value || choice === view.value.notificationEmail) return;
  saving.value = true;
  await attempt(async () => {
    view.value = await setNotificationEmail(choice);
  }, 'Saved');
  saving.value = false;
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <h2 class="text-subtitle1">Notifications by email</h2>
      <p class="q-mb-none">
        Your notifications (new messages from members, for one) are under the bell at the top of each page. You can have
        them by email too. What a member wrote is never in these emails, only who wrote.
      </p>
    </q-card-section>
    <q-card-section v-if="view" class="q-pt-none">
      <q-option-group
        :model-value="view.notificationEmail"
        :options="options"
        type="radio"
        :disable="saving"
        aria-label="Notifications by email"
        @update:model-value="choose"
      >
        <template #label="opt">
          <div>
            <div>{{ opt.label }}</div>
            <div class="text-caption text-grey-7">{{ EMAIL_CHOICE_LABELS[opt.value as NotificationEmailChoice].caption }}</div>
          </div>
        </template>
      </q-option-group>
      <p v-if="next && !caveat" class="q-mt-sm q-mb-none text-grey-8">The next one is due {{ next }}.</p>
      <p v-if="caveat" class="q-mt-sm q-mb-none text-negative" role="status">{{ caveat }}</p>
    </q-card-section>
  </q-card>
</template>
