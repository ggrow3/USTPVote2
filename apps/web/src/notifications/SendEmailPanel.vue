<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  broadcastAudienceSchema,
  broadcastMessage,
  COUNTRIES,
  MAX_BROADCAST_BODY,
  MAX_BROADCAST_PICKED,
  MAX_BROADCAST_SUBJECT,
  US_STATES,
  type BroadcastAudience,
  type BroadcastPreview,
  type BroadcastsView,
  type BroadcastSummary,
  type MemberMatch,
} from 'ustp-domain';
import { askReason, attempt, dialog } from '../dialogs.js';
import MemberPicker from '../offices/MemberPicker.vue';
import { approveEmailToMembers, cancelEmailToMembers, emailMembers, emailsToMembers, previewEmailToMembers, rejectEmailToMembers, searchMembersToEmail } from './api.js';
import { approvalText, audienceText, broadcastStatusText, previewText, RECIPIENT_RULE } from './broadcast-text.js';

/**
 * An email an admin writes to members (design §10.12), for Membership and System Admins: who it goes to, with a live count
 * of who that comes to and why the rest do not get it, the words, a preview, then a confirmation with the count. Below it,
 * the emails sent so far and how each went, and a way to stop one still going out.
 */
const kind = ref<BroadcastAudience['kind']>('all_active');
const countries = ref<string[]>([]);
const states = ref<string[]>([]);
const picked = ref<MemberMatch[]>([]);
const choosing = ref<MemberMatch | null>(null);
const subject = ref('');
const body = ref('');
const preview = ref<BroadcastPreview | null>(null);
const view = ref<BroadcastsView | null>(null);

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));
const STATE_OPTIONS = US_STATES.map((s) => ({ value: s.code, label: s.name }));
const countryOptions = ref(COUNTRY_OPTIONS);
const stateOptions = ref(STATE_OPTIONS);
const filter = (all: typeof COUNTRY_OPTIONS, into: typeof countryOptions) => (text: string, update: (fn: () => void) => void) =>
  update(() => {
    const t = text.trim().toLowerCase();
    into.value = t ? all.filter((o) => o.label.toLowerCase().includes(t)) : all;
  });
const filterCountries = filter(COUNTRY_OPTIONS, countryOptions);
const filterStates = filter(STATE_OPTIONS, stateOptions);

const audience = computed<BroadcastAudience | null>(() => {
  const chosen: BroadcastAudience =
    kind.value === 'all_active'
      ? { kind: 'all_active' }
      : kind.value === 'place'
        ? { kind: 'place', countries: countries.value, states: states.value }
        : { kind: 'picked', accountIds: picked.value.map((m) => m.accountId) };
  return broadcastAudienceSchema.safeParse(chosen).success ? chosen : null;
});

// A newer choice replaces the count of an older one, whichever answer comes first.
let asked = 0;
watch(
  audience,
  async (now) => {
    const mine = ++asked;
    preview.value = null;
    if (!now) return;
    try {
      const found = await previewEmailToMembers(now);
      if (mine === asked) preview.value = found;
    } catch {
      if (mine === asked) preview.value = null;
    }
  },
  { immediate: true },
);

watch(choosing, (member) => {
  if (member && !picked.value.some((m) => m.accountId === member.accountId)) picked.value = [...picked.value, member];
  if (member) choosing.value = null;
});
const unpick = (accountId: string) => (picked.value = picked.value.filter((m) => m.accountId !== accountId));

const message = computed(() =>
  broadcastMessage({
    origin: window.location.origin,
    name: 'Alex Example',
    contact: view.value?.contact ?? null,
    subject: subject.value.trim() || '(no subject yet)',
    body: body.value.trim() || '(nothing written yet)',
  }),
);

const ready = computed(() => !!audience.value && !!preview.value?.willGet && !!subject.value.trim() && !!body.value.trim() && !view.value?.blocked);
const hint = computed(() => {
  if (view.value?.blocked) return null;
  if (!audience.value) return 'Choose who it goes to.';
  if (preview.value && !preview.value.willGet) return 'Nobody in that choice can get this email.';
  if (!subject.value.trim() || !body.value.trim()) return 'Write a subject and the email.';
  return null;
});

async function load() {
  await attempt(async () => {
    view.value = await emailsToMembers();
  });
}

