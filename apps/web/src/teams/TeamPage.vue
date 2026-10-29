<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  DECLINED_RETRY_DAYS,
  leadTeamSettingsSchema,
  TEAM_LIMITS,
  updateTeamSchema,
  type MemberMatch,
  type TeamDetail,
  type TeamPerson,
  type TeamRequestView,
  type TeamRole,
} from 'ustp-domain';
import { focusFirstInvalid, usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt, dialog } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import MemberPicker from '../offices/MemberPicker.vue';
import { session } from '../session.js';
import {
  archiveTeam,
  decideRequest,
  getTeam,
  joinTeam,
  leaveTeam,
  makeLead,
  removeMember,
  saveTeam,
  setMember,
  stepDown,
  withdrawRequest,
  type TeamMode,
} from './api.js';
import { fromForm, toForm, type SettingsForm } from './settings-form.js';
import TeamBadge from './TeamBadge.vue';
import TeamSettingsFields from './TeamSettingsFields.vue';
import { day, emptySettings, hasRoom, leadsLine, membersLine, POLICY_LABELS, retryDay } from './team-text.js';

/**
 * One team (design §5.7). Members see what it does, who is on it, and join, ask to join or leave it; its leads also
 * decide requests, make co-leads, remove members and change its settings. A Membership Admin opens the same page from
 * the console (`admin`), where they can also rename, archive and restore it and put anyone on it as a lead or member.
 */
const props = defineProps<{ admin?: boolean }>();
const mode = computed<TeamMode>(() => (props.admin ? 'admin' : 'member'));
const route = useRoute();
const teamId = computed(() => String(route.params.teamId));

const detail = ref<TeamDetail | null>(null);
const error = ref<string | null>(null);
usePageTitle(() => detail.value?.team.name ?? 'Team');
/** The settings form, refilled from the team each time it loads unless they are being changed. */
const form = ref<SettingsForm>(toForm(emptySettings()));
const editing = ref(false);
const errors = ref<FieldErrors>({});

const team = computed(() => detail.value?.team);
const lead = computed(() => detail.value?.mine.role === 'lead');
/** Leads and Membership Admins run the team: requests, roster changes and settings. */
const manages = computed(() => props.admin || lead.value);
const leadCount = computed(() => detail.value?.roster.filter((p) => p.role === 'lead').length ?? 0);
const request = computed(() => detail.value?.mine.request ?? null);
const declinedUntil = computed(() => {
  const r = request.value;
  if (r?.status !== 'declined' || !r.decidedAt) return null;
  return Date.now() < Date.parse(r.decidedAt) + DECLINED_RETRY_DAYS * 86_400_000 ? retryDay(r.decidedAt) : null;
});

async function load() {
  error.value = null;
  try {
    detail.value = await getTeam(mode.value, teamId.value);
    form.value = toForm(detail.value.team);
  } catch (e) {
    detail.value = null;
    error.value = e instanceof ApiError && e.status === 403 ? 'Teams are for Active members.' : errorMessage(e);
  }
}
watch(teamId, load, { immediate: true });

/** Runs a change that answers with the team, and shows it. */
async function act(change: () => Promise<TeamDetail>, success?: string): Promise<boolean> {
  return attempt(async () => {
    detail.value = await change();
    if (!editing.value) form.value = toForm(detail.value.team);
  }, success);
}

const confirm = (title: string, message: string, ok: string) =>
  new Promise<boolean>((resolve) => {
    dialog({ title, message, cancel: true, ok: { label: ok, color: 'primary', noCaps: true, unelevated: true } })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false));
  });

// Joining: at once on an open team; on one whose leads decide, a short request with the answer to its question.
const asking = ref(false);
const ask = reactive({ message: '', answer: '' });
const askErrors = ref<FieldErrors>({});

async function join() {
  if (!team.value) return;
  if (team.value.joinPolicy === 'open') {
    await act(() => joinTeam(teamId.value, { message: null, answer: null }), `You joined ${team.value.name}`);
    return;
  }
  Object.assign(ask, { message: '', answer: '' });
  askErrors.value = {};
  asking.value = true;
}

