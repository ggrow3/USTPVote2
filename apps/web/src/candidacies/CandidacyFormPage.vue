<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  CANDIDACY_LIMITS,
  candidacyInputSchema,
  currentContent,
  ELECTION_STAGES,
  OFFICE_DISTRICTS,
  PUBLIC_OFFICES,
  type DistrictOption,
  type ElectionStage,
  type MyCandidacy,
  type PublicOffice,
} from 'ustp-domain';
import { focusFirstInvalid, usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, STATES, validate, type FieldErrors } from '../forms.js';
import { session } from '../session.js';
import { changeCandidacy, declareCandidacy, districts, myCandidacies } from './api.js';
import { DISTRICT_LABELS, OFFICE_CHOICES, STAGE_LABELS, STATUS_TEXT } from './candidacy-text.js';
import DistrictMap, { type MapMarker } from './DistrictMap.vue';

/**
 * Declaring a candidacy, or changing one (design §5.8): the office, the state and district from the Census lists, the
 * election and its date, the ballot label, the website and the platform. What is sent waits for a Membership Admin.
 */
const props = defineProps<{ candidacyId?: string }>();
const router = useRouter();
const editing = computed(() => props.candidacyId !== undefined);
usePageTitle(() => (editing.value ? 'Edit your candidacy' : 'Declare a candidacy'));

const form = reactive({
  office: 'us_house' as PublicOffice,
  officeTitle: OFFICE_CHOICES.us_house.title,
  state: null as string | null,
  districtId: null as string | null,
  electionDate: '',
  election: 'general' as ElectionStage,
  ballotLabel: '',
  platform: '',
  website: '',
});
const existing = ref<MyCandidacy | null>(null);
const loadError = ref<string | null>(null);
const errors = ref<FieldErrors>({});
const saving = ref(false);
const active = computed(() => session.me?.member?.status === 'active');

const kind = computed(() => OFFICE_DISTRICTS[form.office]);
const listed = computed(() => kind.value !== 'nation' && kind.value !== 'state');
const officeOptions = PUBLIC_OFFICES.map((value) => ({ value, label: OFFICE_CHOICES[value].label }));
const stageOptions = ELECTION_STAGES.map((value) => ({ value, label: STAGE_LABELS[value] }));
const stateOptions = STATES.map((s) => ({ value: s.code, label: s.name }));

// The district list for the office's kind and the state, from the Census; a filter narrows long ones (cities).
const options = ref<DistrictOption[]>([]);
const optionsLoading = ref(false);
const optionsError = ref<string | null>(null);
const filter = ref('');
const shownOptions = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return options.value.filter((d) => !needle || d.name.toLowerCase().includes(needle)).map((d) => ({ value: d.geoid, label: d.name }));
});
const chosen = computed<DistrictOption | null>(() => {
  if (kind.value === 'nation' || kind.value === 'state') return options.value[0] ?? null;
  return options.value.find((d) => d.geoid === form.districtId) ?? null;
});

let loads = 0;
async function loadOptions() {
  const run = ++loads;
  optionsError.value = null;
  options.value = [];
  if (kind.value !== 'nation' && !form.state) return;
  optionsLoading.value = true;
  try {
    const list = await districts(kind.value, kind.value === 'nation' ? null : form.state);
    if (run === loads) options.value = list;
  } catch (e) {
    if (run === loads) optionsError.value = errorMessage(e);
  } finally {
    if (run === loads) optionsLoading.value = false;
  }
}

// A district chosen for another kind or state is not one of the new list's.
watch([kind, () => form.state], async () => {
  await loadOptions();
  if (form.districtId && !(listed.value && options.value.some((d) => d.geoid === form.districtId))) form.districtId = null;
});

watch(
  () => form.office,
  (office, previous) => {
    // Keep a title the member wrote; replace the one the form suggested for the previous office.
    if (!form.officeTitle.trim() || form.officeTitle === OFFICE_CHOICES[previous].title) form.officeTitle = OFFICE_CHOICES[office].title;
    if (OFFICE_DISTRICTS[office] === 'nation') form.state = null;
  },
);

const markers = computed<MapMarker[]>(() =>
  chosen.value?.point ? [{ id: chosen.value.geoid, point: chosen.value.point, title: chosen.value.name, caption: DISTRICT_LABELS[kind.value] }] : [],
);
const outline = computed(() => (chosen.value ? { kind: chosen.value.kind, geoid: chosen.value.geoid } : null));

onMounted(async () => {
  if (!props.candidacyId) {
    form.state = session.me?.member?.state ?? null;
    return;
  }
  try {
    const record = (await myCandidacies()).find((c) => c.candidacyId === props.candidacyId);
    if (!record || record.status !== 'open') throw new Error('This candidacy cannot be changed: it was withdrawn or taken down, or it is not yours.');
    const content = currentContent(record);
    existing.value = record;
    Object.assign(form, {
      office: content.office,
      officeTitle: content.officeTitle,
      state: content.district.state,
      districtId: content.district.kind === 'nation' || content.district.kind === 'state' ? null : content.district.geoid,
      electionDate: content.electionDate,
      election: content.election,
      ballotLabel: content.ballotLabel ?? '',
      platform: content.platform,
      website: content.website ?? '',
    });
  } catch (e) {
    loadError.value = errorMessage(e);
  }
});