function send() {
  const count = preview.value?.willGet ?? 0;
  if (!audience.value || !count) return;
  const chosen = audience.value;
  const approval = !!view.value?.approvalRequired;
  dialog({
    title: approval ? `Ask to send this email to ${count} ${count === 1 ? 'member' : 'members'}?` : `Send this email to ${count} ${count === 1 ? 'member' : 'members'}?`,
    message: approval
      ? `“${subject.value.trim()}” waits for a System Admin’s approval, and they are notified. Nothing goes until one approves it. It is recorded in the audit ledger.`
      : `“${subject.value.trim()}” goes out straight away, and is recorded in the audit ledger. You can stop what has not gone yet, but not take back what has.`,
    cancel: true,
    ok: { label: approval ? 'Send for approval' : `Send to ${count}`, color: 'primary', noCaps: true },
  }).onOk(() => {
    void attempt(async () => {
      await emailMembers({ subject: subject.value.trim(), body: body.value.trim(), audience: chosen });
      subject.value = '';
      body.value = '';
      await load();
    }, approval ? 'Sent for approval: the System Admins are notified.' : 'Queued: it starts going out within a minute.');
  });
}

function approve(broadcast: BroadcastSummary) {
  const n = broadcast.willGetNow ?? 0;
  dialog({
    title: 'Approve this email?',
    message: `“${broadcast.subject}” goes out to ${n} ${n === 1 ? 'member' : 'members'} straight away. Your approval is recorded in the audit ledger.`,
    cancel: true,
    ok: { label: `Approve and send to ${n}`, color: 'primary', noCaps: true },
  }).onOk(() => {
    void attempt(async () => {
      await approveEmailToMembers(broadcast.broadcastId);
      await load();
    }, 'Approved: it starts going out within a minute.');
  });
}

async function reject(broadcast: BroadcastSummary) {
  const reason = await askReason('Reject this email', `Nobody gets “${broadcast.subject}”. Say why, for whoever wrote it; it is recorded in the audit ledger.`);
  if (reason === null) return;
  if (await attempt(() => rejectEmailToMembers(broadcast.broadcastId, reason), 'Rejected.')) await load();
}

function withdraw(broadcast: BroadcastSummary) {
  dialog({
    title: 'Withdraw this email?',
    message: `Nobody gets “${broadcast.subject}”, and it cannot be sent again; write it again to ask anew.`,
    cancel: true,
    ok: { label: 'Withdraw', color: 'negative', noCaps: true },
  }).onOk(() => {
    void attempt(async () => {
      await cancelEmailToMembers(broadcast.broadcastId);
      await load();
    }, 'Withdrawn.');
  });
}

function stop(broadcast: BroadcastSummary) {
  dialog({
    title: 'Stop sending this email?',
    message: `What has gone stays gone. Nobody else gets “${broadcast.subject}”, and it cannot be started again.`,
    cancel: true,
    ok: { label: 'Stop sending', color: 'negative', noCaps: true },
  }).onOk(() => {
    void attempt(async () => {
      await cancelEmailToMembers(broadcast.broadcastId);
      await load();
    }, 'Stopped.');
  });
}