async function sendRequest() {
  if (team.value?.joinQuestion && !ask.answer.trim()) {
    askErrors.value = { answer: 'answer the team’s question' };
    await focusFirstInvalid();
    return;
  }
  const sent = await act(() => joinTeam(teamId.value, { message: ask.message || null, answer: ask.answer || null }), 'Asked; a lead will decide');
  if (sent) asking.value = false;
}

async function withdraw() {
  await act(() => withdrawRequest(teamId.value), 'Request withdrawn');
}

async function leave() {
  if (!team.value || !(await confirm(`Leave ${team.value.name}?`, 'You can join or ask again later.', 'Leave'))) return;
  await act(() => leaveTeam(teamId.value), `You left ${team.value.name}`);
}

async function resign() {
  if (!(await confirm('Step down as lead?', 'You stay on the team as a member; the other leads carry on.', 'Step down'))) return;
  await act(() => stepDown(teamId.value), 'You are no longer a lead');
}

// Requests and the roster, for leads and Membership Admins.
async function approve(r: TeamRequestView) {
  await act(() => decideRequest(mode.value, teamId.value, r.accountId, { decision: 'approve', note: null }), `${r.name} joined the team`);
}

function decline(r: TeamRequestView) {
  dialog({
    title: `Decline ${r.name}’s request`,
    message: `They can ask again in two weeks. A note, if you leave one, is shown to them.`,
    prompt: { model: '', type: 'textarea', label: 'Note to them (optional)', isValid: (v: string) => v.length <= TEAM_LIMITS.note },
    cancel: true,
    ok: { label: 'Decline', color: 'negative', noCaps: true, unelevated: true },
  }).onOk((note: string) => {
    void act(() => decideRequest(mode.value, teamId.value, r.accountId, { decision: 'decline', note: note.trim() || null }), 'Request declined');
  });
}

async function promote(p: TeamPerson) {
  await act(() => makeLead(mode.value, teamId.value, p.accountId), `${p.name} now leads the team`);
}

async function demote(p: TeamPerson) {
  await act(() => setMember(teamId.value, { accountId: p.accountId, role: 'member' }), `${p.name} is a member again`);
}

async function remove(p: TeamPerson) {
  if (!(await confirm(`Remove ${p.name}?`, 'They can ask to join again later.', 'Remove'))) return;
  await act(() => removeMember(mode.value, teamId.value, p.accountId), `${p.name} was removed`);
}

/** What a lead may do to someone on the roster; a Membership Admin may do it all, keeping the team a lead. */
const canPromote = (p: TeamPerson) => manages.value && p.role === 'member' && p.active;
const canDemote = (p: TeamPerson) => props.admin && p.role === 'lead' && leadCount.value > 1;
const canRemove = (p: TeamPerson) =>
  p.accountId !== session.me?.account?.accountId &&
  (props.admin ? p.role === 'member' || leadCount.value > 1 : lead.value && p.role === 'member');

