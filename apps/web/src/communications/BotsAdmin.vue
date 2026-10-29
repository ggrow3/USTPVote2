<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { BOT_LIMITS, BOT_SITES, BOT_STATUSES, botCheckDue, createBotSchema, updateBotSchema, type BotRecord, type BotSite, type BotStatus } from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { confirmAction } from './admin-forms.js';
import { addBot, botChecked, bots, FEEDS, removeBot, saveBot } from './api.js';
import { BOT_SITE_NAMES, BOT_STATUS_LABELS, longDate, siteIcon } from './comms-text.js';

/**
 * The party's bots (design §10.7): every automated account it runs, on any site, who looks after it, and when someone
 * last checked it. Those marked public are listed on the Press page. The news feeds are here too, for bots to post
 * each release. Every change is in the audit ledger; no bot's token or password belongs here.
 */
const $q = useQuasar();
const list = ref<BotRecord[] | null>(null);

interface Form {
  name: string;
  site: BotSite;
  handle: string;
  url: string;
  purpose: string;
  operator: string;
  runsOn: string;
  status: BotStatus;
  public: boolean;
  notes: string;
}
/** The editor: whether it is open, the bot it edits (null for a new one), and the form. */
const editing = ref(false);
const current = ref<BotRecord | null>(null);
const blank = (): Form => ({ name: '', site: 'bluesky', handle: '', url: '', purpose: '', operator: '', runsOn: '', status: 'active', public: true, notes: '' });
const form = ref<Form>(blank());
const errors = ref<FieldErrors>({});

const sites = BOT_SITES.map((value) => ({ value, label: BOT_SITE_NAMES[value] }));
const statuses = BOT_STATUSES.map((value) => ({ value, label: BOT_STATUS_LABELS[value] }));
const feeds = computed(() => [
  { label: 'RSS', url: `${location.origin}${FEEDS.rss}` },
  { label: 'JSON Feed', url: `${location.origin}${FEEDS.json}` },
]);

async function load() {
  await attempt(async () => {
    list.value = await bots();
  });
}

function startNew() {
  current.value = null;
  form.value = blank();
  editing.value = true;
  errors.value = {};
}

function open(b: BotRecord) {
  const { name, site, handle, url, purpose, operator, runsOn, status, notes } = b;
  current.value = b;
  form.value = { name, site, handle, url, purpose, operator, runsOn, status, public: b.public, notes };
  editing.value = true;
  errors.value = {};
}

