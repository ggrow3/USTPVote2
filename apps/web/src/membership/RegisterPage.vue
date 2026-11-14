<script setup lang="ts">
import { sendEmailVerification } from 'firebase/auth';
import { useQuasar } from 'quasar';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
  applicationFieldProblems,
  applicationSchema,
  bylawsInForce,
  DEFAULT_COUNTRY,
  DEFAULT_REGISTRATION_FIELDS,
  DEFAULT_REGISTRATION_FORM,
  mayApply,
  MINIMUM_MEMBER_AGE,
  staysInTouchByDefault,
  type ApplicationRecord,
  type BylawsRecord,
  type PublicRegistrationForm,
  type RegistrationField,
  type SignInProvider,
} from 'ustp-domain';
import { focusElement, focusFirstInvalid, focusSoon, usePageTitle } from '../a11y.js';
import { api, ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import PasswordInput from '../components/PasswordInput.vue';
import TwoStepCodeCard from '../components/TwoStepCodeCard.vue';
import { auth } from '../firebase.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { refreshMe, refreshUser, secondFactorMissing, session } from '../session.js';
import {
  PASSWORD_HINT,
  PasswordRejected,
  passwordProblem,
  PROVIDER_LABELS,
  signInWithProvider,
  signUpWithPassword,
  type FederatedProvider,
} from '../sign-in.js';
import { useSignInFlow } from '../sign-in-flow.js';
import { forgetReferral, keptReferral } from '../referrals/landing.js';
import { myApplications, registrationForm, submitApplication } from './api.js';
import MembershipQuestions from './MembershipQuestions.vue';
import { placeInput } from './member-text.js';
import PlaceFields from './PlaceFields.vue';
import RegistrationIntro from './RegistrationIntro.vue';

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

/**
 * The Membership Admins' wording: the heading and intro, the two questions and the Core Ideals, and the bonus link
 * (design §5.2). The heading is the default's until the wording loads, and if it cannot.
 */
const wording = ref<PublicRegistrationForm | null>(null);
const wordingError = ref<string | null>(null);
const tips = computed(() =>
  wording.value?.tipsAddress ? { title: wording.value.tipsTitle, address: wording.value.tipsAddress } : null,
);

/** Which fields the application asks, as the Membership Admins set them: each required, optional or not shown. */
const fields = computed(() => wording.value?.fields ?? DEFAULT_REGISTRATION_FIELDS);
const shown = (...any: RegistrationField[]) => any.some((field) => fields.value[field] !== 'hidden');
const labelled = (text: string, field: RegistrationField) => (fields.value[field] === 'required' ? text : `${text} (optional)`);

// Step 2: the application.
/** The bylaws applicants agree to; null while none are in force (none published, or cleared), design §5.2. */
const bylaws = ref<BylawsRecord | null>(null);
const bylawsLoaded = ref(false);
const bylawsError = ref<string | null>(null);

/** Reads the bylaws in force: none at all (404) and a blank version both mean there is nothing to show or agree to. */
async function loadBylaws() {
  bylawsError.value = null;
  try {
    const current = bylawsInForce(await api<BylawsRecord>('GET', '/v1/bylaws/current'));
    if (current?.version !== bylaws.value?.version) agreed.value = false;
    bylaws.value = current;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) {
      bylawsError.value = errorMessage(e);
      return;
    }
    bylaws.value = null;
  }
  bylawsLoaded.value = true;
}
const applications = ref<ApplicationRecord[]>([]);
const agreed = ref(false);
const busy = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive({
  legalName: '',
  preferredName: '',
  dateOfBirth: '',
  country: DEFAULT_COUNTRY as string,
  state: null as string | null,
  region: '',
  city: '',
  postalCode: '',
  phone: '',
  statement: '',
  interests: '',
  skills: '',
  referral: '',
  volunteer: false,
  runForOffice: false,
  // One box for the newsletter and the announcements both (design §5.2).
  keepInTouch: staysInTouchByDefault(DEFAULT_COUNTRY),
  attestsAge: false,
  // Yes or No, nothing chosen until the person answers.
  usVoteEligible: null as boolean | null,
  agreesWithCoreIdeals: null as boolean | null,
});
/** Optional text fields go to the API only when filled in. */
const optional = (value: string) => value.trim() || undefined;

/**
 * The "Staying in touch" box starts ticked in the United States and unticked elsewhere (`staysInTouchByDefault`), and
 * follows the country chosen until the applicant ticks or unticks it themselves.
 */
