<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { MfaPolicyRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { attempt, dialog } from '../../dialogs.js';
import { session } from '../../session.js';

/**
 * Whether members without an admin role, and whether Site Admins, must use two-step verification, and whether System
 * and Site Admins must sign in with Google (design §4). System Admins always need two-step verification.
 */
const policy = ref<MfaPolicyRecord | null>(null);
const draft = ref(false);
const siteDraft = ref(true);
const googleDraft = ref(false);
const changed = computed(
  () =>
    !!policy.value &&
    (draft.value !== policy.value.membersRequired ||
      siteDraft.value !== policy.value.siteAdminsRequired ||
      googleDraft.value !== !!policy.value.adminsGoogleRequired),
);
const changedBy = computed(() => {
  const by = policy.value?.updatedBy;
  return by && by === session.me?.account?.accountId ? 'you' : by;
});

async function load() {
  await attempt(async () => {
    policy.value = await api<MfaPolicyRecord>('GET', '/v1/admin/mfa-policy');
    draft.value = policy.value.membersRequired;
    siteDraft.value = policy.value.siteAdminsRequired;
    googleDraft.value = !!policy.value.adminsGoogleRequired;
  });
}

/** What the save changed, in words, for the notice after it. */
function savedText(before: MfaPolicyRecord): string {
  const parts: string[] = [];
  if (draft.value !== before.membersRequired) {
    parts.push(draft.value ? 'Two-step verification is now required of everyone' : 'Two-step verification is now up to each member');
  }
  if (siteDraft.value !== before.siteAdminsRequired) {
    parts.push(siteDraft.value ? 'Site Admins now need two-step verification on every page' : 'Site Admins no longer need two-step verification');
  }
  if (googleDraft.value !== !!before.adminsGoogleRequired) {
    parts.push(googleDraft.value ? 'System and Site Admins must now sign in with Google' : 'System and Site Admins may sign in any way again');
  }
  return `${parts.join('. ')} (other servers pick this up within a minute)`;
}

async function save() {
  if (!policy.value) return;
  const before = policy.value;
  const ok = await attempt(
    async () => {
      policy.value = await api<MfaPolicyRecord>('PUT', '/v1/admin/mfa-policy', {
        basedOn: before.version,
        membersRequired: draft.value,
        siteAdminsRequired: siteDraft.value,
        adminsGoogleRequired: googleDraft.value,
      });
      draft.value = policy.value.membersRequired;
      siteDraft.value = policy.value.siteAdminsRequired;
      googleDraft.value = !!policy.value.adminsGoogleRequired;
    },
    savedText(before),
  );
  if (!ok) await load();
}

/** Asks first when the save requires it of everyone, or lets Site Admins go without it. */
function confirmSave() {
  if (!policy.value) return;
  const requiring = draft.value && !policy.value.membersRequired;
  const relaxing = !siteDraft.value && policy.value.siteAdminsRequired;
  const google = googleDraft.value && !policy.value.adminsGoogleRequired;
  if (!requiring && !relaxing && !google) return void save();
  const messages = [
    requiring &&
      'Everyone who has not set it up will be asked to, on their account page, before they can do anything else on ' +
        'the site, voting and applying to join included. Nobody is signed out.',
    relaxing &&
      'Site Admins will be able to sign in with only a password and still change roles and the site\'s settings, use ' +
        'any other admin role they hold and the testing tools, even while it is required of every member.',
    google &&
      'System and Site Admins signed in with a password will be refused the admin tools, this page included, until ' +
        'they sign in with Google. Those roles will only be granted to accounts that have signed in with Google.',
  ].filter(Boolean);
  dialog({
    title:
      [requiring, relaxing, google].filter(Boolean).length > 1
        ? 'Save these sign-in settings?'
        : google
          ? 'Require Google sign-in of admins?'
          : requiring
            ? 'Require two-step verification?'
            : 'Let Site Admins sign in without it?',
    message: messages.join(' '),
    ok: { label: requiring && !relaxing ? 'Require it' : 'Save', color: 'primary', noCaps: true },
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
      <q-item tag="label">
        <q-item-section>
          <q-item-label>Require it of Site Admins</q-item-label>
          <q-item-label caption>
            On: Site Admins must use it on every page, as System Admins do. Off: a Site Admin signs in without it and
            can change roles and settings with only a password. That covers any other admin role they hold and the
            testing tools, and holds even while it is required of every member.
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-toggle v-model="siteDraft" aria-label="Require two-step verification of Site Admins" />
        </q-item-section>
      </q-item>
      <q-item tag="label">
        <q-item-section>
          <q-item-label>Require Google sign-in of System and Site Admins</q-item-label>
          <q-item-label caption>
            On: a System or Site Admin uses the admin tools only when signed in with Google, and those roles are
            granted only to accounts that have signed in with Google. Off: they sign in any way that is switched on.
            You can turn it on only while signed in with Google yourself.
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-toggle v-model="googleDraft" aria-label="Require Google sign-in of System and Site Admins" />
        </q-item-section>
      </q-item>
    </q-list>
    <q-card-section class="q-pt-none">
      System Admins always need two-step verification, on every page, whatever this says. Every other admin role
      needs it for the admin tools.
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