async function save() {
  if (!editing.value) return;
  const bot = current.value;
  const checked = bot ? validate(updateBotSchema, { ...form.value, basedOn: bot.version }) : validate(createBotSchema, form.value);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  const ok = await attempt(async () => {
    try {
      if (bot) await saveBot(bot.botId, checked.data as Parameters<typeof saveBot>[1]);
      else await addBot(checked.data as Parameters<typeof addBot>[0]);
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

async function checked(b: BotRecord) {
  if (await attempt(() => botChecked(b.botId, b.version), `Marked ${b.name} checked`)) await load();
}

async function remove(b: BotRecord) {
  if (!(await confirmAction(`Remove ${b.name}?`, 'It leaves the registry and the Press page. Mark it retired instead to keep it on record.', 'Remove'))) return;
  if (await attempt(() => removeBot(b.botId), 'Removed')) {
    editing.value = false;
    await load();
  }
}

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    $q.notify({ type: 'positive', message: 'Copied' });
  } catch {
    $q.notify({ type: 'negative', message: 'Could not copy: select the address and copy it instead.' });
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <q-card flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">The news feeds, for bots</h2>
        <div class="text-caption text-grey-7">
          Each news post is in these feeds as soon as it is published. Point a bot or service at one (a Discord or
          Telegram RSS bot, IFTTT, Zapier) to post the news on a site automatically, without this app holding that site's
          keys. Then list the bot below.
        </div>
        <div v-for="f in feeds" :key="f.url" class="ustp-row q-mt-sm">
          <span class="text-weight-medium">{{ f.label }}</span>
          <code class="ustp-row__wide bots-feed">{{ f.url }}</code>
          <q-btn flat dense no-caps icon="content_copy" :label="`Copy`" :aria-label="`Copy the ${f.label} address`" @click="copy(f.url)" />
        </div>
      </q-card-section>
    </q-card>

    <p class="text-grey-7">
      Every automated account the party runs. Bots marked public are listed on the <router-link to="/press">Press page</router-link>,
      so people can tell them from impostors. Check each active one at least every 30 days. Never put a bot's token or
      password here: keep those with whoever runs it.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!editing" unelevated no-caps color="primary" icon="add" label="Add a bot" @click="startNew" />
    </div>

    <q-card v-if="editing" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">{{ current ? current.name : 'Add a bot' }}</h2>
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <div class="ustp-row">
            <q-input v-model="form.name" outlined dense label="Name" :maxlength="BOT_LIMITS.name" :error="!!errors.name" :error-message="errors.name" />
            <q-select v-model="form.site" outlined dense emit-value map-options :options="sites" label="Site" />
          </div>
          <div class="ustp-row">
            <q-input v-model="form.handle" outlined dense label="Name on the site" placeholder="@USTPNewsBot" :maxlength="BOT_LIMITS.handle" />
            <q-input v-model="form.url" outlined dense class="ustp-row__wide" label="Its profile (https://…)" :error="!!errors.url" :error-message="errors.url" />
          </div>
          <q-input
            v-model="form.purpose"
            outlined
            type="textarea"
            autogrow
            label="What it does"
            hint="Shown on the Press page when the bot is public."
            :maxlength="BOT_LIMITS.purpose"
            :error="!!errors.purpose"
            :error-message="errors.purpose"
          />
          <div class="ustp-row">
            <q-input v-model="form.operator" outlined dense label="Who looks after it" :maxlength="BOT_LIMITS.operator" />
            <q-input v-model="form.runsOn" outlined dense label="What it runs on" placeholder="IFTTT, the news feed" :maxlength="BOT_LIMITS.runsOn" />
          </div>
          <div class="ustp-row">
            <q-select v-model="form.status" outlined dense emit-value map-options :options="statuses" label="Status" />
            <q-toggle v-model="form.public" label="List it on the Press page" />
          </div>
          <q-input v-model="form.notes" outlined type="textarea" autogrow label="Notes for the team (never a token or password)" :maxlength="BOT_LIMITS.notes" />
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" label="Save" />
            <q-btn v-if="current" flat no-caps color="negative" label="Remove" @click="remove(current)" />
            <q-btn flat no-caps label="Close" @click="editing = false" />
          </div>
        </q-form>
      </q-card-section>
    </q-card>

    <div v-if="list && list.length === 0 && !editing" class="text-grey-7">No bots listed yet.</div>
    <q-list v-else-if="list" bordered separator class="rounded-borders">
      <q-item v-for="b in list" :key="b.botId">
        <q-item-section avatar><q-icon :name="siteIcon(b.site)" :aria-label="BOT_SITE_NAMES[b.site]" /></q-item-section>
        <q-item-section>
          <q-item-label>
            {{ b.name }}<template v-if="b.handle"> · {{ b.handle }}</template>
          </q-item-label>
          <q-item-label caption>{{ b.purpose }}</q-item-label>
          <q-item-label caption>
            {{ BOT_SITE_NAMES[b.site] }}<template v-if="b.operator"> · {{ b.operator }}</template> ·
            {{ b.checkedAt ? `checked ${longDate(b.checkedAt)}` : 'never checked' }}
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="ustp-actions">
            <q-badge v-if="botCheckDue(b, new Date())" color="orange-9" label="Check due" />
            <q-badge v-if="b.public" color="blue-8" label="Public" />
            <q-badge color="grey-7" :label="BOT_STATUS_LABELS[b.status]" />
            <q-btn v-if="b.status === 'active'" flat dense no-caps label="Checked" :aria-label="`Mark ${b.name} checked today`" @click="checked(b)" />
            <q-btn flat dense round icon="edit" :aria-label="`Edit ${b.name}`" @click="open(b)" />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<style scoped>
.bots-feed {
  overflow-wrap: anywhere;
}
</style>
