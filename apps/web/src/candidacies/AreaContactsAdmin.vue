<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  areaContactInputSchema,
  CONTACT_LIMITS,
  DEFAULT_OFFICE_TITLES,
  OFFICE_DISTRICTS,
  PUBLIC_OFFICES,
  type AreaContactRecord,
  type ContactRole,
  type DistrictOption,
  type PublicOffice,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { errorMessage } from '../api.js';
import { confirmAction } from '../communications/admin-forms.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, STATES, validate, type FieldErrors } from '../forms.js';
import { addAreaContact, adminAreaContacts, changeAreaContact, districts, removeAreaContact } from './api.js';
import { DISTRICT_LABELS, districtText, electionDay, OFFICE_CHOICES } from './candidacy-text.js';

/**
 * The office holders and candidates the Your area page lists besides public records (design §5.12), for
 * Communications Admins: state and local offices no free record covers, and anyone a record lists without an email
 * address (an entry with the same name, office and district takes the record's place). Every change is ledgered.
 */
const entries = ref<AreaContactRecord[] | null>(null);
const editing = ref(false);
const current = ref<AreaContactRecord | null>(null);
const errors = ref<FieldErrors>({});
const filterState = ref<string | null>(null);

const blank = () => ({
  role: 'holder' as ContactRole,
  office: 'county' as PublicOffice,
  officeTitle: DEFAULT_OFFICE_TITLES.county,
  state: null as string | null,
  districtId: null as string | null,
  name: '',
  party: '',
  email: '',
  contactUrl: '',
  website: '',
  electionDate: '',
});
const form = reactive(blank());

const kind = computed(() => OFFICE_DISTRICTS[form.office]);
const listed = computed(() => kind.value !== 'nation' && kind.value !== 'state');
const roleOptions = [
  { value: 'holder', label: 'In office' },
  { value: 'candidate', label: 'Running' },
];
const officeOptions = PUBLIC_OFFICES.map((value) => ({ value, label: OFFICE_CHOICES[value].label }));
const stateOptions = STATES.map((s) => ({ value: s.code, label: s.name }));
const filterOptions = computed(() => [
  { value: null, label: 'All states' },
  ...[...new Set((entries.value ?? []).map((e) => e.district.state).filter((s): s is string => s !== null))]
    .sort()
    .map((code) => ({ value: code, label: STATES.find((s) => s.code === code)?.name ?? code })),
]);
const shown = computed(() => (entries.value ?? []).filter((e) => filterState.value === null || e.district.state === filterState.value));

// The district list for the office's kind and the state, from the Census, as on the declaration form.
const options = ref<DistrictOption[]>([]);
const optionsError = ref<string | null>(null);
const districtFilter = ref('');
const districtOptions = computed(() => {
  const needle = districtFilter.value.trim().toLowerCase();
  return options.value.filter((d) => !needle || d.name.toLowerCase().includes(needle)).map((d) => ({ value: d.geoid, label: d.name }));
});
let loads = 0;
async function loadOptions() {
  const run = ++loads;
  optionsError.value = null;
  options.value = [];
  if (!listed.value || !form.state) return;
  try {
    const list = await districts(kind.value, form.state);
    if (run === loads) options.value = list;
  } catch (e) {
    if (run === loads) optionsError.value = errorMessage(e);
  }
}
watch([kind, () => form.state], async () => {
  await loadOptions();
  if (form.districtId && !options.value.some((d) => d.geoid === form.districtId)) form.districtId = null;
});
watch(
  () => form.office,
  (office, previous) => {
    if (!form.officeTitle.trim() || form.officeTitle === DEFAULT_OFFICE_TITLES[previous]) form.officeTitle = DEFAULT_OFFICE_TITLES[office];
    if (OFFICE_DISTRICTS[office] === 'nation') form.state = null;
  },
);

async function load() {
  await attempt(async () => {
    entries.value = await adminAreaContacts();
  });
}

function startNew() {
  current.value = null;
  Object.assign(form, blank(), { state: filterState.value });
  errors.value = {};
  editing.value = true;
}

function open(e: AreaContactRecord) {
  current.value = e;
  Object.assign(form, {
    role: e.role,
    office: e.office,
    officeTitle: e.officeTitle,
    state: e.district.state,
    districtId: e.district.kind === 'nation' || e.district.kind === 'state' ? null : e.district.geoid,
    name: e.name,
    party: e.party ?? '',
    email: e.email ?? '',
    contactUrl: e.contactUrl ?? '',
    website: e.website ?? '',
    electionDate: e.electionDate ?? '',
  });
  errors.value = {};
  editing.value = true;
}