const keepInTouchChosen = ref(false);
watch(
  () => form.country,
  (country) => {
    if (!keepInTouchChosen.value) form.keepInTouch = staysInTouchByDefault(country);
  },
);

const status = computed(() => session.me?.member?.status ?? null);
const canApply = computed(() => mayApply(status.value));
/** Members can't apply again; the page says where they stand instead (design §5.1). */
const memberTitle = computed(() => {
  if (status.value === 'lapsed') return 'Your membership has lapsed';
  if (status.value === 'suspended') return 'Your membership is suspended';
  return 'You are already a member';
});
const lastDecision = computed(() => applications.value.find((a) => a.status !== 'pending') ?? null);
/** The current step, or null for members, who have nothing left to do here. */
const step = computed(() => {
  if (!session.user) return 0;
  if (!session.me) return 1;
  if (status.value === 'applicant') return 2;
  return canApply.value ? 1 : null;
});

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
  void loadWording();
});
onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange));

async function loadWording() {
  try {
    wording.value = await registrationForm();
    wordingError.value = null;
  } catch (e) {
    wordingError.value = `Could not load the application form: ${errorMessage(e)}`;
  }
}

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
    applications.value = await myApplications().catch(() => []);
    if (canApply.value && !bylawsLoaded.value) await loadBylaws();
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
    const problem = passwordProblem(password, login.email);
    loginErrors.value = problem ? { ...rest, password: problem } : rest;
  },
);

function withProvider(p: FederatedProvider) {
  return run(() => signInWithProvider(auth, p));
}

