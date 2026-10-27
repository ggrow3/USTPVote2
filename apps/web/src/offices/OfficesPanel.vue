<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { positionInputSchema, type ApprovalRequestRecord, type PositionRecord, type PositionsView, type PositionTermRecord } from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { askReason, attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { hasRole } from '../session.js';
import AppointDialog from './AppointDialog.vue';
import { defineOffice, offices, pendingOfficeRequests, requestEndTerm } from './api.js';
import { day, officeShape, pendingLine, requestOffice, seatsLine, termBasis, termDates, termSource } from './office-text.js';

/**
 * Offices and terms (design §6.4). Defining or changing an office takes effect at once; appointing a member and ending
 * a term are requests an Auditor approves (Approvals tab). Terms otherwise come only from certified results.
 */
const view = ref<PositionsView | null>(null);
const pending = ref<ApprovalRequestRecord[]>([]);
const canManage = computed(() => hasRole('membership_admin', 'election_admin'));
const form = reactive({ positionId: '', title: '', description: '', seats: 1, termMonths: 24, reason: '' });
const errors = ref<FieldErrors>({});

async function load() {
  await attempt(async () => {
    [view.value, pending.value] = await Promise.all([offices(), pendingOfficeRequests()]);
  });
}

const termsOf = (p: PositionRecord) => view.value?.terms.filter((t) => t.positionId === p.positionId) ?? [];
const activeTermsOf = (p: PositionRecord) => termsOf(p).filter((t) => t.status === 'active');
const pendingOf = (p: PositionRecord) => pending.value.filter((r) => requestOffice(r) === p.positionId);

/** Fills the form from an office, to change it. */
function edit(p: PositionRecord) {
  Object.assign(form, { positionId: p.positionId, title: p.title, description: p.description, seats: p.seats, termMonths: p.termMonths, reason: '' });
  errors.value = {};
}

async function save() {
  const checked = validate(positionInputSchema, { ...form, seats: Number(form.seats), termMonths: Number(form.termMonths) });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  const ok = await attempt(async () => {
    try {
      await defineOffice(checked.data);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, 'Office saved');
  if (ok) {
    Object.assign(form, { positionId: '', title: '', description: '', seats: 1, termMonths: 24, reason: '' });
    await load();
  }
}

async function endTerm(t: PositionTermRecord) {
  const reason = await askReason(`End ${t.holderName}'s term`, 'An Auditor must approve. Say why (resignation, removal under the bylaws).');
  if (reason === null) return;
  if (await attempt(() => requestEndTerm(t.positionId, t.termId, reason), 'Requested; waiting for an Auditor')) await load();
}

const appointing = ref(false);
const appointTo = ref<string | undefined>();
function appoint(p: PositionRecord) {
  appointTo.value = p.positionId;
  appointing.value = true;
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">Who holds each office now is public, on the <router-link to="/offices">Offices page</router-link>.</p>
    <div v-if="view && view.positions.length === 0" class="text-grey-7">No offices defined yet.</div>
    <q-card v-for="p in view?.positions ?? []" :key="p.positionId" flat bordered>
      <q-card-section class="ustp-header">
        <div>
          <h2 class="text-subtitle1">{{ p.title }}</h2>
          <div class="text-caption text-grey-7">
            <code>{{ p.positionId }}</code> · {{ officeShape(p) }} · {{ seatsLine(p, activeTermsOf(p)) }}<template v-if="p.description">
              · {{ p.description }}</template
            >
          </div>
        </div>
        <div v-if="canManage" class="ustp-actions">
          <q-btn outline no-caps color="primary" label="Appoint" @click="appoint(p)">
            <span class="sr-only">&nbsp;to {{ p.title }}</span>
          </q-btn>
          <q-btn flat no-caps label="Change" @click="edit(p)">
            <span class="sr-only">&nbsp;to {{ p.title }}</span>
          </q-btn>
        </div>
      </q-card-section>
      <q-list v-if="termsOf(p).length" dense separator>
        <q-item v-for="t in termsOf(p)" :key="t.termId">
          <q-item-section>
            <q-item-label>{{ t.holderName }} <span class="text-grey-7">· {{ termBasis(t) }}</span></q-item-label>
            <q-item-label caption>{{ termDates(t) }}</q-item-label>
            <q-item-label caption class="ustp-term-source">{{ termSource(t) }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge :color="t.status === 'active' ? 'positive' : 'grey-7'" :label="t.status" />
          </q-item-section>
          <q-item-section v-if="canManage && t.status === 'active'" side>
            <q-btn flat dense no-caps color="negative" label="End term" @click="endTerm(t)">
              <span class="sr-only">&nbsp;of {{ t.holderName }}</span>
            </q-btn>
          </q-item-section>
        </q-item>
      </q-list>
      <q-card-section v-else class="text-caption text-grey-7">Nobody holds this office yet.</q-card-section>
      <q-card-section v-if="pendingOf(p).length">
        <h3 class="text-body2 text-weight-medium">Waiting for an Auditor</h3>
        <ul class="q-my-none q-pl-md">
          <li v-for="r in pendingOf(p)" :key="r.id">
            {{ pendingLine(r, termsOf(p)) }} <span class="text-grey-7">· asked {{ day(r.requestedAt) }}</span>
          </li>
        </ul>
        <div class="text-caption text-grey-7">An Auditor decides these in the Approvals tab.</div>
      </q-card-section>
    </q-card>

    <AppointDialog v-if="view" v-model="appointing" :view="view" :pending="pending" :position-id="appointTo" @requested="load" />

    <q-card v-if="canManage" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">Define or change an office</h2>
        <div class="text-caption text-grey-7">
          Takes effect at once; no approval needed. Using an existing ID changes that office; terms already running keep
          their dates.
        </div>
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" @submit.prevent="save">
          <div class="ustp-row">
            <q-input
              v-model="form.positionId"
              outlined
              dense
              hide-bottom-space
              label="ID (e.g. chair)"
              :error="!!errors.positionId"
              :error-message="errors.positionId"
            />
            <q-input
              v-model="form.title"
              class="ustp-row__wide"
              outlined
              dense
              hide-bottom-space
              label="Title"
              :error="!!errors.title"
              :error-message="errors.title"
            />
          </div>
          <q-input v-model="form.description" outlined dense autogrow label="Description (optional)" />
          <div class="ustp-row">
            <q-input
              v-model.number="form.seats"
              outlined
              dense
              hide-bottom-space
              type="number"
              min="1"
              label="Seats"
              :error="!!errors.seats"
              :error-message="errors.seats"
            />
            <q-input
              v-model.number="form.termMonths"
              outlined
              dense
              hide-bottom-space
              type="number"
              min="1"
              label="Term (months)"
              :error="!!errors.termMonths"
              :error-message="errors.termMonths"
            />
          </div>
          <q-input
            v-model="form.reason"
            outlined
            dense
            hide-bottom-space
            autogrow
            label="Reason (e.g. bylaws article)"
            :error="!!errors.reason"
            :error-message="errors.reason"
          />
          <div class="ustp-actions">
            <q-btn type="submit" color="primary" no-caps label="Save office" />
          </div>
        </q-form>
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.ustp-term-source {
  overflow-wrap: anywhere;
}
</style>
