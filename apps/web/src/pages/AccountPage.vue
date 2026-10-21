<script setup lang="ts">
import type { Auth, UserCredential } from 'firebase/auth';
import { useQuasar } from 'quasar';
import { computed, onMounted, ref } from 'vue';
import type { IdentityRecord, SignInProvider } from 'ustp-domain';
import { api, errorMessage } from '../api.js';
import { secondaryAuth } from '../firebase.js';
import { refreshMe, session } from '../session.js';
import { PROVIDER_LABELS, signInWithPassword, signInWithProvider, type FederatedProvider } from '../sign-in.js';

const $q = useQuasar();
const enabled = ref<Record<SignInProvider, boolean> | null>(null);
const busy = ref(false);

const me = computed(() => session.me);
const identities = computed<readonly IdentityRecord[]>(() => me.value?.identities ?? []);
const linkable = computed(() =>
  (['google.com', 'microsoft.com', 'apple.com'] as const).filter(
    (p) => enabled.value?.[p] && !identities.value.some((i) => i.provider === p),
  ),
);
const canResign = computed(() => ['active', 'lapsed', 'suspended'].includes(me.value?.member?.status ?? ''));

onMounted(async () => {
  enabled.value = await api<Record<SignInProvider, boolean>>('GET', '/v1/sign-in-methods').catch(() => null);
});

async function act(action: () => Promise<unknown>, success: string) {
  busy.value = true;
  try {
    await action();
    await refreshMe();
    $q.notify({ type: 'positive', message: success });
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    busy.value = false;
  }
}

/** Proves control of another login in a throwaway Auth instance, then links its uid to this account. */
async function link(signIn: (auth: Auth) => Promise<UserCredential>) {
  const secondary = secondaryAuth();
  try {
    const credential = await signIn(secondary.auth);
    await api('POST', '/v1/me/identities', { idToken: await credential.user.getIdToken() });
  } finally {
    await secondary.dispose();
  }
}

function linkProvider(p: FederatedProvider) {
  return act(() => link((a) => signInWithProvider(a, p)), `${PROVIDER_LABELS[p]} login linked`);
}

function linkPassword() {
  $q.dialog({
    title: 'Link an email & password login',
    message: 'Sign in with the existing email & password login you want to add to this account.',
    html: false,
    prompt: { model: '', type: 'email', label: 'Email' },
    cancel: true,
  }).onOk((email: string) => {
    $q.dialog({ title: 'Password', prompt: { model: '', type: 'password', label: 'Password' }, cancel: true }).onOk(
      (password: string) => act(() => link((a) => signInWithPassword(a, email, password)), 'Email login linked'),
    );
  });
}

function unlink(identity: IdentityRecord) {
  $q.dialog({
    title: 'Remove login method',
    message: `Remove ${PROVIDER_LABELS[identity.provider]} (${identity.email ?? identity.uid}) from your account?`,
    cancel: true,
  }).onOk(() => act(() => api('DELETE', `/v1/me/identities/${encodeURIComponent(identity.uid)}`), 'Login removed'));
}

function resign() {
  $q.dialog({
    title: 'Resign membership',
    message: 'You can re-apply later. Optionally tell us why:',
    prompt: { model: '', type: 'textarea' },
    cancel: true,
  }).onOk((reason: string) => act(() => api('POST', '/v1/me/resign', reason.trim() ? { reason } : {}), 'You have resigned'));
}

function copyId() {
  void navigator.clipboard?.writeText(me.value?.account?.accountId ?? '');
  $q.notify({ message: 'Account ID copied' });
}
</script>

<template>
  <q-page padding>
    <div class="text-h5 q-mb-md">Your account</div>
    <div v-if="!me?.account" class="text-grey-7">Loading…</div>
    <div v-else class="column q-gutter-md" style="max-width: 720px">
      <q-card flat bordered>
        <q-card-section>
          <div class="text-subtitle1">{{ me.account.displayName || me.account.primaryEmail }}</div>
          <div class="text-caption text-grey-7">
            Account ID <code>{{ me.account.accountId }}</code>
            <q-btn flat dense round size="sm" icon="content_copy" aria-label="Copy account ID" @click="copyId" />
          </div>
          <div v-if="me.roles.length" class="q-mt-sm">
            <q-chip v-for="r in me.roles" :key="r" dense color="primary" text-color="white">{{ r.replace('_', ' ') }}</q-chip>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section>
          <div class="text-subtitle1 q-mb-sm">Membership</div>
          <template v-if="me.member">
            <q-badge :label="me.member.status" color="primary" />
            <span v-if="me.member.memberSince" class="q-ml-sm text-grey-7">
              member since {{ new Date(me.member.memberSince).toLocaleDateString() }}
            </span>
          </template>
          <div v-else>Not a member yet. <router-link to="/register">Apply for membership</router-link>.</div>
        </q-card-section>
        <q-card-actions v-if="canResign">
          <q-btn flat color="negative" label="Resign" :disable="busy" @click="resign" />
        </q-card-actions>
      </q-card>

      <q-card flat bordered>
        <q-card-section>
          <div class="text-subtitle1">Login methods</div>
          <div class="text-caption text-grey-7">
            Your account and voting record stay the same whichever of these you sign in with.
          </div>
        </q-card-section>
        <q-list separator>
          <q-item v-for="i in identities" :key="i.uid">
            <q-item-section>
              <q-item-label>{{ PROVIDER_LABELS[i.provider] }}</q-item-label>
              <q-item-label caption>{{ i.email ?? i.uid }} · linked {{ new Date(i.linkedAt).toLocaleDateString() }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat dense color="negative" label="Remove" :disable="busy || identities.length <= 1" @click="unlink(i)" />
            </q-item-section>
          </q-item>
        </q-list>
        <q-card-actions>
          <q-btn
            v-for="p in linkable"
            :key="p"
            outline
            no-caps
            color="primary"
            :disable="busy"
            :label="`Link ${PROVIDER_LABELS[p]}`"
            @click="linkProvider(p)"
          />
          <q-btn v-if="enabled?.password" outline no-caps color="primary" :disable="busy" label="Link email & password" @click="linkPassword" />
        </q-card-actions>
      </q-card>
    </div>
  </q-page>
</template>
