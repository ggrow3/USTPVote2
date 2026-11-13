<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ROLES, roleChangeSchema, type AccountSummary, type Actor, type Role } from 'ustp-domain';
import { focusSoon } from '../../a11y.js';
import { acting } from '../../acting.js';
import { api } from '../../api.js';
import { roleLabel } from '../../approval-text.js';
import { attempt, dialog } from '../../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../../forms.js';
import { roleChangeBlocker } from '../../role-change.js';
import { hasRole, session } from '../../session.js';

/**
 * While this tab acts as a test persona, the accountIds of every persona (design §10.4), or null until the People tab
 * has them: the persona changes test personas' roles only.
 */
const props = defineProps<{ personaIds: ReadonlySet<string> | null }>();
const emit = defineEmits<{ changed: [] }>();

/** A Site Admin grants and revokes every role but System Admin (design §10.2), so it is not offered to them. */
const systemAdmin = computed(() => hasRole('system_admin'));
const roleOptions = computed(() =>
  ROLES.filter((r) => systemAdmin.value || r !== 'system_admin').map((r) => ({ label: roleLabel(r), value: r })),
);

const request = reactive({ accountId: '', role: 'membership_admin' as Role, change: 'grant' as 'grant' | 'revoke', reason: '' });
const errors = ref<FieldErrors>({});

/** The person chosen from the People list; `byId` switches to typing an account ID instead. */
const picked = ref<AccountSummary | null>(null);
const byId = ref(false);
const people = ref<AccountSummary[]>([]);
const subjectId = computed(() => (byId.value ? request.accountId.trim() : (picked.value?.accountId ?? '')));

/** The caller as the API's checks see them (actorOf on the server). */
const actor = computed<Actor>(() => ({
  accountId: session.me?.account?.accountId ?? '',
  roles: session.me?.roles ?? [],
  mfa: !!session.me && (session.me.mfa.signedInWithMfa || !session.me.mfa.required),
  authAgeSeconds: 0,
}));

/** Why the API would refuse this change, mirroring its checks (design §10.2, §10.4); roles are unknown for a typed ID. */
const blocker = computed(() => {
  if (!subjectId.value) return null;
  const subject = { accountId: subjectId.value, roles: byId.value ? null : (picked.value?.roles ?? null) };
  return roleChangeBlocker(actor.value, subject, request.change, request.role, acting.persona ? { personaIds: props.personaIds } : null);
});

const personLabel = (a: AccountSummary) => a.primaryEmail ?? a.displayName ?? a.accountId;
const rolesText = (roles: readonly Role[]) => (roles.length ? roles.map(roleLabel).join(', ') : 'no role');
const pickedSummary = computed(() => {
  const a = picked.value;
  if (!a || byId.value) return null;
  return `${a.displayName ?? personLabel(a)} holds ${rolesText(a.roles)}${a.memberStatus ? `; membership ${a.memberStatus}` : ''}.`;
});

async function searchPeople(text: string, update: (fn: () => void) => void, abort: () => void) {
  const query = new URLSearchParams({ limit: '20' });
  if (text.trim()) query.set('email', text.trim());
  let found: AccountSummary[] = [];
  const ok = await attempt(async () => {
    found = await api<AccountSummary[]>('GET', `/v1/admin/accounts?${query}`);
  });
  if (ok) update(() => (people.value = found));
  else abort();
}

/** Fills in the person ("Change roles" in the People list) and moves focus to the form. */
function choose(account: AccountSummary) {
  byId.value = false;
  picked.value = account;
  errors.value = {};
  void focusSoon('#role-change-title');
}
defineExpose({ choose });

/** One System Admin's word is enough, so say plainly what is about to happen before it does. */
function confirmChange(): Promise<boolean> {
  const who = byId.value || !picked.value ? `account ${subjectId.value}` : personLabel(picked.value);
  const role = roleLabel(request.role);
  const [title, message] =
    request.change === 'grant'
      ? [`Grant ${role}?`, `${who} becomes ${role} as soon as you confirm. No other admin approves it.`]
      : [`Revoke ${role}?`, `${who} stops being ${role} as soon as you confirm. No other admin approves it.`];
  return new Promise((resolve) => {
    dialog({ title, message, cancel: true, persistent: true })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false));
  });
}

