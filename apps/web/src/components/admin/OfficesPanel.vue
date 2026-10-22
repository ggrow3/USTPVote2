<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { positionInputSchema, type PositionRecord, type PositionsView, type PositionTermRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { focusFirstInvalid } from '../../a11y.js';
import { askReason, attempt } from '../../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../../forms.js';
import { hasRole } from '../../session.js';

/**
 * Offices and terms (design §6.4). Every change is a request an Auditor approves (Approvals tab); terms otherwise come
 * only from certified results.
 */
const view = ref<PositionsView | null>(null);
const canRequest = computed(() => hasRole('membership_admin', 'election_admin'));
const form = reactive({ positionId: '', title: '', description: '', seats: 1, termMonths: 24, reason: '' });
const errors = ref<FieldErrors>({});

async function load() {
  await attempt(async () => {
    view.value = await api<PositionsView>('GET', '/v1/admin/positions');
  });
}

const termsOf = (p: PositionRecord) => view.value?.terms.filter((t) => t.positionId === p.positionId) ?? [];
const when = (iso: string) => new Date(iso).toLocaleDateString();

/** Fills the form from an office, to propose a change to it. */
function edit(p: PositionRecord) {
  Object.assign(form, { positionId: p.positionId, title: p.title, description: p.description, seats: p.seats, termMonths: p.termMonths, reason: '' });
  errors.value = {};
}

async function propose() {
  const checked = validate(positionInputSchema, { ...form, seats: Number(form.seats), termMonths: Number(form.termMonths) });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  const ok = await attempt(async () => {
    try {
      await api('POST', '/v1/admin/positions', checked.data);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, 'Requested; waiting for an Auditor');
  if (ok) Object.assign(form, { positionId: '', title: '', description: '', seats: 1, termMonths: 24, reason: '' });
}

async function endTerm(t: PositionTermRecord) {
  const reason = await askReason(`End ${t.holderName}'s term`, 'An Auditor must approve. Say why (resignation, removal under the bylaws).');
  if (reason === null) return;
  await attempt(() => api('POST', `/v1/admin/positions/${t.positionId}/terms/${t.termId}/end`, { reason }), 'Requested; waiting for an Auditor');
}

onMounted(load);
</script>

<template>
  <div class="column q-gutter-md" style="max-width: 860px">
    <div v-if="view && view.positions.length === 0" class="text-grey-7">No offices defined yet.</div>
    <q-card v-for="p in view?.positions ?? []" :key="p.positionId" flat bordered>
      <q-card-section class="row items-center">
        <div class="col">
          <h2 class="text-subtitle1 q-my-none">{{ p.title }}</h2>
          <div class="text-caption text-grey-7">
            <code>{{ p.positionId }}</code> · {{ p.seats }} {{ p.seats === 1 ? 'seat' : 'seats' }} · {{ p.termMonths }}-month
            terms<template v-if="p.description"> · {{ p.description }}</template>
          </div>
        </div>
        <q-btn v-if="canRequest" flat no-caps label="Propose a change" @click="edit(p)">
          <span class="sr-only">&nbsp;to {{ p.title }}</span>
        </q-btn>
      </q-card-section>
      <q-list v-if="termsOf(p).length" dense separator>
        <q-item v-for="t in termsOf(p)" :key="t.termId">
          <q-item-section>
            <q-item-label>{{ t.holderName }}</q-item-label>
            <q-item-label caption>
              {{ when(t.startsAt) }} – {{ t.status === 'ended' && t.endedAt ? `${when(t.endedAt)} (ended early: ${t.endReason})` : when(t.endsAt) }}
              · from certified results <code>{{ t.resultsHash.slice(0, 12) }}…</code>
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge :color="t.status === 'active' ? 'positive' : 'grey-7'" :label="t.status" />
          </q-item-section>
          <q-item-section v-if="canRequest && t.status === 'active'" side>
            <q-btn flat dense no-caps color="negative" label="End term" @click="endTerm(t)">
              <span class="sr-only">&nbsp;of {{ t.holderName }}</span>
            </q-btn>
          </q-item-section>
        </q-item>
      </q-list>
      <q-card-section v-else class="text-caption text-grey-7 q-pt-none">Nobody holds this office yet.</q-card-section>
    </q-card>

    <q-card v-if="canRequest" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1 q-my-none">Define or change an office</h2>
        <div class="text-caption text-grey-7">
          An Auditor must approve. Using an existing ID changes that office; terms already running keep their dates.
        </div>
      </q-card-section>
      <q-form class="q-px-md q-pb-md q-gutter-md" @submit.prevent="propose">
        <div class="row q-gutter-md">
          <q-input v-model="form.positionId" class="col" outlined dense label="ID (e.g. chair)" :error="!!errors.positionId" :error-message="errors.positionId" />
          <q-input v-model="form.title" class="col" outlined dense label="Title" :error="!!errors.title" :error-message="errors.title" />
        </div>
        <q-input v-model="form.description" outlined dense autogrow label="Description (optional)" />
        <div class="row q-gutter-md">
          <q-input v-model.number="form.seats" class="col" outlined dense type="number" min="1" label="Seats" :error="!!errors.seats" :error-message="errors.seats" />
          <q-input
            v-model.number="form.termMonths"
            class="col"
            outlined
            dense
            type="number"
            min="1"
            label="Term (months)"
            :error="!!errors.termMonths"
            :error-message="errors.termMonths"
          />
        </div>
        <q-input v-model="form.reason" outlined dense autogrow label="Reason (e.g. bylaws article)" :error="!!errors.reason" :error-message="errors.reason" />
        <q-btn type="submit" color="primary" no-caps label="Request approval" />
      </q-form>
    </q-card>
  </div>
</template>
