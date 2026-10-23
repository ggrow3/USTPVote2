<script setup lang="ts">
import { sendEmailVerification } from 'firebase/auth';
import { useQuasar } from 'quasar';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
  createApplicationSchema,
  mayApply,
  MINIMUM_MEMBER_AGE,
  type ApplicationRecord,
  type BylawsRecord,
  type SignInProvider,
} from 'ustp-domain';
import { focusElement, focusFirstInvalid, focusSoon, usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import TwoStepCodeCard from '../components/TwoStepCodeCard.vue';
import { auth } from '../firebase.js';
import { apiFieldErrors, STATES, validate, type FieldErrors } from '../forms.js';
import { refreshMe, refreshUser, session } from '../session.js';
import {
  MIN_PASSWORD_LENGTH,
  PasswordRejected,
  passwordProblem,
  PROVIDER_LABELS,
  signInWithProvider,
  signUpWithPassword,
  type FederatedProvider,
} from '../sign-in.js';
import { useSignInFlow } from '../sign-in-flow.js';

const $q = useQuasar();
usePageTitle('Register');

/** Registering is one flow (design §5.2): a login, then the application, then a Membership Admin's decision. */
const STEPS = ['Create your login', 'Apply', 'Membership review'] as const;

// Step 1: the login, for visitors who are not signed in.
const enabled = ref<Record<SignInProvider, boolean> | null>(null);
const methodsError = ref<string | null>(null);
const federated = computed(() =>
  (['google.com', 'microsoft.com', 'apple.com'] as const).filter((p) => enabled.value?.[p]),
);
const login = reactive({ email: '', password: '' });
const loginErrors = ref<FieldErrors>({});
const { busy: signingIn, error: signInError, challenge, code, run, submitCode } = useSignInFlow(toNextStep);

// Step 2: the application.
const bylaws = ref<BylawsRecord | null>(null);
const bylawsError = ref<string | null>(null);
const applications = ref<ApplicationRecord[]>([]);
const agreed = ref(false);
const busy = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive({
  legalName: '',
  preferredName: '',
  dateOfBirth: '',
  state: null as string | null,
  city: '',
  postalCode: '',
  phone: '',
  statement: '',
  interests: '',
  skills: '',
  referral: '',
  volunteer: false,
  runForOffice: false,
  newsletter: false,
  announcements: false,
  attestsAge: false,
  supportsPlatform: false,
});
/** Optional text fields go to the API only when filled in. */
const optional = (value: string) => value.trim() || undefined;

const status = computed(() => session.me?.member?.status ?? null);
const canApply = computed(() => mayApply(status.value));
const lastDecision = computed(() => applications.value.find((a) => a.status !== 'pending') ?? null);
const stateOptions = STATES.map((s) => ({ label: `${s.name} (${s.code})`, value: s.code }));
/** The current step, or null for members, who have nothing left to do here. */
const step = computed(() => {
  if (!session.user) return 0;
  if (!session.me) return 1;
  if (status.value === 'applicant') return 2;
  return canApply.value ? 1 : null;
});

onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange));

watch(
  () => !session.user,
  async (signedOut) => {
    if (!signedOut || enabled.value) return;
    try {
      enabled.value = await api<Record<SignInProvider, boolean>>('GET', '/v1/sign-in-methods');
    } catch (e) {
      methodsError.value = `Could not load the ways to create a login: ${errorMessage(e)}`;
    }
  },
  { immediate: true },
);

watch(
  () => session.me?.account?.accountId,
  async (accountId) => {
    if (!accountId) return;
    applications.value = await api<ApplicationRecord[]>('GET', '/v1/registration/applications/me').catch(() => []);
    if (canApply.value && !bylaws.value) {
      bylaws.value = await api<BylawsRecord>('GET', '/v1/bylaws/current').catch((e) => {
        bylawsError.value = errorMessage(e);
        return null;
      });
    }
  },
  { immediate: true },
);