// Settings.
async function save() {
  if (!detail.value) return;
  const { name, ...rest } = fromForm(form.value);
  const basedOn = detail.value.team.version;
  const checked = props.admin
    ? validate(updateTeamSchema, { name, ...rest, basedOn })
    : validate(leadTeamSettingsSchema, { ...rest, basedOn });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  errors.value = {};
  const saved = await attempt(async () => {
    try {
      detail.value = await saveTeam(mode.value, teamId.value, checked.data);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, 'Team saved');
  if (saved && detail.value) {
    form.value = toForm(detail.value.team);
    editing.value = false;
  }
}

function cancelEdit() {
  if (detail.value) form.value = toForm(detail.value.team);
  errors.value = {};
  editing.value = false;
}

// A Membership Admin's own tools.
const adding = reactive<{ member: MemberMatch | null; role: TeamRole }>({ member: null, role: 'member' });
const addError = ref<string | undefined>();
const onTeam = (m: MemberMatch) => {
  const p = detail.value?.roster.find((x) => x.accountId === m.accountId);
  if (!p) return null;
  return p.role === adding.role ? (p.role === 'lead' ? 'Already leads the team' : 'Already on the team') : null;
};

async function add() {
  if (!adding.member) {
    addError.value = 'choose a member';
    return;
  }
  addError.value = undefined;
  const { member, role } = adding;
  const done = await act(() => setMember(teamId.value, { accountId: member.accountId, role }), `${member.legalName} added as ${role}`);
  if (done) adding.member = null;
}

async function toggleArchived() {
  if (!team.value) return;
  const archiving = !team.value.archived;
  const ok = await confirm(
    archiving ? `Archive ${team.value.name}?` : `Restore ${team.value.name}?`,
    archiving
      ? 'Members no longer see it, and nobody can join or ask. Who is on it, and any requests, are kept for a restore.'
      : 'Members see it again, and can join or ask as its settings say.',
    archiving ? 'Archive' : 'Restore',
  );
  if (ok) await act(() => archiveTeam(teamId.value, archiving), archiving ? 'Team archived' : 'Team restored');
}

const back = computed(() => (props.admin ? { path: '/admin', query: { tab: 'teams' } } : { path: '/teams' }));
const roleLabel = (role: TeamRole) => (role === 'lead' ? 'Lead' : 'Member');
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <q-btn flat dense no-caps icon="arrow_back" label="Teams" :to="back" class="ustp-back" />
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!detail || !team" class="text-grey-7">Loading…</div>
      <template v-else>
        <div class="team-head">
          <TeamBadge :team="team" size="56px" />
          <div class="team-head__text">
            <h1 class="text-h5">{{ team.name }}</h1>
            <div class="text-caption text-grey-7">
              {{ leadsLine(detail) }} · {{ membersLine(detail) }} · {{ POLICY_LABELS[team.joinPolicy] }}
            </div>
          </div>
        </div>
        <q-banner v-if="team.archived" class="bg-grey-3 text-black" rounded>
          This team is archived: members do not see it, and nobody can join or ask.
        </q-banner>
        <p v-if="team.description" class="team-description">{{ team.description }}</p>

        <!-- The person's own place on the team, and what they can do about it. -->
        <q-card v-if="!admin" flat bordered>
          <q-card-section v-if="detail.mine.role" class="ustp-header">
            <div>
              <h2 class="text-subtitle1">{{ lead ? 'You lead this team' : 'You are on this team' }}</h2>
              <div v-if="team.memberLink" class="text-caption text-grey-7">The team talks here; only its members see this link.</div>
            </div>
            <div class="ustp-actions">
              <q-btn
                v-if="team.memberLink"
                unelevated
                no-caps
                color="primary"
                icon="forum"
                label="Open the team's link"
                :href="team.memberLink"
                target="_blank"
                rel="noopener noreferrer"
              />
              <q-btn v-if="lead && leadCount > 1" flat no-caps label="Step down as lead" @click="resign" />
              <q-btn
                flat
                no-caps
                color="negative"
                label="Leave"
                :disable="lead && leadCount <= 1"
                :title="lead && leadCount <= 1 ? 'Make someone else a lead first' : undefined"
                @click="leave"
              />
            </div>
          </q-card-section>
          <q-card-section v-else-if="request?.status === 'pending'" class="ustp-header">
            <div>
              <h2 class="text-subtitle1">You asked to join on {{ day(request.askedAt) }}</h2>
              <div class="text-caption text-grey-7">A lead will decide.</div>
            </div>
            <div class="ustp-actions">
              <q-btn flat no-caps label="Withdraw request" @click="withdraw" />
            </div>
          </q-card-section>
          <q-card-section v-else class="ustp-header">
            <div>
              <template v-if="declinedUntil">
                <h2 class="text-subtitle1">A lead declined your request</h2>
                <div class="text-caption text-grey-7">
                  <template v-if="request?.note">“{{ request.note }}” · </template>You can ask again from {{ declinedUntil }}.
                </div>
              </template>
              <template v-else-if="team.joinPolicy === 'closed'">
                <h2 class="text-subtitle1">This team is not taking members</h2>
                <div class="text-caption text-grey-7">A Membership Admin adds people to it.</div>
              </template>
              <template v-else-if="!hasRoom(detail)">
                <h2 class="text-subtitle1">This team is full</h2>
                <div class="text-caption text-grey-7">It takes {{ team.capacity }} members at most.</div>
              </template>
              <template v-else>
                <h2 class="text-subtitle1">{{ team.joinPolicy === 'open' ? 'Anyone can join this team' : 'Its leads approve who joins' }}</h2>
                <div v-if="request?.status === 'declined' && request.note" class="text-caption text-grey-7">
                  Last time a lead wrote: “{{ request.note }}”
                </div>
              </template>
            </div>
            <div v-if="!declinedUntil && team.joinPolicy !== 'closed' && hasRoom(detail)" class="ustp-actions">
              <q-btn unelevated no-caps color="primary" :label="team.joinPolicy === 'open' ? 'Join' : 'Ask to join'" @click="join" />
            </div>
          </q-card-section>
        </q-card>

        <!-- Requests waiting for a lead. -->
        <q-card v-if="detail.requests" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Requests to join</h2>
            <div v-if="!detail.requests.length" class="text-caption text-grey-7">Nobody is waiting.</div>
          </q-card-section>
          <q-list v-if="detail.requests.length" separator>
            <q-item v-for="r in detail.requests" :key="r.accountId">
              <q-item-section>
                <q-item-label>
                  {{ r.name }}<span v-if="r.state" class="text-grey-7"> ({{ r.state }})</span>
                  <span class="text-grey-7"> · asked {{ day(r.askedAt) }}</span>
                </q-item-label>
                <q-item-label v-if="r.message" caption class="team-text">{{ r.message }}</q-item-label>
                <q-item-label v-if="r.question" caption class="team-text">
                  <strong>{{ r.question }}</strong> {{ r.answer }}
                </q-item-label>
                <q-item-label v-if="!r.active" caption class="text-negative">No longer an Active member: decline this request.</q-item-label>
              </q-item-section>
              <q-item-section side>
                <div class="ustp-actions">
                  <q-btn v-if="r.active" unelevated dense no-caps color="positive" label="Approve" @click="approve(r)">
                    <span class="sr-only">&nbsp;{{ r.name }}</span>
                  </q-btn>
                  <q-btn flat dense no-caps color="negative" label="Decline" @click="decline(r)">
                    <span class="sr-only">&nbsp;{{ r.name }}</span>
                  </q-btn>
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <!-- Who is on the team. -->
        <q-card flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Who is on the team</h2>
            <div v-if="!detail.roster.length" class="text-caption text-grey-7">Nobody yet.</div>
          </q-card-section>
          <q-list v-if="detail.roster.length" separator>
            <q-item v-for="p in detail.roster" :key="p.accountId">
              <q-item-section>
                <q-item-label>
                  {{ p.name }}<span v-if="p.state" class="text-grey-7"> ({{ p.state }})</span>
                </q-item-label>
                <q-item-label caption>
                  {{ roleLabel(p.role) }} · since {{ day(p.joinedAt) }}<template v-if="!p.active"> · no longer an Active member</template>
                </q-item-label>
              </q-item-section>
              <q-item-section v-if="p.role === 'lead'" side>
                <q-badge color="primary" label="Lead" />
              </q-item-section>
              <q-item-section v-if="manages && (canPromote(p) || canDemote(p) || canRemove(p))" side>
                <div class="ustp-actions">
                  <q-btn v-if="canPromote(p)" flat dense no-caps color="primary" label="Make lead" @click="promote(p)">
                    <span class="sr-only">&nbsp;{{ p.name }}</span>
                  </q-btn>
                  <q-btn v-if="canDemote(p)" flat dense no-caps label="Make member" @click="demote(p)">
                    <span class="sr-only">&nbsp;{{ p.name }}</span>
                  </q-btn>
                  <q-btn v-if="canRemove(p)" flat dense no-caps color="negative" label="Remove" @click="remove(p)">
                    <span class="sr-only">&nbsp;{{ p.name }}</span>
                  </q-btn>
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <!-- A Membership Admin puts someone on the team directly. -->
        <q-card v-if="admin && !team.archived" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Add someone</h2>
            <div class="text-caption text-grey-7">
              Any Active member, as a lead or a member, whatever the team's join policy or size limit. Choosing someone
              already on it changes their role.
            </div>
          </q-card-section>
          <q-card-section>
            <q-form class="ustp-form" @submit.prevent="add">
              <MemberPicker v-model="adding.member" :unavailable="onTeam" :error="addError" action="Adds" />
              <q-option-group
                v-model="adding.role"
                inline
                :options="[
                  { value: 'member', label: 'As a member' },
                  { value: 'lead', label: 'As a lead' },
                ]"
              />
              <div class="ustp-actions">
                <q-btn type="submit" unelevated color="primary" no-caps label="Add to the team" />
              </div>
            </q-form>
          </q-card-section>
        </q-card>

        <!-- Settings: leads change all but the name; Membership Admins all, and archive. -->
        <q-card v-if="manages && (admin || !team.archived)" flat bordered>
          <q-card-section class="ustp-header">
            <div>
              <h2 class="text-subtitle1">Team settings</h2>
              <div class="text-caption text-grey-7">
                {{ admin ? 'Changes take effect at once and are recorded in the audit ledger.' : 'Leads change these; a Membership Admin renames the team.' }}
              </div>
            </div>
            <div class="ustp-actions">
              <q-btn v-if="!editing" outline no-caps color="primary" label="Change settings" @click="editing = true" />
              <q-btn v-if="admin" flat no-caps :label="team.archived ? 'Restore team' : 'Archive team'" @click="toggleArchived" />
            </div>
          </q-card-section>
          <q-card-section v-if="editing">
            <q-form class="ustp-form" @submit.prevent="save">
              <TeamSettingsFields v-model="form" :errors="errors" :lock-name="!admin" />
              <div class="ustp-actions">
                <q-btn type="submit" unelevated color="primary" no-caps label="Save settings" />
                <q-btn flat no-caps label="Cancel" @click="cancelEdit" />
              </div>
            </q-form>
          </q-card-section>
        </q-card>
      </template>
    </div>

    <q-dialog v-model="asking" aria-label="Ask to join">
      <q-card class="ustp-dialog">
        <q-card-section>
          <h2 class="text-h6">Ask to join {{ team?.name }}</h2>
          <div class="text-caption text-grey-7">The team's leads see your name, your state and what you write here.</div>
        </q-card-section>
        <q-card-section>
          <q-form class="ustp-form" @submit.prevent="sendRequest">
            <q-input
              v-if="team?.joinQuestion"
              v-model="ask.answer"
              outlined
              autogrow
              hide-bottom-space
              :label="team.joinQuestion"
              :maxlength="TEAM_LIMITS.answer"
              :error="!!askErrors.answer"
              :error-message="askErrors.answer"
            />
            <q-input
              v-model="ask.message"
              outlined
              autogrow
              hide-bottom-space
              label="Anything else for the leads (optional)"
              :maxlength="TEAM_LIMITS.message"
            />
            <div class="ustp-actions">
              <q-btn type="submit" unelevated color="primary" no-caps label="Send request" />
              <q-btn v-close-popup flat no-caps label="Cancel" />
            </div>
          </q-form>
        </q-card-section>
      </q-card>
    </q-dialog>
  </PageShell>
</template>

<style scoped>
.team-head {
  display: flex;
  gap: 16px;
  align-items: center;
}
.team-head__text {
  min-width: 0;
}
.team-description,
.team-text {
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.team-description {
  margin: 0;
}
</style>
