<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  checkHomeQuote,
  DEFAULT_HOME_QUOTE,
  HOME_QUOTE_LIMITS,
  homeQuoteChanges,
  resolveHomeQuote,
  type HomeQuote,
  type HomeQuoteRecord,
} from 'ustp-domain';
import HomeBackdrop from '../components/HomeBackdrop.vue';
import { attempt } from '../dialogs.js';
import { homeQuoteSettings, saveHomeQuote } from './api.js';
import HomeQuoteFigure from './HomeQuoteFigure.vue';
import { applyHomeQuote } from './home-quote.js';
import { describeQuoteChange } from './home-quote-text.js';

/** The home page quote (design §10.5): System Admins change its words, who said them and the source, or switch it off. */

type Draft = { -readonly [K in keyof HomeQuote]: HomeQuote[K] };

const copy = ({ shown, text, attribution, source }: HomeQuote): Draft => ({ shown, text, attribution, source });

const saved = ref<HomeQuoteRecord | null>(null);
const draft = ref<Draft | null>(null);
/** What the draft amounts to: on one line, without quotation marks around the words or a dash before the name. */
const resolved = computed(() => draft.value && resolveHomeQuote(draft.value));
const changes = computed(() => (saved.value && resolved.value ? homeQuoteChanges(saved.value, resolved.value) : []));
const refused = computed(() => !!resolved.value && !checkHomeQuote(resolved.value).ok);
const isDefault = computed(() => !!resolved.value && homeQuoteChanges(DEFAULT_HOME_QUOTE, resolved.value).length === 0);

/** Why a field cannot be saved as it is, if it cannot. */
function fieldError(part: 'text' | 'attribution' | 'source'): string | undefined {
  const quote = resolved.value;
  if (!quote) return undefined;
  if (quote[part].length > HOME_QUOTE_LIMITS[part]) return `Over ${HOME_QUOTE_LIMITS[part]} characters`;
  if (part !== 'source' && quote.shown && !quote[part]) return 'Needed while the quote is shown';
  return undefined;
}

async function load() {
  await attempt(async () => {
    saved.value = await homeQuoteSettings();
    draft.value = copy(saved.value);
  });
}

async function save() {
  if (!saved.value || !resolved.value) return;
  const quote = resolved.value;
  await attempt(async () => {
    saved.value = await saveHomeQuote({ basedOn: saved.value!.version, ...quote });
    draft.value = copy(saved.value);
    applyHomeQuote(saved.value);
  }, 'Saved. The home page shows it as each person next opens the app.');
}

function restoreDefault() {
  draft.value = copy(DEFAULT_HOME_QUOTE);
}

const savedAt = computed(() => (saved.value?.updatedAt ? new Date(saved.value.updatedAt).toLocaleString() : null));

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">The home page quote</h2>
      <div class="text-caption text-grey-7">
        <template v-if="saved?.version">Version {{ saved.version }}, saved {{ savedAt }}.</template>
        <template v-else-if="saved">The default: nobody has changed it yet.</template>
      </div>
    </div>
    <p>
      A line about voting, set large beside the sign-in card on the home page, with who said it and where. Many popular
      voting quotes are misattributed, so check the words against the original before saving, and name the source so
      readers can check it too. The default is Franklin D. Roosevelt's, from the published text of his address at
      Marietta, Ohio.
    </p>

    <q-card v-if="draft && resolved" flat bordered>
      <q-card-section class="ustp-form">
        <q-toggle v-model="draft.shown" label="Show a quote on the home page" />
        <q-input
          v-model="draft.text"
          type="textarea"
          autogrow
          outlined
          dense
          counter
          label="Quote"
          :hint="`The words only, up to ${HOME_QUOTE_LIMITS.text} characters: the page adds quotation marks.`"
          :error="!!fieldError('text')"
          :error-message="fieldError('text')"
        />
        <q-input
          v-model="draft.attribution"
          outlined
          dense
          counter
          label="Who said it"
          :hint="`As the source names them, up to ${HOME_QUOTE_LIMITS.attribution} characters.`"
          :error="!!fieldError('attribution')"
          :error-message="fieldError('attribution')"
        />
        <q-input
          v-model="draft.source"
          outlined
          dense
          counter
          label="Source (optional)"
          :hint="`Where and when, so readers can check it: a speech or book, its place and date. Up to ${HOME_QUOTE_LIMITS.source} characters.`"
          :error="!!fieldError('source')"
          :error-message="fieldError('source')"
        />
      </q-card-section>

      <q-card-section>
        <h3 class="text-subtitle2 q-mb-sm">Preview</h3>
        <div class="quote-preview">
          <HomeBackdrop class="quote-preview__backdrop" />
          <div class="quote-preview__lead ustp-scrim">
            <HomeQuoteFigure v-if="resolved.shown && resolved.text" :quote="resolved" compact />
            <p v-else class="q-mb-none">
              No quote: visitors see the party's name and what this site is for in its place, and people signed in
              see only their cards.
            </p>
          </div>
        </div>
      </q-card-section>

      <q-card-section v-if="changes.length">
        <h3 class="text-subtitle2">Not saved yet: {{ changes.length === 1 ? '1 change' : `${changes.length} changes` }}</h3>
        <ul class="q-mt-sm q-mb-none">
          <li v-for="c in changes" :key="c.part">{{ describeQuoteChange(c) }}</li>
        </ul>
      </q-card-section>
      <q-card-section class="ustp-actions">
        <q-btn color="primary" label="Save changes" :disable="!changes.length || refused" @click="save" />
        <q-btn flat color="primary" label="Discard changes" :disable="!changes.length" @click="load" />
        <q-btn flat color="primary" label="Restore the default" :disable="isDefault" @click="restoreDefault" />
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
/* The home page's picture and panel, small: the quote as visitors will see it, in the current theme. */
.quote-preview {
  position: relative;
  overflow: hidden;
  padding: 24px 16px;
  border-radius: 8px;
}
.quote-preview__backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.quote-preview__lead {
  position: relative;
  max-width: 560px;
}
</style>