// Once a field was refused, its message follows what the person types.
watch(
  () => login.email,
  () => {
    const { email: _, ...rest } = loginErrors.value;
    loginErrors.value = rest;
  },
);
watch(
  () => login.password,
  (password) => {
    if (!loginErrors.value.password) return;
    const { password: _, ...rest } = loginErrors.value;
    const problem = passwordProblem(password);
    loginErrors.value = problem ? { ...rest, password: problem } : rest;
  },
);

function withProvider(p: FederatedProvider) {
  return run(() => signInWithProvider(auth, p));
}

async function createLogin() {
  const problems: FieldErrors = {};
  if (!login.email.trim()) problems.email = 'Enter your email address.';
  const problem = passwordProblem(login.password);
  if (problem) problems.password = problem;
  loginErrors.value = problems;
  if (Object.keys(problems).length) return focusFirstInvalid();
  await run(async () => {
    try {
      return await signUpWithPassword(auth, login.email.trim(), login.password);
    } catch (e) {
      if (!(e instanceof PasswordRejected)) throw e;
      loginErrors.value = { password: e.message };
    }
  });
  if (loginErrors.value.password) await focusFirstInvalid();
}

/** After signing in here the login form is gone, so start the person at the step that replaced it. */
async function toNextStep() {
  await nextTick();
  focusElement(document.querySelector('#apply-heading, #application-status') ?? document.querySelector('main h1'));
}

/**
 * People who sign up with a password verify their address while they fill in the form. The session's copy of the
 * sign-in still says unverified until it is reloaded, so reload it when they come back to this tab from their email.
 * Firebase may already have the news from another tab (the one the link opened), so ask the session, not Firebase.
 */
function onVisibilityChange() {
  const user = auth.currentUser;
  if (document.visibilityState !== 'visible' || !user || session.user?.emailVerified) return;
  void user
    .reload()
    .then(() => (user.emailVerified ? refreshUser() : undefined))
    .catch(() => undefined);
}

/** Whether the ID token the API checks says the address is verified, reloading the sign-in once if it does not. */
async function verifiedForApi(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  if ((await user.getIdTokenResult()).claims.email_verified === true) return true;
  await refreshUser();
  return (await auth.currentUser?.getIdTokenResult())?.claims.email_verified === true;
}

async function resendVerification() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await sendEmailVerification(user, { url: `${location.origin}/register` });
    $q.notify({ message: `Verification email sent to ${user.email}` });
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

