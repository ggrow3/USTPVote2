<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { MailHealthView } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { mailHealth, requestMailCheck } from './api.js';
import { healthSummary, MAIL_CHECK_LABELS, MAIL_CHECK_LOOK } from './mail-health-text.js';

/**
 * The email setup check (design §10.12), for System Admins: whether Amazon SES is set up so that members get their email,
 * check by check, with the infra README step that fixes each one, and a run on request. The worker runs it; this page
 * asks and reads. It polls while a run or the test messages' reports are awaited.
 */
const view = ref<MailHealthView | null>(null);
const health = computed(() => view.value?.health ?? null);
// A run asked for, or the probe's reports still awaited, whatever the other checks say.
const waiting = computed(() => !!view.value?.requested || !!health.value?.checks.some((c) => c.status === 'pending'));
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  await attempt(async () => {
    view.value = await mailHealth();
  });
}

async function checkNow() {
  await attempt(async () => {
    view.value = await requestMailCheck();
  }, 'The worker runs the check within a minute.');
}

onMounted(async () => {
  await load();
  timer = setInterval(() => {
    if (waiting.value) void load();
  }, 20_000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <h2 class="text-subtitle1">Email setup check</h2>
      <p class="q-mt-sm q-mb-none">
        Whether Amazon SES is set up so that members get their email: the account, the sender domain and its DNS records,
        the delivery reports and the bounce and complaint rates, ending with three messages to SES's mailbox simulator, which
        reach nobody, to see their reports come back. Only whether a mail server took each message is ever known: the emails
        carry no tracking image, and their links go straight to the site.
      </p>
    </q-card-section>
    <q-card-section v-if="view" class="q-pt-none">
      <p class="q-mb-sm" role="status">{{ healthSummary(health) }}</p>
      <p v-if="view.requested" class="q-mb-sm text-caption">A check is waiting for the worker; it runs within a minute.</p>
      <q-btn color="primary" no-caps label="Check now" :disable="!!view.requested" @click="checkNow" />
    </q-card-section>
    <q-list v-if="health" separator bordered class="q-mx-md q-mb-md rounded-borders">
      <q-item v-for="c in health.checks" :key="c.id">
        <q-item-section avatar>
          <q-icon :name="MAIL_CHECK_LOOK[c.status].icon" :color="MAIL_CHECK_LOOK[c.status].color" aria-hidden="true" />
        </q-item-section>
        <q-item-section>
          <q-item-label>
            {{ MAIL_CHECK_LABELS[c.id] }}: <span :class="`text-${MAIL_CHECK_LOOK[c.status].color}`">{{ MAIL_CHECK_LOOK[c.status].word }}</span>
          </q-item-label>
          <q-item-label caption>{{ c.detail }}</q-item-label>
          <q-item-label v-if="c.fix && (c.status === 'fail' || c.status === 'warn')" caption>
            To fix: infra README, “Email (Amazon SES)” › {{ c.fix }}
          </q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>
