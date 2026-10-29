<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { createTeamSchema, type MemberMatch, type TeamSummary } from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import MemberPicker from '../offices/MemberPicker.vue';
import { createTeam, listTeams } from './api.js';
import { fromForm, toForm, type SettingsForm } from './settings-form.js';
import TeamBadge from './TeamBadge.vue';
import TeamSettingsFields from './TeamSettingsFields.vue';
import { emptySettings, leadsLine, membersLine, POLICY_LABELS, slugFrom } from './team-text.js';

/**
 * Teams for Membership Admins (design §5.7): every team, archived ones too, with requests waiting on each; a new team
 * with its first lead. Opening a team manages it: its members, leads, requests and settings.
 */
const router = useRouter();
const teams = ref<TeamSummary[] | null>(null);

async function load() {
  await attempt(async () => {
    teams.value = await listTeams('admin');
  });
}

const creating = ref(false);
const form = ref<SettingsForm>(toForm(emptySettings()));
const teamId = ref('');
/** The ID follows the name until someone types one of their own. */
const idTouched = ref(false);
const leadMember = ref<MemberMatch | null>(null);
const errors = ref<FieldErrors>({});

watch(
  () => form.value.name,
  (name) => {
    if (!idTouched.value) teamId.value = slugFrom(name);
  },
);

function startCreating() {
  form.value = toForm(emptySettings());
  teamId.value = '';
  idTouched.value = false;
  leadMember.value = null;
  errors.value = {};
  creating.value = true;
}

async function create() {
  const checked = validate(createTeamSchema, { ...fromForm(form.value), teamId: teamId.value, leadAccountId: leadMember.value?.accountId ?? '' });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  let created = null as string | null;
  await attempt(async () => {
    try {
      created = (await createTeam(checked.data)).team.teamId;
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, 'Team created');
  if (created) await router.push(`/admin/teams/${encodeURIComponent(created)}`);
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Active members see every team that is not archived, and who is on it, on the
      <router-link to="/teams">Teams page</router-link>. Each team's leads decide who joins and run it; you create teams,
      name their first lead, rename and archive them, and can change anything on any team.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!creating" unelevated no-caps color="primary" icon="add" label="New team" @click="startCreating" />
    </div>

    <q-card v-if="creating" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">New team</h2>
        <div class="text-caption text-grey-7">Takes effect at once, and is recorded in the audit ledger.</div>
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" @submit.prevent="create">
          <TeamSettingsFields v-model="form" :errors="errors" />
          <q-input
            v-model="teamId"
            outlined
            dense
            hide-bottom-space
            label="ID, for its address (e.g. outreach)"
            :hint="`The team's page will be /teams/${teamId || '…'}; it cannot change later.`"
            :error="!!errors.teamId"
            :error-message="errors.teamId"
            @update:model-value="idTouched = true"
          />
          <div>
            <div class="text-body2 text-weight-medium q-mb-xs">First lead</div>
            <MemberPicker v-model="leadMember" :unavailable="() => null" :error="errors.leadAccountId" action="Leads the team:" />
          </div>
          <div class="ustp-actions">
            <q-btn type="submit" unelevated color="primary" no-caps label="Create team" />
            <q-btn flat no-caps label="Cancel" @click="creating = false" />
          </div>
        </q-form>
      </q-card-section>
    </q-card>

    <div v-if="teams && teams.length === 0" class="text-grey-7">No teams yet.</div>
    <q-list v-else-if="teams" bordered separator class="rounded-borders">
      <q-item v-for="t in teams" :key="t.team.teamId" clickable :to="`/admin/teams/${encodeURIComponent(t.team.teamId)}`">
        <q-item-section avatar>
          <TeamBadge :team="t.team" size="40px" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ t.team.name }} <span class="text-grey-7">· {{ t.team.teamId }}</span></q-item-label>
          <q-item-label caption>{{ leadsLine(t) }} · {{ membersLine(t) }} · {{ POLICY_LABELS[t.team.joinPolicy] }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="ustp-actions">
            <q-badge v-if="t.team.archived" color="grey-7" label="Archived" />
            <q-badge v-if="t.waiting" color="orange-9" :label="`${t.waiting} waiting`" />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>
