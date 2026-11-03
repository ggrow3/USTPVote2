<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  DEFAULT_NOTICE_SETTINGS,
  DEFAULT_NOTICE_TEXT,
  MAX_NOTICE_CONTACT,
  MAX_NOTICE_INTRO,
  MAX_NOTICE_SUBJECT,
  MAX_REMINDER_HOURS,
  MIN_REMINDER_HOURS,
  NOTICE_KINDS,
  OTHER_EMAILS,
  noticeMessage,
  noticeSettingsChanges,
  noticeSettingsSchema,
  reminderTime,
  type NoticeKind,
  type NoticeSettings,
  type NoticeSettingsRecord,
  type OtherEmail,
} from 'ustp-domain';
import { attempt } from '../dialogs.js';
import { validate } from '../forms.js';
import { noticeSettings, saveNoticeSettings } from './api.js';
import { leadTimeText, NOTICE_TITLES } from './notice-text.js';

/**
 * The site's email settings (design §6.8), for System Admins: whether each election email goes, how long before the
 * close the reminder goes, where the emails tell members to ask, each email's subject and opening, and whether the
 * site's other emails (welcome and test emails) go. The election's details fill themselves in; the From address stays
 * in the deployment's configuration.
 */
type Draft = {
  kinds: Record<NoticeKind, { enabled: boolean; subject: string; intro: string }>;
  emails: Record<OtherEmail, boolean>;
  reminderHours: number | string;
  contact: string;
};

const toDraft = (s: NoticeSettings): Draft => ({
  kinds: Object.fromEntries(
    NOTICE_KINDS.map((k) => [k, { enabled: s.kinds[k].enabled, subject: s.kinds[k].subject ?? '', intro: s.kinds[k].intro ?? '' }]),
  ) as Draft['kinds'],
  emails: { ...s.emails },
  reminderHours: s.reminderHours,
  contact: s.contact ?? '',
});
/** Empty text means the built-in wording, or no contact of the app's own. */
const fromDraft = (d: Draft): NoticeSettings => ({
  kinds: Object.fromEntries(
    NOTICE_KINDS.map((k) => [k, { enabled: d.kinds[k].enabled, subject: d.kinds[k].subject.trim() || null, intro: d.kinds[k].intro.trim() || null }]),
  ) as NoticeSettings['kinds'],
  emails: { ...d.emails },
  reminderHours: Number(d.reminderHours),
  contact: d.contact.trim() || null,
});

const saved = ref<NoticeSettingsRecord | null>(null);
const draft = ref<Draft | null>(null);
const settings = computed(() => draft.value && fromDraft(draft.value));
const checked = computed(() =>
  saved.value && settings.value ? validate(noticeSettingsSchema, { basedOn: saved.value.version, ...settings.value }) : null,
);
const errors = computed<Record<string, string>>(() => (checked.value && !checked.value.ok ? checked.value.errors : {}));
const changes = computed(() => (saved.value && settings.value ? noticeSettingsChanges(saved.value, settings.value) : []));
const isDefault = computed(() => !!settings.value && noticeSettingsChanges(DEFAULT_NOTICE_SETTINGS, settings.value).length === 0);
const savedAt = computed(() => (saved.value?.updatedAt ? new Date(saved.value.updatedAt).toLocaleString() : null));
const hours = computed(() => {
  const n = Number(draft.value?.reminderHours);
  return Number.isInteger(n) && n >= MIN_REMINDER_HOURS && n <= MAX_REMINDER_HOURS ? n : null;
});

async function load() {
  await attempt(async () => {
    saved.value = await noticeSettings();
    draft.value = toDraft(saved.value);
  });
}

async function save() {
  if (!saved.value || !checked.value?.ok) return;
  const input = checked.value.data;
  await attempt(async () => {
    saved.value = await saveNoticeSettings(input);
    draft.value = toDraft(saved.value);
  }, 'Saved. The worker follows it within a minute.');
}

