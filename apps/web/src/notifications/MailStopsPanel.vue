<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { MailStopRow } from 'ustp-domain';
import { askReason, attempt } from '../dialogs.js';
import { mailStops, restoreMemberEmail, stopMemberEmail } from './api.js';

/**
 * Members who get no email (design §10.12), for Membership and System Admins: those who unsubscribed, which only they can
 * undo, and those an admin stopped email to, which any of these admins can stop or restore, with a written reason. Each
 * stop is ledgered, and the member sees it on their Account page.
 */
const rows = ref<MailStopRow[] | null>(null);
const address = ref('');

async function load() {
  await attempt(async () => {
    rows.value = await mailStops();
  });
}

const date = (iso: string) => new Date(iso).toLocaleDateString();
const who = (row: MailStopRow) => row.name ?? row.email ?? 'A member';

async function stop() {
  const email = address.value.trim();
  if (!email) return;
  const reason = await askReason(
    'Stop email to this member',
    `${email} will get no email from the party, election notices included, until an admin restores it. They will see this on their Account page, and it is recorded in the audit ledger.`,
  );
  if (reason === null) return;
  if (await attempt(() => stopMemberEmail({ email, reason }), 'Email stopped')) {
    address.value = '';
    await load();
  }
}

async function restore(row: MailStopRow) {
  const unsubscribed = row.unsubscribedAt ? ' They also unsubscribed themselves, so they still get nothing until they turn it back on.' : '';
  const reason = await askReason('Restore email to this member', `${who(row)} will get email from the party again.${unsubscribed}`);
  if (reason === null) return;
  if (await attempt(() => restoreMemberEmail(row.accountId, { reason }), 'Email restored')) await load();
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">Members who get no email</h2>
      <p class="q-mb-none">
        These members get no email from the party, election notices included. Someone who unsubscribed can only turn it back
        on themselves. Stopping a member’s email needs a written reason, is recorded in the audit ledger, and shows on their
        Account page; they cannot undo it.
      </p>
    </div>

    <q-form class="ustp-actions" @submit.prevent="stop">
      <q-input v-model="address" outlined dense type="email" label="Member’s email address" maxlength="254" class="col-grow" />
      <q-btn type="submit" outline color="primary" no-caps icon="unsubscribe" label="Stop email" :disable="!address.trim()" />
    </q-form>

    <q-list v-if="rows?.length" separator bordered class="rounded-borders">
      <q-item v-for="row in rows" :key="row.accountId">
        <q-item-section>
          <q-item-label>{{ who(row) }}<template v-if="row.name && row.email"> ({{ row.email }})</template></q-item-label>
          <q-item-label caption>
            <template v-if="row.stoppedAt">Stopped by {{ row.stoppedBy ?? 'an admin' }} on {{ date(row.stoppedAt) }}.</template>
            <template v-if="row.unsubscribedAt"> Unsubscribed on {{ date(row.unsubscribedAt) }}.</template>
          </q-item-label>
        </q-item-section>
        <q-item-section v-if="row.stoppedAt" side>
          <q-btn flat no-caps color="primary" label="Restore" @click="restore(row)" />
        </q-item-section>
      </q-item>
    </q-list>
    <p v-else-if="rows" class="text-grey-7 q-my-none">No member has unsubscribed or had their email stopped.</p>
  </div>
</template>