const going = (b: BroadcastSummary) => b.status === 'preparing' || b.status === 'sending';
const waiting = (b: BroadcastSummary) => b.status === 'awaiting_approval';
const waitingForMe = computed(() => (view.value?.canApprove ? (view.value.broadcasts.filter(waiting) ?? []) : []));
/** Delivery reports go on arriving for a while after the last copy went. */
const REPORTS_MS = 10 * 60_000;
const reporting = (b: BroadcastSummary) => !!b.completedAt && Date.now() - Date.parse(b.completedAt) < REPORTS_MS;
const when = (iso: string) => new Date(iso).toLocaleString();

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  await load();
  timer = setInterval(() => {
    if (view.value?.broadcasts.some((b) => going(b) || reporting(b) || waiting(b))) void load();
  }, 15_000);
});
// The page keeps this tab's draft while another tab is open, where a System Admin may switch email on or set the contact.
onActivated(load);
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">Email members</h2>
      <p class="q-mb-none">{{ RECIPIENT_RULE }}</p>
    </div>
    <q-banner v-if="waitingForMe.length" dense rounded class="bg-blue-1 text-black" role="status">
      {{ waitingForMe.length === 1 ? 'An email to members waits' : `${waitingForMe.length} emails to members wait` }} for a System Admin’s approval:
      see “Emails” below, where you can read it, then approve or reject it.
    </q-banner>
    <q-banner v-if="view?.blocked" dense rounded class="bg-orange-2 text-black" role="status">Nothing can be sent just now: {{ view.blocked }}.</q-banner>
    <p v-else-if="view?.approvalRequired" class="q-my-none text-grey-8">
      Each email waits for a System Admin’s approval before it goes out; they are notified when you send one.
    </p>

    <q-card flat bordered tag="section" aria-labelledby="send-who">
      <q-card-section>
        <h3 id="send-who" class="text-subtitle2 q-my-none">Who it goes to</h3>
      </q-card-section>
      <q-card-section class="ustp-form q-pt-none">
        <q-option-group
          v-model="kind"
          :options="[
            { value: 'all_active', label: 'All Active members' },
            { value: 'place', label: 'Active members in chosen states or countries' },
            { value: 'picked', label: 'Members I pick' },
          ]"
          aria-label="Who it goes to"
        />
        <template v-if="kind === 'place'">
          <q-select v-model="states" outlined dense multiple use-chips use-input input-debounce="0" emit-value map-options :options="stateOptions" label="US states" @filter="filterStates" />
          <q-select v-model="countries" outlined dense multiple use-chips use-input input-debounce="0" emit-value map-options :options="countryOptions" label="Countries" hint="The United States here means every state" @filter="filterCountries" />
        </template>
        <template v-if="kind === 'picked'">
          <MemberPicker v-model="choosing" :search="searchMembersToEmail" :unavailable="() => (picked.length >= MAX_BROADCAST_PICKED ? `at most ${MAX_BROADCAST_PICKED} by hand` : null)" action="Adds" />
          <div v-if="picked.length" class="q-gutter-xs">
            <q-chip v-for="m in picked" :key="m.accountId" dense removable :label="m.preferredName || m.legalName" @remove="unpick(m.accountId)" />
          </div>
        </template>
        <p v-if="audience && preview" class="q-my-none" role="status">{{ previewText(preview) }}</p>
      </q-card-section>
    </q-card>

    <q-card flat bordered tag="section" aria-labelledby="send-what">
      <q-card-section>
        <h3 id="send-what" class="text-subtitle2 q-my-none">The email</h3>
        <div class="text-caption text-grey-7">
          Plain text. A blank line starts a new paragraph. Each email greets the member by name, and ends with where to ask questions and their own unsubscribe link.
        </div>
      </q-card-section>
      <q-card-section class="ustp-form q-pt-none">
        <q-input v-model="subject" outlined dense label="Subject" :maxlength="MAX_BROADCAST_SUBJECT" counter />
        <q-input v-model="body" outlined type="textarea" autogrow label="Your message" :maxlength="MAX_BROADCAST_BODY" counter />
      </q-card-section>
      <q-expansion-item dense label="Preview (with a sample name)">
        <q-card-section>
          <div class="text-weight-medium">{{ message.subject }}</div>
          <pre class="ustp-send-preview">{{ message.text }}</pre>
        </q-card-section>
      </q-expansion-item>
    </q-card>

    <div class="ustp-actions">
      <q-btn
        color="primary"
        no-caps
        icon="send"
        :label="view?.approvalRequired ? 'Send for approval' : preview?.willGet ? `Send to ${preview.willGet}` : 'Send'"
        :disable="!ready"
        @click="send"
      />
      <span v-if="hint" class="text-caption">{{ hint }}</span>
      <span class="text-caption text-grey-7">To try it first, pick yourself under “Members I pick”, if you are an Active member who opted in.</span>
    </div>

    <template v-if="view?.broadcasts.length">
      <h3 class="text-subtitle2 q-mb-none">Emails</h3>
      <q-list separator bordered class="rounded-borders">
        <q-expansion-item v-for="b in view.broadcasts" :key="b.broadcastId" dense>
          <template #header>
            <q-item-section>
              <q-item-label>{{ b.subject }}</q-item-label>
              <q-item-label caption>{{ when(b.createdAt) }}<template v-if="b.createdByName">, by {{ b.createdByName }}</template>. {{ audienceText(b.audience) }}.</q-item-label>
              <q-item-label caption>{{ broadcastStatusText(b) }}</q-item-label>
              <q-item-label v-if="approvalText(b)" caption>{{ approvalText(b) }}</q-item-label>
              <q-item-label v-if="waiting(b) && b.willGetNow !== null" caption>It would go to {{ b.willGetNow }} {{ b.willGetNow === 1 ? 'member' : 'members' }} now. Open it to read it.</q-item-label>
            </q-item-section>
            <q-item-section v-if="going(b)" side>
              <q-btn flat no-caps color="negative" label="Stop sending" @click.stop="stop(b)" />
            </q-item-section>
            <q-item-section v-else-if="waiting(b)" side>
              <div class="ustp-actions">
                <q-btn v-if="view.canApprove" unelevated no-caps color="primary" label="Approve" @click.stop="approve(b)" />
                <q-btn v-if="view.canApprove" flat no-caps color="negative" label="Reject" @click.stop="reject(b)" />
                <q-btn v-if="b.mine || !view.canApprove" flat no-caps label="Withdraw" @click.stop="withdraw(b)" />
              </div>
            </q-item-section>
          </template>
          <q-card-section>
            <pre class="ustp-send-preview">{{ b.body }}</pre>
          </q-card-section>
        </q-expansion-item>
      </q-list>
    </template>
  </div>
</template>

<style scoped>
.ustp-send-preview {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  font-size: 0.875rem;
}
</style>
