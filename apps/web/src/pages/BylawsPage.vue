<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { diffLines, type BylawsRecord, type BylawsVersionSummary } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import { downloadBylawsDocx, matchCopy } from '../bylaws-files.js';

/** Public bylaws: any published version, its hash and history, a stamped Word copy, and a check for copies (design §5.2). */
const $q = useQuasar();
const route = useRoute();
const versions = ref<BylawsVersionSummary[]>([]);
const shown = ref<BylawsRecord | null>(null);
const previous = ref<BylawsRecord | null>(null);
const error = ref<string | null>(null);
const showChanges = ref(false);
const checking = ref(false);
const copyFile = ref<File | null>(null);
const copyResult = ref<{ version: BylawsVersionSummary | null; hash: string } | null>(null);

usePageTitle(() => (shown.value ? `${shown.value.title} ${shown.value.version}` : 'Bylaws'));

const isCurrent = computed(() => !!shown.value && versions.value[0]?.version === shown.value.version);
const changes = computed(() =>
  shown.value && previous.value ? diffLines(previous.value.text, shown.value.text).filter((l) => l.kind !== 'same') : [],
);

watch(
  () => route.params.version,
  async (param) => {
    error.value = null;
    previous.value = null;
    showChanges.value = false;
    try {
      versions.value = await api<BylawsVersionSummary[]>('GET', '/v1/bylaws');
      const version = typeof param === 'string' && param ? param : 'current';
      shown.value = await api<BylawsRecord>('GET', `/v1/bylaws/${encodeURIComponent(version)}`);
      if (shown.value.amends) previous.value = await api<BylawsRecord>('GET', `/v1/bylaws/${encodeURIComponent(shown.value.amends)}`);
    } catch (e) {
      shown.value = null;
      error.value = errorMessage(e);
    }
  },
  { immediate: true },
);

async function download() {
  if (!shown.value) return;
  try {
    await downloadBylawsDocx(shown.value);
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

async function check(file: File | null) {
  copyResult.value = null;
  if (!file) return;
  checking.value = true;
  try {
    copyResult.value = await matchCopy(file, versions.value);
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <q-page padding>
    <div style="max-width: 860px">
      <q-banner v-if="error" class="bg-orange-1 text-black q-mb-md" rounded>{{ error }}</q-banner>

      <template v-if="shown">
        <h1 class="text-h5 q-mb-xs">{{ shown.title }}</h1>
        <div class="text-grey-7 q-mb-sm">
          Version {{ shown.version }}
          <q-badge v-if="isCurrent" color="positive" label="current" class="q-ml-xs" />
          · published {{ new Date(shown.publishedAt).toLocaleDateString() }}
          <span v-if="shown.amends">
            · amends <router-link :to="`/bylaws/${encodeURIComponent(shown.amends)}`">version {{ shown.amends }}</router-link>
          </span>
        </div>
        <div v-if="shown.changeNote" class="q-mb-sm">Change: {{ shown.changeNote }}</div>
        <div class="text-caption q-mb-md" style="overflow-wrap: anywhere">
          SHA-256 of the text: <code>{{ shown.contentHash }}</code>
        </div>
        <div class="row q-gutter-sm q-mb-md">
          <q-btn color="primary" icon="download" label="Download stamped .docx" no-caps @click="download" />
          <q-btn
            v-if="previous"
            flat
            no-caps
            color="primary"
            :label="showChanges ? 'Hide changes' : `Changes from version ${previous.version}`"
            :aria-expanded="showChanges"
            @click="showChanges = !showChanges"
          />
        </div>

        <q-card v-if="showChanges" flat bordered class="q-mb-md">
          <q-card-section>
            <h2 class="text-subtitle1">Changes from version {{ previous?.version }}</h2>
            <div v-if="changes.length === 0" class="text-grey-7">The text is identical.</div>
            <div
              v-for="(l, i) in changes"
              :key="i"
              class="diff-line"
              :class="l.kind === 'added' ? 'diff-added' : 'diff-removed'"
            >
              <span class="diff-mark">{{ l.kind === 'added' ? '+' : '−' }} {{ l.kind === 'added' ? l.after : l.before }}</span>
              <span class="sr-only">{{ l.kind === 'added' ? 'added' : 'removed' }}:</span>{{ l.text || ' ' }}
            </div>
          </q-card-section>
        </q-card>

        <q-card flat bordered class="q-mb-md">
          <!-- A focusable region, so the text can be scrolled with the keyboard too (WCAG 2.1.1). -->
          <div class="q-pa-md" style="white-space: pre-wrap" tabindex="0" role="region" :aria-label="`${shown.title}, version ${shown.version}`">
            {{ shown.text }}
          </div>
        </q-card>
      </template>

      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <h2 class="text-subtitle1">Check a copy</h2>
          <div class="text-grey-7 q-mb-sm">
            Choose a Word copy you were given. Its text is compared, by SHA-256, with every published version; nothing is
            uploaded.
          </div>
          <q-file
            v-model="copyFile"
            outlined
            dense
            accept=".docx"
            label="Word document (.docx)"
            :loading="checking"
            @update:model-value="check"
          />
          <q-banner
            v-if="copyResult"
            rounded
            class="q-mt-sm"
            :class="copyResult.version ? 'bg-green-1 text-black' : 'bg-orange-1 text-black'"
            role="status"
          >
            <template v-if="copyResult.version">
              This copy's text matches
              <router-link :to="`/bylaws/${encodeURIComponent(copyResult.version.version)}`">version {{ copyResult.version.version }}</router-link>
              exactly.
            </template>
            <template v-else>
              This copy's text does not match any published version (SHA-256 <code>{{ copyResult.hash.slice(0, 16) }}…</code>). It
              may have been edited.
            </template>
          </q-banner>
        </q-card-section>
      </q-card>

      <q-card v-if="versions.length" flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1">All versions</h2>
          <q-list separator>
            <q-item v-for="v in versions" :key="v.version" :to="`/bylaws/${encodeURIComponent(v.version)}`">
              <q-item-section>
                <q-item-label>Version {{ v.version }} · {{ v.title }}</q-item-label>
                <q-item-label caption>
                  Published {{ new Date(v.publishedAt).toLocaleDateString() }}<span v-if="v.amends"> · amends {{ v.amends }}</span
                  ><span v-if="v.changeNote"> · {{ v.changeNote }}</span>
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<style scoped>
.diff-line {
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  padding: 2px 6px;
}
.diff-mark {
  display: inline-block;
  min-width: 4.5em;
  opacity: 0.75;
}
.diff-added {
  background: rgba(46, 160, 67, 0.15);
}
.diff-removed {
  background: rgba(248, 81, 73, 0.15);
  text-decoration: line-through;
}
</style>
