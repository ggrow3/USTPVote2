<script setup lang="ts">
import type { Auth, MultiFactorInfo, UserCredential } from 'firebase/auth';
import { useQuasar } from 'quasar';
import { computed, onMounted, ref, shallowRef } from 'vue';
import type { IdentityRecord, SignInProvider } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import AuthenticatorSetupDialog from '../components/AuthenticatorSetupDialog.vue';
import ChangePasswordDialog from '../components/ChangePasswordDialog.vue';
import PageShell from '../components/PageShell.vue';
import ProfilePhotoCard from '../components/ProfilePhotoCard.vue';
import DailyQuoteSettings from '../daily/DailyQuoteSettings.vue';
import { confirmIdentity, dialog } from '../dialogs.js';
import { auth, secondaryAuth } from '../firebase.js';
import { enrolledFactors, removeFactor } from '../mfa.js';
import { resign as resignMembership } from '../membership/api.js';
import { classOf, memberClassText } from '../membership/class-text.js';
import MyDetailsCard from '../membership/MyDetailsCard.vue';
import MyEmailCard from '../notifications/MyEmailCard.vue';
import InviteCard from '../referrals/InviteCard.vue';
import NotificationEmailCard from '../inbox/NotificationEmailCard.vue';
import { refreshMe, secondFactorMissing, session } from '../session.js';
import { federatedProvidersOf, PROVIDER_LABELS, signInWithPassword, signInWithProvider, type FederatedProvider } from '../sign-in.js';

const $q = useQuasar();
usePageTitle('Your account');
const enabled = ref<Record<SignInProvider, boolean> | null>(null);
const busy = ref(false);
const factors = shallowRef<MultiFactorInfo[]>(enrolledFactors(auth.currentUser));
const settingUp = ref(false);
const changingPassword = ref(false);
const mfa = computed(() => session.me?.mfa);

const me = computed(() => session.me);
/** The site needs a second factor before anything else (design §4), so the rest of the page waits until they use one. */
const locked = computed(() => secondFactorMissing());
/** Why this person needs two-step verification, and what to do next. */
const mfaNotice = computed(() => {
  if (!mfa.value?.required || (factors.value.length && mfa.value.signedInWithMfa)) return null;
  const why = !mfa.value.everywhere
    ? 'Your admin role requires two-step verification for the admin tools.'
    : me.value?.roles.includes('system_admin')
      ? 'System Admins must use two-step verification on every page.'
      : me.value?.roles.includes('site_admin')
        ? 'You need two-step verification on every page.'
        : 'This site requires two-step verification of everyone.';
  return factors.value.length
    ? `${why} Enter a code from your authenticator app to continue.`
    : `${why} Set up an authenticator app here first.`;
});
const identities = computed<readonly IdentityRecord[]>(() => me.value?.identities ?? []);
const linkable = computed(() =>
  (['google.com', 'microsoft.com', 'apple.com'] as const).filter(
    (p) =>
      enabled.value?.[p] &&
      !identities.value.some((i) => i.provider === p) &&
      // Added to the signed-in login itself, as "Use Google instead" does (design §5.13): it is there already.
      !(session.user && federatedProvidersOf(auth.currentUser).includes(p)),
  ),
);
/** The email login they are signed in with, whose password they can change here (design §4). */
const isCurrentPasswordLogin = (identity: IdentityRecord) =>
  identity.provider === 'password' && identity.uid === session.user?.uid;
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
  dialog({
    title: 'Link an email & password login',
    message: 'Sign in with the existing email & password login you want to add to this account.',
    html: false,
    prompt: { model: '', type: 'email', label: 'Email' },
    cancel: true,
  }).onOk((email: string) => {
    dialog({ title: 'Password', prompt: { model: '', type: 'password', label: 'Password' }, cancel: true }).onOk(
      (password: string) => act(() => link((a) => signInWithPassword(a, email, password)), 'Email login linked'),
    );
  });
}

function unlink(identity: IdentityRecord) {
  dialog({
    title: 'Remove login method',
    message: `Remove ${PROVIDER_LABELS[identity.provider]} (${identity.email ?? identity.uid}) from your account?`,
    cancel: true,
    focus: 'cancel',
  }).onOk(() => act(() => api('DELETE', `/v1/me/identities/${encodeURIComponent(identity.uid)}`), 'Login removed'));
}

function resign() {
  dialog({
    title: 'Resign membership',
    message: 'You can re-apply later. Optionally tell us why:',
    prompt: { model: '', type: 'textarea', label: 'Reason (optional)' },
    cancel: true,
  }).onOk((reason: string) => act(() => resignMembership(reason.trim() ? reason : undefined), 'You have resigned'));
}

async function onEnrolled() {
  factors.value = enrolledFactors(auth.currentUser);
  await refreshMe();
  $q.notify({ type: 'positive', message: 'Two-step verification is on. You will be asked for a code when you sign in.' });
}

/** Signs in again with a code from the authenticator app, so this session counts as two-step from now on. */
async function signInWithCode() {
  if (!(await confirmIdentity())) return;
  await refreshMe().catch(() => undefined);
  if (mfa.value?.signedInWithMfa) $q.notify({ type: 'positive', message: 'Signed in with two-step verification' });
}

