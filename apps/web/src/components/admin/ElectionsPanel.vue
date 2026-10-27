<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createElectionSchema, type ElectionDetail, type ElectionRecord } from 'ustp-domain';
import { api, ApiError } from '../../api.js';
import { focusFirstInvalid } from '../../a11y.js';
import { attempt } from '../../dialogs.js';
import { packageProblem, readElectionPackage } from '../../election-files.js';
import { fromLocalInput, toLocalInput } from '../../election-text.js';
import { apiFieldErrors, validate, type FieldErrors } from '../../forms.js';
import { hasRole } from '../../session.js';

const router = useRouter();
const rows = ref<ElectionRecord[]>([]);
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const creating = ref(false);
const errors = ref<FieldErrors>({});
const inWeeks = (w: number) => toLocalInput(new Date(Date.now() + w * 7 * 86_400_000).toISOString());
const form = reactive({ title: '', secrecy: 'secret' as 'secret' | 'open', opensAt: inWeeks(2), closesAt: inWeeks(3) });

async function load() {
  const ok = await attempt(async () => {
    rows.value = await api<ElectionRecord[]>('GET', '/v1/admin/elections');
  });
  listState.value = ok ? 'ready' : 'failed';
}

async function create() {
  const checked = validate(createElectionSchema, {
    title: form.title,
    secrecy: form.secrecy,
    opensAt: fromLocalInput(form.opensAt),
    closesAt: fromLocalInput(form.closesAt),
  });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  let created: ElectionRecord | null = null;
  const ok = await attempt(async () => {
    try {
      created = await api<ElectionRecord>('POST', '/v1/admin/elections', checked.data);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, 'Draft election created');
  if (ok && created) {
    creating.value = false;
    await router.push(`/admin/elections/${(created as ElectionRecord).electionId}`);
  }
}

/**
 * Imports a `ustp.election` file as a new draft (design §6.7). The browser checks it first with the api's schema; what
 * is wrong is listed by path, from the browser or from the api, until the next import.
 */
const packageInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importProblems = ref<{ readonly file: string; readonly problems: readonly string[] } | null>(null);

async function importPackage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importing.value = true;
  importProblems.value = null;
  try {
    const read = await readElectionPackage(file);
    if (!read.ok) {
      importProblems.value = { file: file.name, problems: read.problems };
      return;
    }
    let imported: ElectionDetail | null = null;
    const ok = await attempt(async () => {
      try {
        imported = await api<ElectionDetail>('POST', '/v1/admin/elections/import', read.pkg);
      } catch (e) {
        const errors = e instanceof ApiError ? (e.problem.errors ?? []) : [];
        if (errors.length) importProblems.value = { file: file.name, problems: errors.map((i) => packageProblem(i.path, i.message)) };
        throw e;
      }
    }, 'Draft imported');
    if (ok && imported) await router.push(`/admin/elections/${(imported as ElectionDetail).election.electionId}`);
  } finally {
    importing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <div class="ustp-toolbar">
      <q-btn v-if="hasRole('election_admin')" color="primary" no-caps label="New election" @click="creating = true" />
      <q-btn
        v-if="hasRole('election_admin')"
        outline
        no-caps
        color="primary"
        icon="upload_file"
        label="Import JSON"
        :loading="importing"
        @click="packageInput?.click()"
      />
      <input ref="packageInput" type="file" accept=".json,application/json" hidden @change="importPackage" />
      <q-btn flat dense icon="refresh" aria-label="Refresh elections" @click="load" />
    </div>
    <q-banner v-if="importProblems" class="bg-negative text-white" rounded role="alert">
      <p class="q-mb-xs">{{ importProblems.file }} was not imported:</p>
      <ul class="q-my-none">
        <li v-for="p in importProblems.problems" :key="p">{{ p }}</li>
      </ul>
      <template #action>
        <q-btn flat no-caps color="white" label="Dismiss" @click="importProblems = null" />
      </template>
    </q-banner>
    <div v-if="listState === 'failed'" class="text-grey-7">Could not load elections.</div>
    <div v-else-if="listState === 'ready' && !rows.length" class="text-grey-7">No elections yet.</div>
    <q-list v-else-if="rows.length" bordered separator>
      <q-item v-for="e in rows" :key="e.electionId" clickable :to="`/admin/elections/${e.electionId}`">
        <q-item-section>
          <q-item-label>{{ e.title }}</q-item-label>
          <q-item-label caption>
            {{ e.secrecy === 'secret' ? 'Secret ballot' : 'Open roll-call' }} · voting
            {{ new Date(e.opensAt).toLocaleString() }} – {{ new Date(e.closesAt).toLocaleString() }}
          </q-item-label>
        </q-item-section>
        <q-item-section side><q-badge :label="e.state" /></q-item-section>
      </q-item>
    </q-list>

    <q-dialog v-model="creating" aria-labelledby="new-election-title">
      <q-card class="ustp-dialog">
        <q-card-section><h2 id="new-election-title" class="text-h6">New election</h2></q-card-section>
        <q-card-section>
          <q-form class="ustp-form" @submit.prevent="create">
            <q-input
              v-model="form.title"
              outlined
              dense
              hide-bottom-space
              label="Title"
              :error="!!errors.title"
              :error-message="errors.title"
            />
            <q-btn-toggle
              v-model="form.secrecy"
              no-caps
              toggle-color="primary"
              role="group"
              aria-label="Ballot secrecy"
              :options="[
                { label: 'Secret ballot', value: 'secret' },
                { label: 'Open roll-call', value: 'open' },
              ]"
            />
            <div class="ustp-row">
              <q-input v-model="form.opensAt" outlined dense type="datetime-local" label="Voting opens" />
              <q-input
                v-model="form.closesAt"
                outlined
                dense
                hide-bottom-space
                type="datetime-local"
                label="Voting closes"
                :error="!!errors.closesAt || !!errors._"
                :error-message="errors.closesAt ?? errors._"
              />
            </div>
          </q-form>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" />
          <q-btn color="primary" label="Create draft" @click="create" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>
