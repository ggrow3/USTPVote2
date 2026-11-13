<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { SET_PASSWORD_PATH } from 'ustp-domain';
import { focusFirstInvalid, usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import { APP_NAME } from '../app-name.js';
import PageShell from '../components/PageShell.vue';
import PasswordInput from '../components/PasswordInput.vue';
import TwoStepCodeCard from '../components/TwoStepCodeCard.vue';
import { auth } from '../firebase.js';
import { session, signOut } from '../session.js';
import {
  completeEmailLink,
  isDeadLink,
  PASSWORD_HINT,
  PasswordRejected,
  passwordProblem,
  pendingEmailLink,
  sendEmailLink,
  setOwnPassword,
} from '../sign-in.js';
import { useSignInFlow } from '../sign-in-flow.js';

/**
 * Where a member a Membership Admin added sets their own password (design §5.13), and anyone else a new one. The
 * address is proved first by an emailed sign-in link (Identity Platform's: the welcome email's button is one, and the
 * page sends another on request): signing in with it links the login to the added membership, since the api links an
 * account only to a verified address. Then they choose a password, under the sign-up rules, which also ends every other
 * session of that login.
 */
usePageTitle('Set your password');
const router = useRouter();

/** The sign-in link this page was opened with, if any: the welcome email's, or one the page sent. */
const emailLink = ref(pendingEmailLink(auth));
const email = ref('');
const notice = ref<string | null>(null);
const { busy, error, challenge, code, run, submitCode } = useSignInFlow(() => router.replace(SET_PASSWORD_PATH));

onMounted(async () => {
  if (emailLink.value.isLink && emailLink.value.email) await finishLink(emailLink.value.email);
});

/**
 * Signs in with the link the page was opened with. One that has expired or was used already (a welcome email opened
 * days later, say) leaves the link behind and offers a new one to the address typed (design §5.13).
 */
function finishLink(address: string) {
  return run(async () => {
    try {
      return await completeEmailLink(auth, address);
    } catch (e) {
      if (!isDeadLink(e)) throw e;
      emailLink.value = { isLink: false, email: null };
      email.value = address;
      await router.replace(SET_PASSWORD_PATH);
      throw new Error('This link has expired or has been used already. Email yourself a new one below.');
    }
  });
}

function sendLink() {
  const address = email.value.trim();
  if (!address) {
    error.value = 'Enter your email address.';
    return;
  }
  return run(async () => {
    await sendEmailLink(auth, address, SET_PASSWORD_PATH);
    notice.value = `We emailed a sign-in link to ${address}. Open it in this browser to continue.`;
  });
}

/** Signed in and the account has loaded (or failed to, as for an address not verified yet). */
const signedIn = computed(() => !!session.user && !session.loading);
const member = computed(() => session.me?.member ?? null);
const name = computed(() => member.value?.preferredName || member.value?.legalName || null);

const password = ref('');
const confirm = ref('');
const passwordError = ref<string | null>(null);
const saving = ref(false);
const done = ref(false);
/** The password is set, and signing in again with it needs the second step: they sign in on the sign-in page. */
const signInAgain = ref(false);
/** Setting a password needs a recent sign-in; an old one gets a fresh link instead. */
const staleSignIn = ref(false);

async function savePassword() {
  passwordError.value =
    passwordProblem(password.value, session.user?.email ?? '') ?? (password.value !== confirm.value ? 'The two passwords differ.' : null);
  if (passwordError.value) return focusFirstInvalid();
  const user = auth.currentUser;
  if (!user) return;
  saving.value = true;
  try {
    const email = user.email;
    if (!(await setOwnPassword(auth, user, password.value))) {
      signInAgain.value = true;
      notice.value = `Your password is set. Sign in with ${email ?? 'your email address'} and your new password.`;
    }
    done.value = true;
    password.value = '';
    confirm.value = '';
  } catch (e) {
    if (e instanceof PasswordRejected) passwordError.value = e.message;
    else if ((e as { code?: string }).code === 'auth/requires-recent-login') staleSignIn.value = true;
    else passwordError.value = errorMessage(e);
    if (passwordError.value) await focusFirstInvalid();
  } finally {
    saving.value = false;
  }
}

async function freshLink() {
  const address = session.user?.email;
  if (!address) return;
  await signOut();
  staleSignIn.value = false;
  email.value = address;
  await sendLink();
}
</script>

<template>
  <PageShell width="narrow">
    <div class="ustp-content ustp-narrow">
      <h1 class="text-h5">Set your password</h1>

      <q-banner v-if="error" class="bg-negative text-white" rounded>{{ error }}</q-banner>
      <q-banner v-if="notice" class="bg-positive text-white" rounded role="status">{{ notice }}</q-banner>

      <TwoStepCodeCard v-if="challenge" v-model:code="code" :busy="busy" @submit="submitCode" @cancel="challenge = null" />

      <q-card v-else-if="signInAgain" flat bordered>
        <q-card-section class="ustp-actions">
          <q-btn color="primary" no-caps label="Sign in" to="/signin" />
        </q-card-section>
      </q-card>

      <template v-else-if="!session.user">
        <q-card v-if="emailLink.isLink && !emailLink.email" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Confirm your email address</h2>
            <div class="text-caption text-grey-7">Enter the address the sign-in link was sent to.</div>
          </q-card-section>
          <q-card-section>
            <q-form class="ustp-form" @submit.prevent="finishLink(email.trim())">
              <q-input v-model="email" type="email" label="Email address" outlined dense autocomplete="email" />
              <div class="ustp-actions">
                <q-btn type="submit" color="primary" no-caps label="Continue" :loading="busy" />
              </div>
            </q-form>
          </q-card-section>
        </q-card>

        <q-card v-else flat bordered>
          <q-card-section class="ustp-stack">
            <p>
              If a Membership Admin has added you as a member, enter the email address they have for you. We will email
              you a sign-in link: opening it shows the address is yours, and then you choose your password. Nobody at
              the party sets it or can see it.
            </p>
            <p class="text-caption text-grey-7">
              The same works if you have forgotten your password. If you use Google, Microsoft or Apple with that address,
              you can <router-link to="/signin">sign in with it</router-link> instead.
            </p>
          </q-card-section>
          <q-card-section>
            <q-form class="ustp-form" @submit.prevent="sendLink">
              <q-input v-model="email" type="email" label="Email address" outlined dense autocomplete="email" />
              <div class="ustp-actions">
                <q-btn type="submit" color="primary" no-caps label="Email me a sign-in link" :loading="busy" />
              </div>
            </q-form>
          </q-card-section>
        </q-card>
      </template>

      <div v-else-if="!signedIn" class="text-grey-7">Loading your account…</div>

      <template v-else>
        <q-banner v-if="session.error" class="bg-negative text-white" rounded>{{ session.error }}</q-banner>
        <q-card v-if="member" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Welcome to {{ APP_NAME }}{{ name ? `, ${name}` : '' }}</h2>
            <div class="text-caption text-grey-7">
              You are signed in as {{ session.user?.email }}, and your membership is {{ member.status }}.
            </div>
          </q-card-section>
        </q-card>
        <q-banner v-else-if="session.me" class="bg-grey-3 text-black" rounded>
          No membership is waiting for {{ session.user?.email }}. If a Membership Admin told you they added you, check the
          address with them; otherwise you can <router-link to="/register">register as a member</router-link>.
        </q-banner>

        <q-card v-if="done" flat bordered role="status">
          <q-card-section class="ustp-stack">
            <h2 class="text-subtitle1">Your password is set</h2>
            <p>From now on, sign in with {{ session.user?.email }} and this password.</p>
            <p v-if="session.me?.mfa.everywhere && !session.me.mfa.signedInWithMfa">
              This site also asks for two-step verification: set up an authenticator app on your
              <router-link to="/account">Account page</router-link> next.
            </p>
            <div class="ustp-actions">
              <q-btn v-if="member" color="primary" no-caps label="Go to your ballots" to="/ballot" />
              <q-btn flat no-caps color="primary" label="Your account" to="/account" />
            </div>
          </q-card-section>
        </q-card>

        <q-card v-else-if="staleSignIn" flat bordered>
          <q-card-section class="ustp-stack">
            <p>For your safety, setting a password needs a recent sign-in. We can email you a new sign-in link.</p>
            <div class="ustp-actions">
              <q-btn color="primary" no-caps label="Email me a new link" :loading="busy" @click="freshLink" />
            </div>
          </q-card-section>
        </q-card>

        <q-card v-else-if="session.me" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Choose your password</h2>
            <div class="text-caption text-grey-7">
              {{ PASSWORD_HINT }} We check that it has not appeared in a known data breach without sending it anywhere.
            </div>
          </q-card-section>
          <q-card-section>
            <q-form class="ustp-form" @submit.prevent="savePassword">
              <input type="email" :value="session.user?.email ?? ''" autocomplete="username" class="hidden" aria-hidden="true" tabindex="-1" readonly />
              <PasswordInput
                v-model="password"
                label="New password"
                outlined
                dense
                hide-bottom-space
                autocomplete="new-password"
                :error="!!passwordError"
                :error-message="passwordError ?? undefined"
              />
              <PasswordInput v-model="confirm" label="The same password again" outlined dense autocomplete="new-password" />
              <div class="ustp-actions">
                <q-btn type="submit" color="primary" no-caps label="Set password" :loading="saving" />
              </div>
            </q-form>
          </q-card-section>
        </q-card>
      </template>
    </div>
  </PageShell>
</template>