function restoreDefaults() {
  draft.value = toDraft(DEFAULT_NOTICE_SETTINGS);
}

/** An election three days from closing, to show the wording with its details filled in. */
const SAMPLE = (() => {
  const now = Date.now();
  return {
    electionId: 'sample',
    title: 'Sample election',
    description: '',
    opensAt: new Date(now - 86_400_000).toISOString(),
    closesAt: new Date(now + 3 * 86_400_000).toISOString(),
  };
})();
const previews = computed(() =>
  settings.value
    ? NOTICE_KINDS.map((kind) => {
        const text = settings.value!.kinds[kind];
        // Wording the checks refuse is shown as the built-in one until it is fixed.
        const usable = !Object.keys(errors.value).some((path) => path.startsWith(`kinds.${kind}.`));
        return {
          kind,
          text: noticeMessage(kind, {
            election: SAMPLE,
            origin: window.location.origin,
            name: 'Alex Example',
            contact: errors.value.contact ? null : settings.value!.contact,
            now: kind === 'closing_soon' ? reminderTime(SAMPLE, hours.value ?? 24) : new Date(),
            text: usable ? text : null,
          }).text,
        };
      })
    : [],
);

const field = (kind: NoticeKind, name: 'subject' | 'intro') => `kinds.${kind}.${name}`;