async function submit() {
  if (!bylaws.value) return;
  if (!agreed.value) {
    errors.value = { _: 'You must agree to the bylaws to apply.' };
    return;
  }
  const checked = validate(createApplicationSchema, {
    bylawsVersion: bylaws.value.version,
    bylawsHash: bylaws.value.contentHash,
    legalName: form.legalName,
    preferredName: optional(form.preferredName),
    dateOfBirth: form.dateOfBirth,
    attestsAge: form.attestsAge,
    supportsPlatform: form.supportsPlatform,
    state: form.state ?? '',
    city: form.city,
    postalCode: form.postalCode,
    phone: optional(form.phone),
    statement: optional(form.statement),
    interests: optional(form.interests),
    skills: optional(form.skills),
    volunteer: form.volunteer,
    runForOffice: form.runForOffice,
    referral: optional(form.referral),
    newsletter: form.newsletter,
    announcements: form.announcements,
  });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  busy.value = true;
  errors.value = {};
  try {
    if (!(await verifiedForApi())) {
      errors.value = {
        _: `Your email address isn't verified yet. Open the link we sent to ${session.user?.email}, then choose Submit application again. Your answers stay here.`,
      };
      return;
    }
    await api('POST', '/v1/registration/applications', checked.data);
    await refreshMe();
    applications.value = await api<ApplicationRecord[]>('GET', '/v1/registration/applications/me');
    $q.notify({ type: 'positive', message: 'Application submitted' });
    await focusSoon('#application-status');
  } catch (e) {
    errors.value = { _: errorMessage(e), ...apiFieldErrors(e) };
    await focusFirstInvalid();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <q-page padding>
    <div class="ustp-content">
      <h1 class="text-h5">Register as a member</h1>
      <ol v-if="session.ready && step !== null" class="register-steps" aria-label="Steps to register">
        <li
          v-for="(label, i) in STEPS"
          :key="label"
          :aria-current="i === step ? 'step' : undefined"
          :class="{ 'register-steps__current text-primary': i === step }"
        >
          <span class="register-steps__marker" :class="i === step ? 'bg-primary text-white' : ''" aria-hidden="true">
            <q-icon v-if="i < step" name="check" size="16px" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span v-if="i < step" class="sr-only">Done:&nbsp;</span>{{ label }}
        </li>
      </ol>

      <div v-if="!session.ready" class="text-grey-7">Loading…</div>

      <template v-else-if="!session.user">
        <q-banner v-if="methodsError" class="bg-negative text-white" rounded>{{ methodsError }}</q-banner>
        <q-banner v-if="signInError" class="bg-negative text-white" rounded>{{ signInError }}</q-banner>

        <TwoStepCodeCard
          v-if="challenge"
          v-model:code="code"
          class="ustp-narrow"
          :busy="signingIn"
          @submit="submitCode"
          @cancel="challenge = null"
        />

        <q-card v-else flat bordered class="ustp-narrow">
          <q-card-section>
            <h2 class="text-subtitle1">Create your login</h2>
            <div class="text-caption text-grey-7">You will use it to apply, to vote and to manage your membership.</div>
          </q-card-section>

          <q-card-section v-if="federated.length" class="ustp-stack">
            <q-btn
              v-for="p in federated"
              :key="p"
              outline
              color="primary"
              no-caps
              class="full-width"
              :disable="signingIn"
              :label="`Continue with ${PROVIDER_LABELS[p]}`"
              @click="withProvider(p)"
            />
          </q-card-section>

          <template v-if="enabled?.password">
            <q-separator v-if="federated.length" />
            <q-form class="ustp-form q-pa-md" @submit.prevent="createLogin">
              <h3 v-if="federated.length" class="text-body1">Or use your email address</h3>
              <q-input
                v-model="login.email"
                type="email"
                label="Email"
                outlined
                dense
                autocomplete="email"
                hide-bottom-space
                :error="!!loginErrors.email"
                :error-message="loginErrors.email"
              />
              <q-input
                v-model="login.password"
                type="password"
                label="Password"
                outlined
                dense
                autocomplete="new-password"
                hide-bottom-space
                :hint="`At least ${MIN_PASSWORD_LENGTH} characters. No other rules.`"
                :error="!!loginErrors.password"
                :error-message="loginErrors.password"
              />
              <div class="text-caption text-grey-7">We will email you a link to confirm the address.</div>
              <div class="ustp-actions">
                <q-btn type="submit" color="primary" label="Create login and continue" :loading="signingIn" />
              </div>
            </q-form>
          </template>

          <q-separator />
          <q-card-section>
            Already have a login?
            <router-link :to="{ path: '/signin', query: { redirect: '/register' } }">Sign in</router-link>, and you
            will come back here.
          </q-card-section>
        </q-card>
      </template>

      <template v-else-if="!session.me">
        <q-banner v-if="session.error" class="bg-negative text-white" rounded>{{ session.error }}</q-banner>
        <div v-else class="text-grey-7">Loading your account…</div>
      </template>

      <q-card v-else-if="status === 'applicant'" flat bordered>
        <q-card-section>
          <h2 id="application-status" class="text-subtitle1">Your application is being reviewed</h2>
          <div class="text-caption text-grey-7">
            Submitted {{ applications[0] ? new Date(applications[0].submittedAt).toLocaleString() : '' }}. A Membership
            Admin will decide it; you will see the outcome here.
          </div>
        </q-card-section>
      </q-card>

      <q-card v-else-if="!canApply" flat bordered>
        <q-card-section>
          You are a member (status <q-badge :label="status ?? ''" color="primary" />).
          <router-link to="/account">Manage your account</router-link>.
        </q-card-section>
      </q-card>

      <template v-else>
        <h2 id="apply-heading" class="text-subtitle1">Apply for membership</h2>
        <q-banner v-if="!session.user.emailVerified" class="bg-orange-1 text-black" rounded>
          We sent a link to {{ session.user.email }} to confirm the address. Open it before you submit; you can fill
          in the form first, and your answers stay here.
          <template #action>
            <q-btn flat no-caps label="Send the link again" @click="resendVerification" />
          </template>
        </q-banner>
        <q-banner v-if="lastDecision?.status === 'rejected'" class="bg-orange-1 text-black" rounded>
          Your previous application was not approved: {{ lastDecision.decisionReason }}
        </q-banner>
        <q-banner v-if="bylawsError" class="bg-negative text-white" rounded>{{ bylawsError }}</q-banner>
        <div v-else-if="!bylaws" class="text-grey-7">Loading the bylaws…</div>

        <q-card v-if="bylaws" flat bordered>
          <q-card-section>
            <h3 id="bylaws-title" class="text-subtitle1">{{ bylaws.title }}</h3>
            <div class="text-caption text-grey-7">
              Version {{ bylaws.version }} · SHA-256 <code>{{ bylaws.contentHash.slice(0, 16) }}…</code>
            </div>
          </q-card-section>
          <q-separator />
          <!-- A focusable region, so the text can be scrolled with the keyboard too (WCAG 2.1.1). -->
          <div
            class="q-pa-md"
            style="height: 260px; overflow-y: auto; white-space: pre-wrap"
            tabindex="0"
            role="region"
            aria-labelledby="bylaws-title"
          >{{ bylaws.text }}</div>
          <q-separator />
          <q-card-section>
            <q-checkbox v-model="agreed" label="I have read these bylaws and agree to abide by them." />
          </q-card-section>
        </q-card>

        <!-- Each section of the form is a card, its legend the card's heading. -->
        <q-form v-if="bylaws" class="ustp-stack" @submit.prevent="submit">
          <q-card flat bordered>
            <q-card-section>
              <fieldset class="ustp-fieldset">
                <legend class="text-subtitle1">About you</legend>
                <div class="ustp-form">
                  <q-input
                    v-model="form.legalName"
                    outlined
                    dense
                    hide-bottom-space
                    label="Legal name"
                    autocomplete="name"
                    :error="!!errors.legalName"
                    :error-message="errors.legalName"
                  />
                  <q-input v-model="form.preferredName" outlined dense label="Preferred name (optional)" autocomplete="nickname" />
                  <q-input
                    v-model="form.dateOfBirth"
                    outlined
                    dense
                    hide-bottom-space
                    stack-label
                    type="date"
                    label="Date of birth"
                    autocomplete="bday"
                    :hint="`Members must be at least ${MINIMUM_MEMBER_AGE}. Kept with your application only, for the membership review.`"
                    :error="!!errors.dateOfBirth"
                    :error-message="errors.dateOfBirth"
                  />
                </div>
              </fieldset>
            </q-card-section>
          </q-card>

          <q-card flat bordered>
            <q-card-section>
              <fieldset class="ustp-fieldset">
                <legend class="text-subtitle1">Where you live and how to reach you</legend>
                <div class="text-caption text-grey-7">We never ask for your street address.</div>
                <div class="ustp-form">
                  <q-select
                    v-model="form.state"
                    outlined
                    dense
                    hide-bottom-space
                    emit-value
                    map-options
                    :options="stateOptions"
                    label="State or territory"
                    :error="!!errors.state"
                    :error-message="errors.state"
                  />
                  <div class="ustp-row">
                    <q-input
                      v-model="form.city"
                      class="ustp-row__wide"
                      outlined
                      dense
                      hide-bottom-space
                      label="City"
                      autocomplete="address-level2"
                      :error="!!errors.city"
                      :error-message="errors.city"
                    />
                    <q-input
                      v-model="form.postalCode"
                      outlined
                      dense
                      hide-bottom-space
                      label="ZIP code"
                      inputmode="numeric"
                      autocomplete="postal-code"
                      :error="!!errors.postalCode"
                      :error-message="errors.postalCode"
                    />
                  </div>
                  <q-input
                    v-model="form.phone"
                    outlined
                    dense
                    hide-bottom-space
                    type="tel"
                    label="Phone (optional)"
                    autocomplete="tel"
                    :error="!!errors.phone"
                    :error-message="errors.phone"
                  />
                </div>
              </fieldset>
            </q-card-section>
          </q-card>

          <q-card flat bordered>
            <q-card-section>
              <fieldset class="ustp-fieldset">
                <legend class="text-subtitle1">Your interest in USTP</legend>
                <div class="ustp-form">
                  <q-input v-model="form.statement" outlined dense autogrow type="textarea" label="Why do you want to join? (optional)" />
                  <q-input v-model="form.interests" outlined dense autogrow type="textarea" label="Issues you care most about (optional)" />
                  <q-input
                    v-model="form.skills"
                    outlined
                    dense
                    autogrow
                    type="textarea"
                    label="Skills or experience you could contribute (optional)"
                  />
                  <q-input v-model="form.referral" outlined dense label="How did you hear about USTP? (optional)" />
                  <div class="ustp-options">
                    <q-checkbox v-model="form.volunteer" label="I'd like to volunteer." />
                    <q-checkbox v-model="form.runForOffice" label="I'm interested in running for party or public office." />
                  </div>
                </div>
              </fieldset>
            </q-card-section>
          </q-card>

          <q-card flat bordered>
            <q-card-section>
              <fieldset class="ustp-fieldset">
                <legend class="text-subtitle1">Staying in touch</legend>
                <div class="text-caption text-grey-7">Optional. You can withdraw either at any time.</div>
                <div class="ustp-form">
                  <div class="ustp-options">
                    <q-checkbox v-model="form.newsletter" label="Send me the USTP newsletter." />
                    <q-checkbox v-model="form.announcements" label="Email me party announcements and calls to vote." />
                  </div>
                </div>
              </fieldset>
            </q-card-section>
          </q-card>

          <q-card flat bordered>
            <q-card-section>
              <fieldset class="ustp-fieldset">
                <legend class="text-subtitle1">Confirmations</legend>
                <div class="ustp-form">
                  <div class="ustp-options">
                    <q-checkbox v-model="form.attestsAge" :label="`I am at least ${MINIMUM_MEMBER_AGE} years old.`" />
                    <div v-if="errors.attestsAge" class="ustp-message text-negative">{{ errors.attestsAge }}</div>
                    <q-checkbox v-model="form.supportsPlatform" label="I support the platform and goals of the US Transhumanist Party." />
                    <div v-if="errors.supportsPlatform" class="ustp-message text-negative">{{ errors.supportsPlatform }}</div>
                  </div>
                </div>
              </fieldset>
            </q-card-section>
          </q-card>

          <q-banner v-if="errors._" class="bg-negative text-white" rounded>{{ errors._ }}</q-banner>
          <div class="ustp-actions">
            <q-btn type="submit" color="primary" label="Submit application" :loading="busy" />
          </div>
        </q-form>
      </template>
    </div>
  </q-page>
</template>

<style scoped>
.register-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}
.register-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.register-steps__current {
  font-weight: 600;
}
.register-steps__marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid currentColor;
  border-radius: 50%;
  font-size: 13px;
  line-height: 1;
}
.register-steps__marker.bg-primary {
  border-color: var(--q-primary);
}
</style>