async function createLogin() {
  const problems: FieldErrors = {};
  if (!login.email.trim()) problems.email = 'Enter your email address.';
  const problem = passwordProblem(login.password, login.email);
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
  focusElement(document.querySelector('#apply-heading, #application-status, #membership-status') ?? document.querySelector('main h1'));
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
  if (!bylawsLoaded.value || !wording.value) return;
  if (bylaws.value && !agreed.value) {
    errors.value = { _: 'You must agree to the bylaws to apply.' };
    return;
  }
  const answers = {
    bylawsVersion: bylaws.value?.version ?? null,
    bylawsHash: bylaws.value?.contentHash ?? null,
    legalName: form.legalName,
    preferredName: optional(form.preferredName),
    dateOfBirth: form.dateOfBirth,
    attestsAge: form.attestsAge,
    formVersion: wording.value.version,
    usVoteEligible: form.usVoteEligible,
    agreesWithCoreIdeals: form.agreesWithCoreIdeals,
    ...placeInput(form),
    phone: optional(form.phone),
    statement: optional(form.statement),
    interests: optional(form.interests),
    skills: optional(form.skills),
    volunteer: form.volunteer,
    runForOffice: form.runForOffice,
    referral: optional(form.referral),
    // The member's referral link they came by, if any (design §5.18).
    referralCode: keptReferral() ?? undefined,
    // No box, no consent.
    newsletter: shown('keepInTouch') && form.keepInTouch,
    announcements: shown('keepInTouch') && form.keepInTouch,
  };
  const checked = validate(applicationSchema(fields.value), answers);
  if (!checked.ok) {
    // The schema stops at an unanswered question or an unticked confirmation before it reaches the fields' settings:
    // check those as well, so every problem shows at once.
    const typed = Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
    const missing = applicationFieldProblems(typed as typeof answers, fields.value, new Date()).map((p) => [p.path, p.message]);
    errors.value = { ...Object.fromEntries(missing), ...checked.errors };
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
    await submitApplication(checked.data);
    forgetReferral();
    await refreshMe();
    applications.value = await myApplications();
    $q.notify({ type: 'positive', message: 'Application submitted' });
    await focusSoon('#application-status');
  } catch (e) {
    errors.value = { _: errorMessage(e), ...apiFieldErrors(e) };
    // A Membership Admin may have changed the questions or the bylaws meanwhile: show the new ones, keeping the answers.
    if (e instanceof ApiError && e.status === 409) await Promise.all([loadWording(), loadBylaws()]);
    await focusFirstInvalid();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <h1 class="text-h5">{{ wording?.title ?? DEFAULT_REGISTRATION_FORM.title }}</h1>
      <RegistrationIntro v-if="wording && session.ready && step !== null" :intro="wording.intro" />
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
              <PasswordInput
                v-model="login.password"
                label="Password"
                outlined
                dense
                autocomplete="new-password"
                hide-bottom-space
                :hint="PASSWORD_HINT"
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
        <p class="ustp-narrow text-grey-8">
          Not ready to join? <router-link to="/newsletter">Get the party's newsletter</router-link> instead: just your email
          address, and you can leave the list at any time.
        </p>
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
            Admin will decide it; you will see the outcome here and in your notifications.
          </div>
        </q-card-section>
        <q-card-section>
          There is nothing more to fill in. Once you are admitted you can vote in elections set up after that, on the
          <router-link to="/ballot">Ballot</router-link> page.
        </q-card-section>
        <q-card-section v-if="tips">
          Your bonus for applying: <a :href="tips.address">{{ tips.title }}</a>.
        </q-card-section>
      </q-card>

      <!-- Active, lapsed and suspended members: their status and what they can do, instead of the form. -->
      <q-card v-else-if="!canApply" flat bordered>
        <q-card-section>
          <h2 id="membership-status" class="text-subtitle1">{{ memberTitle }}</h2>
          <div v-if="session.me.member?.memberSince" class="text-caption text-grey-7">
            Member since {{ new Date(session.me.member.memberSince).toLocaleDateString() }}
          </div>
        </q-card-section>
        <q-card-section v-if="status === 'active'">
          There is nothing to register. Vote on the <router-link to="/ballot">Ballot</router-link> page, and manage
          your membership on your <router-link to="/account">Account page</router-link>.
          <template v-if="tips"><br />Your bonus for joining: <a :href="tips.address">{{ tips.title }}</a>.</template>
        </q-card-section>
        <q-card-section v-else>
          <template v-if="status === 'lapsed'">
            You don't need to apply again: a Membership Admin can renew your membership.
          </template>
          <template v-else>A Membership Admin can reinstate it; you can't apply again while it is suspended.</template>
          Voter rolls are taken from Active members, so until then you won't be on the roll of new elections. Your
          <router-link to="/account">Account page</router-link> shows your membership, and you can resign there.
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
        <!-- Applying is refused without the second factor the site requires (design §4), so say so before the form. -->
        <q-banner v-if="secondFactorMissing()" class="bg-orange-2 text-black" rounded>
          This site requires two-step verification. Before you apply,
          {{ session.user.emailVerified ? '' : 'confirm your email address, then' }} set up an authenticator app on your
          <router-link to="/account" class="text-black">Account page</router-link> and come back here.
        </q-banner>
        <q-banner v-if="lastDecision?.status === 'rejected'" class="bg-orange-1 text-black" rounded>
          Your previous application was not approved: {{ lastDecision.decisionReason }}
        </q-banner>
        <q-banner v-if="bylawsError" class="bg-negative text-white" rounded>
          {{ bylawsError }}
          <template #action>
            <q-btn flat no-caps label="Try again" @click="loadBylaws" />
          </template>
        </q-banner>
        <div v-else-if="!bylawsLoaded" class="text-grey-7">Loading the bylaws…</div>
        <q-banner v-if="wordingError && !wording" class="bg-negative text-white" rounded>
          {{ wordingError }}
          <template #action>
            <q-btn flat no-caps label="Try again" @click="loadWording" />
          </template>
        </q-banner>

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
        <q-form v-if="bylawsLoaded && wording" class="ustp-stack" @submit.prevent="submit">
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
                  <q-input
                    v-if="shown('preferredName')"
                    v-model="form.preferredName"
                    outlined
                    dense
                    hide-bottom-space
                    :label="labelled('Preferred name', 'preferredName')"
                    autocomplete="nickname"
                    :error="!!errors.preferredName"
                    :error-message="errors.preferredName"
                  />
                  <q-input
                    v-if="shown('dateOfBirth')"
                    v-model="form.dateOfBirth"
                    outlined
                    dense
                    hide-bottom-space
                    stack-label
                    type="date"
                    :label="labelled('Date of birth', 'dateOfBirth')"
                    autocomplete="bday"
                    :hint="`Members must be at least ${MINIMUM_MEMBER_AGE}. Kept with your application only, for the membership review.`"
                    :error="!!errors.dateOfBirth"
                    :error-message="errors.dateOfBirth"
                  />
                </div>
              </fieldset>
            </q-card-section>
          </q-card>

          <q-card v-if="shown('country', 'state', 'city', 'postalCode', 'phone')" flat bordered>
            <q-card-section>
              <fieldset class="ustp-fieldset">
                <legend class="text-subtitle1">Where you live and how to reach you</legend>
                <div class="text-caption text-grey-7">We never ask for your street address.</div>
                <div class="ustp-form">
                  <PlaceFields v-model="form" :errors="errors" :rules="fields" own />
                  <q-input
                    v-if="shown('phone')"
                    v-model="form.phone"
                    outlined
                    dense
                    hide-bottom-space
                    type="tel"
                    :label="labelled('Phone', 'phone')"
                    autocomplete="tel"
                    :error="!!errors.phone"
                    :error-message="errors.phone"
                  />
                </div>
              </fieldset>
            </q-card-section>
          </q-card>

          <!-- Two Yes-or-No questions in the Membership Admins' words; neither answer is ever refused (design §5.2). -->
          <q-card flat bordered>
            <q-card-section>
              <h3 class="text-subtitle1">Membership questions</h3>
              <MembershipQuestions
                v-model:us-vote-eligible="form.usVoteEligible"
                v-model:agrees-with-core-ideals="form.agreesWithCoreIdeals"
                class="q-mt-md"
                :form="wording"
                :errors="{ usVoteEligible: errors.usVoteEligible, agreesWithCoreIdeals: errors.agreesWithCoreIdeals }"
              />
            </q-card-section>
          </q-card>

          <q-card v-if="shown('statement', 'interests', 'skills', 'referral', 'volunteer', 'runForOffice')" flat bordered>
            <q-card-section>
              <fieldset class="ustp-fieldset">
                <legend class="text-subtitle1">Your interest in USTP</legend>
                <div class="ustp-form">
                  <q-input
                    v-if="shown('statement')"
                    v-model="form.statement"
                    outlined
                    dense
                    autogrow
                    hide-bottom-space
                    type="textarea"
                    :label="labelled('Why do you want to join?', 'statement')"
                    :error="!!errors.statement"
                    :error-message="errors.statement"
                  />
                  <q-input
                    v-if="shown('interests')"
                    v-model="form.interests"
                    outlined
                    dense
                    autogrow
                    hide-bottom-space
                    type="textarea"
                    :label="labelled('Issues you care most about', 'interests')"
                    :error="!!errors.interests"
                    :error-message="errors.interests"
                  />
                  <q-input
                    v-if="shown('skills')"
                    v-model="form.skills"
                    outlined
                    dense
                    autogrow
                    hide-bottom-space
                    type="textarea"
                    :label="labelled('Skills or experience you could contribute', 'skills')"
                    :error="!!errors.skills"
                    :error-message="errors.skills"
                  />
                  <q-input
                    v-if="shown('referral')"
                    v-model="form.referral"
                    outlined
                    dense
                    hide-bottom-space
                    :label="labelled('How did you hear about USTP?', 'referral')"
                    :error="!!errors.referral"
                    :error-message="errors.referral"
                  />
                  <div v-if="shown('volunteer', 'runForOffice')" class="ustp-options">
                    <q-checkbox v-if="shown('volunteer')" v-model="form.volunteer" label="I'd like to volunteer." />
                    <q-checkbox
                      v-if="shown('runForOffice')"
                      v-model="form.runForOffice"
                      label="I'm interested in running for party or public office."
                    />
                  </div>
                </div>
              </fieldset>
            </q-card-section>
          </q-card>

          <q-card v-if="shown('keepInTouch')" flat bordered>
            <q-card-section>
              <!-- One box, ticked to start in the US only: elsewhere a box ticked in advance is no consent (design §5.2). -->
              <fieldset class="ustp-fieldset">
                <legend class="text-subtitle1">Staying in touch</legend>
                <div class="register-touch">
                  <p class="text-body2">
                    <strong>Please stay in touch.</strong> The party is only as strong as the members it can reach. The
                    newsletter and announcements keep you up to date with its work, and calls to vote bring members out
                    when every vote counts.
                  </p>
                  <q-checkbox
                    v-model="form.keepInTouch"
                    label="Email me the USTP newsletter, party announcements and calls to vote."
                    @update:model-value="keepInTouchChosen = true"
                  />
                  <div class="text-caption text-grey-7">
                    {{ staysInTouchByDefault(form.country) ? 'Ticked to start: untick it to opt out.' : 'Tick it to opt in.' }}
                    You can change this on your Account page at any time.
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
  </PageShell>
</template>

<style scoped>
/* Staying in touch matters to the party, so its box stands out from the optional questions around it. */
.register-touch {
  margin-top: 12px;
  border-left: 4px solid var(--q-primary);
  padding-left: 12px;
}
.register-touch > p {
  margin: 0 0 4px;
}
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