function removeDevice(factor: MultiFactorInfo) {
  const lastNeeded = mfa.value?.required && factors.value.length === 1;
  const consequence = !lastNeeded
    ? ''
    : mfa.value?.everywhere
      ? ' You need two-step verification to use the site, so you will have to set it up again.'
      : ' Your admin role requires two-step verification, so you will lose access to the admin tools.';
  dialog({
    title: 'Remove two-step device',
    message: `Remove "${factor.displayName ?? 'authenticator app'}"?${consequence}`,
    cancel: true,
    focus: 'cancel',
  }).onOk(() =>
    act(async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        await removeFactor(user, factor);
      } catch (e) {
        if ((e as { code?: unknown }).code !== 'auth/requires-recent-login' || !(await confirmIdentity())) throw e;
        await removeFactor(user, factor);
      }
      factors.value = enrolledFactors(auth.currentUser);
    }, 'Two-step device removed'),
  );
}

async function onPasswordChanged(signInAgain: boolean) {
  await refreshMe().catch(() => undefined);
  if (!signInAgain) {
    $q.notify({ type: 'positive', message: 'Password changed. This login is signed out everywhere else.' });
    return;
  }
  $q.notify({
    type: 'warning',
    timeout: 0,
    message: 'Password changed. Sign out and in again with it before you vote or use the admin tools.',
    actions: [{ label: 'Dismiss', color: 'black' }],
  });
}

function copyId() {
  void navigator.clipboard?.writeText(me.value?.account?.accountId ?? '');
  $q.notify({ message: 'Account ID copied' });
}
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <h1 class="text-h5">Your account</h1>
      <div v-if="!me?.account" class="text-grey-7">Loading…</div>
      <template v-else>
        <q-card flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">{{ me.account.displayName || me.account.primaryEmail }}</h2>
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
            <h2 class="text-subtitle1">Membership</h2>
          </q-card-section>
          <q-card-section>
            <template v-if="me.member">
              <q-badge :label="me.member.status" color="primary" />
              <span v-if="me.member.memberSince" class="q-ml-sm text-grey-7">
                member since {{ new Date(me.member.memberSince).toLocaleDateString() }}
              </span>
              <!-- From the application's first question: eligible to vote in any US elections (design §5.2). -->
              <div v-if="classOf(me.member)" class="q-mt-sm">{{ memberClassText(me.member.usVoteEligible) }}</div>
            </template>
            <div v-else>Not a member yet. <router-link to="/register">Apply for membership</router-link>.</div>
          </q-card-section>
          <q-card-section v-if="canResign && !locked" class="ustp-actions">
            <q-btn flat color="negative" label="Resign" :disable="busy" @click="resign" />
          </q-card-section>
        </q-card>

        <!-- Saving any of these needs the second factor the site requires (design §4), so they wait for it. -->
        <template v-if="!locked">
          <MyDetailsCard />

          <InviteCard v-if="me.member?.status === 'active'" />

          <MyEmailCard />

          <NotificationEmailCard />

          <ProfilePhotoCard v-if="me.member" />

          <DailyQuoteSettings />
        </template>

        <q-card flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Two-step verification</h2>
            <div class="text-caption text-grey-7">
              A code from an authenticator app, asked for each time you sign in. Required for admin roles, and of
              everyone when the site says so.
            </div>
          </q-card-section>
          <q-card-section v-if="mfaNotice">
            <q-banner class="bg-orange-2 text-black" rounded>
              {{ mfaNotice }}
              <template v-if="factors.length" #action>
                <q-btn flat no-caps color="black" label="Enter a code" :disable="busy" @click="signInWithCode" />
              </template>
            </q-banner>
          </q-card-section>
          <q-list v-if="factors.length" separator>
            <q-item v-for="f in factors" :key="f.uid">
              <q-item-section>
                <q-item-label>{{ f.displayName ?? 'Authenticator app' }}</q-item-label>
                <q-item-label caption>added {{ new Date(f.enrollmentTime).toLocaleDateString() }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense color="negative" label="Remove" :disable="busy" @click="removeDevice(f)">
                  <span class="sr-only">&nbsp;{{ f.displayName ?? 'authenticator app' }}</span>
                </q-btn>
              </q-item-section>
            </q-item>
          </q-list>
          <q-card-section class="ustp-actions">
            <q-btn outline no-caps color="primary" label="Set up an authenticator app" :disable="busy" @click="settingUp = true" />
          </q-card-section>
        </q-card>
        <AuthenticatorSetupDialog v-model="settingUp" @enrolled="onEnrolled" />

        <p v-if="locked" class="text-grey-7">
          Your details, photo, daily quote and login methods appear here once you have signed in with two-step
          verification.
        </p>
        <q-card v-else flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Login methods</h2>
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
              <q-item-section v-if="isCurrentPasswordLogin(i)" side>
                <q-btn flat dense no-caps color="primary" label="Change password" :disable="busy" @click="changingPassword = true" />
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense color="negative" label="Remove" :disable="busy || identities.length <= 1" @click="unlink(i)">
                  <span class="sr-only">&nbsp;{{ PROVIDER_LABELS[i.provider] }} login {{ i.email ?? '' }}</span>
                </q-btn>
              </q-item-section>
            </q-item>
          </q-list>
          <q-card-section class="ustp-actions">
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
          </q-card-section>
        </q-card>
        <ChangePasswordDialog v-model="changingPassword" @changed="onPasswordChanged" />
      </template>
    </div>
  </PageShell>
</template>
