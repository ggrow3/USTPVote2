<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createElectionSchema, type ElectionRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { attempt } from '../../dialogs.js';
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

onMounted(load);
</script>

<template>
  <div>
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn v-if="hasRole('election_admin')" color="primary" no-caps label="New election" @click="creating = true" />
      <q-btn flat dense icon="refresh" aria-label="Refresh" @click="load" />
    </div>
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

    <q-dialog v-model="creating">
      <q-card style="width: 480px; max-width: 95vw">
        <q-card-section class="text-h6">New election</q-card-section>
        <q-form class="q-px-md q-gutter-md" @submit.prevent="create">
          <q-input v-model="form.title" outlined dense label="Title" :error="!!errors.title" :error-message="errors.title" />
          <q-btn-toggle
            v-model="form.secrecy"
            no-caps
            toggle-color="primary"
            :options="[
              { label: 'Secret ballot', value: 'secret' },
              { label: 'Open roll-call', value: 'open' },
            ]"
          />
          <q-input v-model="form.opensAt" outlined dense type="datetime-local" label="Voting opens" />
          <q-input
            v-model="form.closesAt"
            outlined
            dense
            type="datetime-local"
            label="Voting closes"
            :error="!!errors.closesAt || !!errors._"
            :error-message="errors.closesAt ?? errors._"
          />
        </q-form>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" />
          <q-btn color="primary" label="Create draft" @click="create" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>