async function save() {
  const body = { ...form, districtId: listed.value ? form.districtId : null, electionDate: form.role === 'candidate' ? form.electionDate : null };
  const checked = validate(areaContactInputSchema, body);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  const entry = current.value;
  const ok = await attempt(async () => {
    try {
      if (entry) await changeAreaContact(entry.contactId, checked.data, entry.version);
      else await addAreaContact(checked.data);
    } catch (err) {
      errors.value = apiFieldErrors(err);
      throw err;
    }
  }, 'Saved');
  if (ok) {
    editing.value = false;
    await load();
  }
}

async function remove(e: AreaContactRecord) {
  if (!(await confirmAction(`Remove ${e.name}?`, 'They leave the Your area page at once.', 'Remove'))) return;
  if (await attempt(() => removeAreaContact(e.contactId), 'Removed')) {
    editing.value = false;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      The Your area page lists, for each member, who holds each office where they live and who is running for it.
      Congress, the FEC’s federal candidates and (with a key) state legislators come from public records; add everyone
      else here: statewide, county and city offices, and state and local candidates. To give someone from a public record
      an email address, add them with the same name, office and district.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!editing" unelevated no-caps color="primary" icon="person_add" label="Add someone" @click="startNew" />
      <q-select v-model="filterState" outlined dense emit-value map-options :options="filterOptions" label="State" class="area-admin-filter" />
    </div>

    <q-card v-if="editing" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1 q-my-none">{{ current ? current.name : 'Add someone' }}</h2>
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <div class="ustp-row">
            <q-select v-model="form.role" outlined dense emit-value map-options :options="roleOptions" label="In office or running" />
            <q-select v-model="form.office" outlined dense emit-value map-options :options="officeOptions" label="Office" />
          </div>
          <q-input
            v-model="form.officeTitle"
            outlined
            dense
            label="Office as people know it"
            :maxlength="CONTACT_LIMITS.officeTitle"
            :error="!!errors.officeTitle"
            :error-message="errors.officeTitle"
          />
          <div class="ustp-row">
            <q-select
              v-if="kind !== 'nation'"
              v-model="form.state"
              outlined
              dense
              emit-value
              map-options
              :options="stateOptions"
              label="State or territory"
              :error="!!errors.state"
              :error-message="errors.state"
            />
            <q-select
              v-if="listed"
              v-model="form.districtId"
              outlined
              dense
              emit-value
              map-options
              use-input
              input-debounce="0"
              :options="districtOptions"
              :label="DISTRICT_LABELS[kind]"
              :disable="!form.state"
              :error="!!errors.districtId || !!optionsError"
              :error-message="errors.districtId || optionsError || undefined"
              @filter="(value: string, update: (fn: () => void) => void) => update(() => (districtFilter = value))"
            />
          </div>
          <q-input v-model="form.name" outlined dense label="Name" :maxlength="CONTACT_LIMITS.name" :error="!!errors.name" :error-message="errors.name" />
          <q-input v-model="form.party" outlined dense label="Party (optional)" :maxlength="CONTACT_LIMITS.party" />
          <q-input
            v-model="form.email"
            outlined
            dense
            type="email"
            label="Email address (optional)"
            :maxlength="CONTACT_LIMITS.email"
            :error="!!errors.email"
            :error-message="errors.email"
          />
          <q-input
            v-model="form.contactUrl"
            outlined
            dense
            label="Contact form (optional)"
            placeholder="https://…"
            :error="!!errors.contactUrl"
            :error-message="errors.contactUrl"
          />
          <q-input v-model="form.website" outlined dense label="Website (optional)" placeholder="https://…" :error="!!errors.website" :error-message="errors.website" />
          <q-input
            v-if="form.role === 'candidate'"
            v-model="form.electionDate"
            outlined
            dense
            type="date"
            stack-label
            label="Election day"
            hint="They are shown until the day after it."
            :error="!!errors.electionDate"
            :error-message="errors.electionDate"
          />
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" label="Save" />
            <q-btn v-if="current" flat no-caps color="negative" label="Remove" @click="remove(current)" />
            <q-btn flat no-caps label="Close" @click="editing = false" />
          </div>
        </q-form>
      </q-card-section>
    </q-card>

    <div v-if="entries && !shown.length && !editing" class="text-grey-7">Nobody added yet.</div>
    <q-list v-if="shown.length" bordered separator class="rounded-borders">
      <q-item v-for="e in shown" :key="e.contactId" clickable @click="open(e)">
        <q-item-section>
          <q-item-label>{{ e.name }}<template v-if="e.party"> · {{ e.party }}</template></q-item-label>
          <q-item-label caption>
            {{ e.role === 'holder' ? 'In office' : `Running · ${e.electionDate ? electionDay(e.electionDate) : ''}` }} · {{ e.officeTitle }} ·
            {{ districtText(e) }}
          </q-item-label>
          <q-item-label caption>{{ e.email ?? (e.contactUrl ? 'Contact form only' : 'No email address') }}</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="edit" :aria-label="`Edit ${e.name}`" /></q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<style scoped>
.area-admin-filter {
  min-width: 200px;
}
</style>
