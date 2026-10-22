<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { SIGN_IN_PROVIDERS, type SignInProvider } from 'ustp-domain';
import { api } from '../../api.js';
import { attempt } from '../../dialogs.js';
import { auth } from '../../firebase.js';
import { PROVIDER_LABELS } from '../../sign-in.js';

type Switches = Record<SignInProvider, boolean>;

const saved = ref<Switches | null>(null);
const draft = ref<Switches | null>(null);
const myProvider = ref<string | null>(null);
const changes = computed(() =>
  saved.value && draft.value
    ? Object.fromEntries(SIGN_IN_PROVIDERS.filter((p) => draft.value![p] !== saved.value![p]).map((p) => [p, draft.value![p]]))
    : {},
);

async function load() {
  await attempt(async () => {
    saved.value = await api<Switches>('GET', '/v1/admin/sign-in-methods');
    draft.value = { ...saved.value };
    myProvider.value = (await auth.currentUser?.getIdTokenResult())?.signInProvider ?? null;
  });
}

async function save() {
  const ok = await attempt(async () => {
    saved.value = await api<Switches>('PUT', '/v1/admin/sign-in-methods', changes.value);
    draft.value = { ...saved.value };
  }, 'Sign-in methods updated (other servers pick this up within a minute)');
  if (!ok) await load();
}

onMounted(load);
</script>

<template>
  <q-card v-if="draft" flat bordered style="max-width: 520px">
    <q-card-section>
      <h2 class="text-subtitle1">Sign-in methods</h2>
      <div class="text-caption text-grey-7">
        Turning a method off blocks every sign-in that uses it. "Email" covers both password and email-link sign-in.
      </div>
    </q-card-section>
    <q-list>
      <q-item v-for="p in SIGN_IN_PROVIDERS" :key="p" tag="label">
        <q-item-section>
          <q-item-label>{{ PROVIDER_LABELS[p] }}</q-item-label>
          <q-item-label v-if="p === myProvider" caption>You are signed in with this method.</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-toggle v-model="draft[p]" :aria-label="PROVIDER_LABELS[p]" :disable="p === myProvider && draft[p]" />
        </q-item-section>
      </q-item>
    </q-list>
    <q-card-actions align="right">
      <q-btn color="primary" label="Save" :disable="!Object.keys(changes).length" @click="save" />
    </q-card-actions>
  </q-card>
</template>