async function send() {
  const checked = validate(candidacyInputSchema, { ...form, state: kind.value === 'nation' ? null : form.state, districtId: listed.value ? form.districtId : null });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  saving.value = true;
  const ok = await attempt(
    async () => {
      try {
        if (existing.value) await changeCandidacy(existing.value.candidacyId, checked.data, existing.value.version);
        else await declareCandidacy(checked.data);
      } catch (e) {
        errors.value = apiFieldErrors(e);
        throw e;
      }
    },
    existing.value ? 'Change sent for review' : 'Candidacy sent for review',
  );
  saving.value = false;
  if (ok) await router.push('/candidates');
}
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div><router-link to="/candidates">← Candidates</router-link></div>
      <div>
        <h1 class="text-h5 q-mb-xs">{{ editing ? 'Edit your candidacy' : 'Declare a candidacy' }}</h1>
        <div class="text-grey-7">
          Tell members and voters what you are running for, where and when, and what you stand for. A Membership Admin
          reviews it before it appears on the Candidates page<template v-if="editing">; until your change is approved,
          the page keeps showing the version approved before</template>.
        </div>
      </div>
      <q-banner v-if="!active" class="bg-orange-1 text-black" rounded>Only Active members can declare a candidacy.</q-banner>
      <q-banner v-else-if="loadError" class="bg-orange-1 text-black" rounded>{{ loadError }}</q-banner>
      <template v-else>
        <q-banner v-if="existing?.declined" class="bg-orange-1 text-black" rounded>
          {{ STATUS_TEXT[existing.stage].label }}. What to change: {{ existing.declined.note }}
        </q-banner>
        <q-form class="candidacy-form" @submit.prevent="send">
          <h2 class="text-subtitle1">The office</h2>
          <q-select
            v-model="form.office"
            :options="officeOptions"
            emit-value
            map-options
            outlined
            label="Running for"
            :error="!!errors.office"
            :error-message="errors.office"
          />
          <q-input
            v-model="form.officeTitle"
            outlined
            label="Office as it appears on the ballot"
            hint="e.g. U.S. Representative, Mayor, County Sheriff"
            :maxlength="CANDIDACY_LIMITS.officeTitle"
            :error="!!errors.officeTitle"
            :error-message="errors.officeTitle"
          />
          <q-select
            v-if="kind !== 'nation'"
            v-model="form.state"
            :options="stateOptions"
            emit-value
            map-options
            outlined
            label="State or territory"
            :error="!!errors.state"
            :error-message="errors.state"
          />
          <q-select
            v-if="listed"
            v-model="form.districtId"
            :options="shownOptions"
            emit-value
            map-options
            use-input
            input-debounce="0"
            outlined
            :label="DISTRICT_LABELS[kind]"
            :hint="form.state ? 'Type to narrow the list' : 'Choose the state first'"
            :disable="!form.state"
            :loading="optionsLoading"
            :error="!!errors.districtId || !!optionsError"
            :error-message="errors.districtId ?? optionsError ?? undefined"
            @filter="(text: string, update: (fn: () => void) => void) => update(() => (filter = text))"
          >
            <template #no-option>
              <q-item><q-item-section class="text-grey-7">{{ optionsLoading ? 'Loading…' : 'No district matches' }}</q-item-section></q-item>
            </template>
          </q-select>
          <div v-else-if="optionsError" class="text-negative">{{ optionsError }}</div>
          <DistrictMap
            v-if="chosen"
            :markers="markers"
            :outline="outline"
            :label="`Map of ${chosen.name}`"
            height="260px"
          />
          <div v-if="chosen?.vintage" class="text-caption text-grey-7">Boundaries from the U.S. Census Bureau ({{ chosen.vintage }})</div>

          <h2 class="text-subtitle1">The election</h2>
          <div class="row q-col-gutter-md">
            <q-select
              v-model="form.election"
              :options="stageOptions"
              emit-value
              map-options
              outlined
              label="Election"
              class="col-12 col-sm-6"
              :error="!!errors.election"
              :error-message="errors.election"
            />
            <q-input
              v-model="form.electionDate"
              type="date"
              outlined
              stack-label
              label="Election day"
              class="col-12 col-sm-6"
              :error="!!errors.electionDate"
              :error-message="errors.electionDate"
            />
          </div>
          <q-input
            v-model="form.ballotLabel"
            outlined
            label="Party or label on the ballot (optional)"
            hint="e.g. Transhumanist, Independent, Nonpartisan"
            :maxlength="CANDIDACY_LIMITS.ballotLabel"
            :error="!!errors.ballotLabel"
            :error-message="errors.ballotLabel"
          />

          <h2 class="text-subtitle1">Your platform</h2>
          <q-input
            v-model="form.platform"
            type="textarea"
            autogrow
            outlined
            label="What you stand for"
            hint="Plain text; blank lines start new paragraphs"
            counter
            :maxlength="CANDIDACY_LIMITS.platform"
            input-class="candidacy-form__platform"
            :error="!!errors.platform"
            :error-message="errors.platform"
          />
          <q-input
            v-model="form.website"
            outlined
            type="url"
            label="Campaign website (optional)"
            placeholder="https://"
            :error="!!errors.website"
            :error-message="errors.website"
          />
          <q-banner v-if="errors._" class="bg-orange-1 text-black" rounded>{{ errors._ }}</q-banner>
          <div class="row q-gutter-sm">
            <q-btn type="submit" color="primary" unelevated :loading="saving" :label="editing ? 'Send the change for review' : 'Send for review'" />
            <q-btn flat color="primary" label="Cancel" to="/candidates" />
          </div>
        </q-form>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.candidacy-form {
  display: grid;
  gap: 12px;
}
:deep(.candidacy-form__platform) {
  min-height: 160px;
}
</style>
