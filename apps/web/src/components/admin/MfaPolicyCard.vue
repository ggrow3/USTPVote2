<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { MfaPolicyRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { attempt, dialog } from '../../dialogs.js';
import { session } from '../../session.js';

/** Whether members without an admin role must use two-step verification (design §4). System Admins always must. */
const policy = ref<MfaPolicyRecord | null>(null);
const draft = ref(false);
const changed = computed(() => !!policy.value && draft.value !== policy.value.membersRequired);
const changedBy = computed(() => {
  const by = policy.value?.updatedBy;
  return by && by === session.me?.account?.accountId ? 'you' : by;
});

async function load() {
  await attempt(async () => {
    policy.value = await api<MfaPolicyRecord>('GET', '/v1/admin/mfa-policy');
    draft.value = policy.value.membersRequired;
  });
}

async function save() {
  if (!policy.value) return;
  const ok = await attempt(
    async () => {
      policy.value = await api<MfaPolicyRecord>('PUT', '/v1/admin/mfa-policy', {
        basedOn: policy.value!.version,
        membersRequired: draft.value,
      });
      draft.value = policy.value.membersRequired;
    },
    draft.value
      ? 'Two-step verification is now required of everyone (other servers pick this up within a minute)'
      : 'Two-step verification is now up to each member (System Admins still need it)',
  );
  if (!ok) await load();
}

function confirmSave() {
  if (!draft.value) return void save();
  dialog({
    title: 'Require two-step verification?',
    message:
      'Everyone who has not set it up will be asked to, on their account page, before they can do anything else on ' +
      'the site, voting and applying to join included. Nobody is signed out.',
    ok: { label: 'Require it', color: 'primary', noCaps: true },
    cancel: true,
    focus: 'cancel',
  }).onOk(() => void save());
}

onMounted(load);
</script>

<template>
  <q-card v-if="policy" flat bordered>
    <q-card-section>
      <h2 class="text-subtitle1">Two-step verification</h2>
      <div class="text-caption text-grey-7">A code from an authenticator app, asked for each time someone signs in.</div>
    </q-card-section>
    <q-list>
      <q-item tag="label">
        <q-item-section>
          <q-item-label>Require it of every member</q-item-label>
          <q-item-label caption>
            On: everyone must set it up and sign in with it before they can use anything but their account page.
            Off: members without an admin role choose for themselves.
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-toggle v-model="draft" aria-label="Require two-step verification of every member" />
        </q-item-section>
      </q-item>
    </q-list>
    <q-card-section class="q-pt-none">
      System Admins always need it, on every page, whatever this says. Every other admin role needs it for the admin
      tools.
      <div v-if="policy.updatedAt" class="text-caption text-grey-7 q-mt-sm">
        Last changed {{ new Date(policy.updatedAt).toLocaleString() }}
        <template v-if="changedBy === 'you'">by you</template>
        <template v-else-if="changedBy">by account <code>{{ changedBy }}</code></template>. The audit ledger records each change.
      </div>
    </q-card-section>
    <q-card-section class="ustp-actions">
      <q-btn color="primary" label="Save" :disable="!changed" @click="confirmSave" />
    </q-card-section>
  </q-card>
</template>