/** What each of the other emails is, and what happens instead while it is off. */
const OTHER_EMAIL_TEXT: Readonly<Record<OtherEmail, { label: string; caption: string }>> = {
  welcome: {
    label: 'Welcome emails',
    caption:
      'To members a Membership Admin adds, with a link to set a password. Off: the admin’s browser has Identity Platform send its own sign-in link instead.',
  },
  electionTests: {
    label: 'Election Admins’ test emails',
    caption: '“Send test email” on an election’s email card, to the admin’s own address. Off: the button is refused.',
  },
  memberTests: {
    label: 'Members’ test emails',
    caption:
      '“Send me a test email” and “Try my address again” on a member’s Account page. Off: members are told it is switched off for now.',
  },
};

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">Email settings</h2>
      <div class="text-caption text-grey-7">
        <template v-if="saved?.version">Version {{ saved.version }}, saved {{ savedAt }}.</template>
        <template v-else-if="saved">The defaults: nobody has changed these settings yet.</template>
      </div>
    </div>
    <p>
      The worker emails everyone on an election's roll when voting opens and, before it closes, reminds those who have
      not voted. They are official election notices, sent whatever members' newsletter and announcement choices. Here
      you choose whether each goes, when the reminder goes, where members ask questions, and each email's subject and
      opening. The rest of each email (the ballot link, the times in every zone, how to check a vote) fills itself in.
      Below them, the site's welcome and test emails can each be switched off. The From address is set with the
      deployment, since Amazon SES has to verify it. Every change is recorded in the audit ledger.
    </p>
    <p class="text-caption">
      In a subject or opening, <code>{title}</code> is the election's title, <code>{closes}</code> when voting closes
      (Eastern Time), and <code>{time_left}</code> how long is left, such as “about 23 hours”. Leave a box empty for the
      built-in wording.
    </p>

    <template v-if="draft">
      <q-card v-for="kind in NOTICE_KINDS" :key="kind" flat bordered tag="section" :aria-labelledby="`settings-${kind}`">
        <q-card-section>
          <h3 :id="`settings-${kind}`" class="text-subtitle2 q-my-none">{{ NOTICE_TITLES[kind] }}</h3>
        </q-card-section>
        <q-card-section class="ustp-form">
          <q-toggle v-model="draft.kinds[kind].enabled" :label="kind === 'closing_soon' ? 'Send the reminder' : 'Send this email'" />
          <q-input
            v-if="kind === 'closing_soon'"
            v-model="draft.reminderHours"
            outlined
            dense
            type="number"
            :min="MIN_REMINDER_HOURS"
            :max="MAX_REMINDER_HOURS"
            label="Hours before voting closes"
            :hint="hours ? `${leadTimeText(hours)} before the close; elections open no longer than that get no reminder` : undefined"
            :error="!!errors.reminderHours"
            :error-message="errors.reminderHours ? `Between ${MIN_REMINDER_HOURS} and ${MAX_REMINDER_HOURS} whole hours` : undefined"
          />
          <q-input
            v-model="draft.kinds[kind].subject"
            outlined
            dense
            label="Subject"
            :maxlength="MAX_NOTICE_SUBJECT"
            counter
            :placeholder="DEFAULT_NOTICE_TEXT[kind].subject"
            :hint="`Empty: ${DEFAULT_NOTICE_TEXT[kind].subject}`"
            :error="!!errors[field(kind, 'subject')]"
            :error-message="errors[field(kind, 'subject')]"
          />
          <q-input
            v-model="draft.kinds[kind].intro"
            outlined
            type="textarea"
            autogrow
            label="Opening paragraph, after the greeting"
            :maxlength="MAX_NOTICE_INTRO"
            counter
            :placeholder="DEFAULT_NOTICE_TEXT[kind].intro"
            :hint="`Empty: ${DEFAULT_NOTICE_TEXT[kind].intro}`"
            :error="!!errors[field(kind, 'intro')]"
            :error-message="errors[field(kind, 'intro')]"
          />
        </q-card-section>
      </q-card>

      <q-card flat bordered tag="section" aria-labelledby="settings-contact">
        <q-card-section>
          <h3 id="settings-contact" class="text-subtitle2 q-my-none">Questions about an election</h3>
          <div class="text-caption text-grey-7">
            The emails come from an address that takes no replies, so they tell members where to write instead. Empty:
            the deployment's own (<code>NOTICE_CONTACT</code>), if it has one; with neither, nothing is mailed.
          </div>
        </q-card-section>
        <q-card-section class="ustp-form">
          <q-input
            v-model="draft!.contact"
            outlined
            dense
            label="Contact for election questions"
            :maxlength="MAX_NOTICE_CONTACT"
            hint="An email address, or a page starting with https://"
            :error="!!errors.contact"
            :error-message="errors.contact"
          />
        </q-card-section>
      </q-card>

      <q-card flat bordered tag="section" aria-labelledby="settings-other">
        <q-card-section>
          <h3 id="settings-other" class="text-subtitle2 q-my-none">Other emails</h3>
          <div class="text-caption text-grey-7">
            Switching one off stops new ones; one already queued still goes. The email setup check’s test messages to
            Amazon’s simulator always go.
          </div>
        </q-card-section>
        <q-card-section class="ustp-form">
          <div v-for="key in OTHER_EMAILS" :key="key">
            <q-toggle v-model="draft!.emails[key]" :label="OTHER_EMAIL_TEXT[key].label" />
            <div class="text-caption text-grey-7 q-pl-xl">{{ OTHER_EMAIL_TEXT[key].caption }}</div>
          </div>
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-expansion-item
          v-for="p in previews"
          :key="p.kind"
          dense
          :label="`Preview: ${NOTICE_TITLES[p.kind]} (a sample election and name)`"
        >
          <q-card-section>
            <pre class="ustp-notice-preview">{{ p.text }}</pre>
          </q-card-section>
        </q-expansion-item>
      </q-card>

      <div class="ustp-actions">
        <q-btn color="primary" no-caps label="Save" :disable="changes.length === 0 || !checked?.ok" @click="save" />
        <q-btn flat no-caps label="Restore the defaults" :disable="isDefault" @click="restoreDefaults" />
        <span v-if="changes.length" class="text-caption">{{ changes.length === 1 ? '1 change' : `${changes.length} changes` }} not saved</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ustp-notice-preview {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  font-size: 0.875rem;
}
</style>