async function submit() {
  const checked = validate(roleChangeSchema, { ...request, accountId: subjectId.value });
  if (!checked.ok) {
    errors.value = checked.errors;
    if (errors.value.accountId && !byId.value) errors.value.accountId = 'Choose a person.';
    return;
  }
  errors.value = {};
  if (blocker.value || !(await confirmChange())) return;
  const ok = await attempt(
    async () => {
      try {
        await api('POST', '/v1/admin/roles', checked.data);
      } catch (e) {
        errors.value = apiFieldErrors(e);
        throw e;
      }
    },
    `${roleLabel(checked.data.role)} ${checked.data.change === 'grant' ? 'granted' : 'revoked'}`,
  );
  if (ok) {
    request.accountId = '';
    request.reason = '';
    picked.value = null;
    emit('changed');
  }
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <h2 id="role-change-title" class="text-subtitle1">Change a role</h2>
      <div class="text-caption text-grey-7">
        Takes effect as soon as you confirm; no second admin approves it. The change is recorded in the audit ledger.
        A person may hold at most two roles, an Auditor holds no other role, and a System Admin is not also a Site Admin.
        <template v-if="!systemAdmin">
          As a Site Admin you change every role but System Admin, for anyone who is not a System Admin.
        </template>
        <template v-if="acting.persona">
          Acting as {{ acting.persona.label }}, you change the roles of test personas only; stop acting to change a
          real account's roles.
        </template>
      </div>
    </q-card-section>
    <q-card-section>
      <q-form class="ustp-form" @submit.prevent="submit">
        <div>
          <q-select
            v-if="!byId"
            v-model="picked"
            outlined
            dense
            hide-bottom-space
            use-input
            clearable
            input-debounce="300"
            label="Person"
            hint="Type the start of their email address."
            :options="people"
            :option-label="personLabel"
            option-value="accountId"
            :error="!!errors.accountId"
            :error-message="errors.accountId"
            @filter="searchPeople"
          >
            <template #option="scope">
              <q-item v-bind="scope.itemProps">
                <q-item-section>
                  <q-item-label>{{ personLabel(scope.opt) }}</q-item-label>
                  <q-item-label caption>
                    {{ scope.opt.displayName ?? 'No name' }} · holds {{ rolesText(scope.opt.roles) }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </template>
            <template #no-option>
              <q-item>
                <q-item-section class="text-grey-7">No account with that email.</q-item-section>
              </q-item>
            </template>
          </q-select>
          <q-input
            v-else
            v-model="request.accountId"
            outlined
            dense
            hide-bottom-space
            label="Account ID"
            hint="Copy it from the list above or the person's Account page."
            :error="!!errors.accountId"
            :error-message="errors.accountId"
          />
          <div v-if="pickedSummary" class="ustp-message">{{ pickedSummary }}</div>
          <q-btn
            flat
            dense
            no-caps
            class="q-mt-xs"
            :label="byId ? 'Choose from the People list instead' : 'Enter an account ID instead'"
            @click="byId = !byId"
          />
        </div>
        <div class="ustp-row">
          <q-btn-toggle
            v-model="request.change"
            no-caps
            toggle-color="primary"
            role="group"
            aria-label="Change"
            :options="[
              { label: 'Grant', value: 'grant' },
              { label: 'Revoke', value: 'revoke' },
            ]"
          />
          <q-select
            v-model="request.role"
            outlined
            dense
            emit-value
            map-options
            label="Role"
            :options="roleOptions"
          />
        </div>
        <q-input
          v-model="request.reason"
          outlined
          dense
          hide-bottom-space
          autogrow
          label="Reason"
          :error="!!errors.reason"
          :error-message="errors.reason"
        />
        <div>
          <div aria-live="polite" class="text-caption text-deep-orange-10" :class="{ 'q-mb-sm': blocker }">{{ blocker ?? '' }}</div>
          <div class="ustp-actions">
            <q-btn
              type="submit"
              color="primary"
              :label="request.change === 'grant' ? 'Grant role' : 'Revoke role'"
              :disable="!!blocker"
            />
          </div>
        </div>
      </q-form>
    </q-card-section>
  </q-card>
</template>
