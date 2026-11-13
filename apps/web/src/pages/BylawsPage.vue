<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { diffLines, type BylawsRecord, type BylawsVersionSummary } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { api, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';

/**
 * Public bylaws: any published version, its hash, what changed from the one before, and the history (design §5.2). A
 * version with blank text is how the bylaws were cleared: from it on, none are in force.
 */
const route = useRoute();
const versions = ref<BylawsVersionSummary[]>([]);
const shown = ref<BylawsRecord | null>(null);
const previous = ref<BylawsRecord | null>(null);
const error = ref<string | null>(null);
const showChanges = ref(false);

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

</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>

      <template v-if="shown">
        <div>
          <h1 class="text-h5 q-mb-xs">{{ shown.title }}</h1>
          <div class="text-grey-7">
            Version {{ shown.version }}
            <q-badge v-if="isCurrent" color="positive" label="current" class="q-ml-xs" />
            · published {{ new Date(shown.publishedAt).toLocaleDateString() }}
            <span v-if="shown.amends">
              · amends <router-link :to="`/bylaws/${encodeURIComponent(shown.amends)}`">version {{ shown.amends }}</router-link>
            </span>
          </div>
          <div v-if="shown.changeNote" class="q-mt-sm">Change: {{ shown.changeNote }}</div>
          <div class="text-caption q-mt-sm" style="overflow-wrap: anywhere">
            SHA-256 of the text: <code>{{ shown.contentHash }}</code>
          </div>
        </div>
        <div v-if="previous" class="ustp-actions">
          <q-btn
            flat
            no-caps
            color="primary"
            :label="showChanges ? 'Hide changes' : `Changes from version ${previous.version}`"
            :aria-expanded="showChanges"
            @click="showChanges = !showChanges"
          />
        </div>

        <q-card v-if="showChanges" flat bordered>
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

        <q-card flat bordered>
          <!-- A focusable region, so the text can be scrolled with the keyboard too (WCAG 2.1.1). -->
          <div
            v-if="shown.text.trim()"
            class="q-pa-md"
            style="white-space: pre-wrap"
            tabindex="0"
            role="region"
            :aria-label="`${shown.title}, version ${shown.version}`"
          >
            {{ shown.text }}
          </div>
          <div v-else class="q-pa-md text-grey-7">
            This version is blank: it cleared the bylaws, so from it on none are in force and applicants agree to none.
          </div>
        </q-card>
      </template>

      <q-card v-if="versions.length" flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1">All versions</h2>
        </q-card-section>
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
      </q-card>
    </div>
  </PageShell>
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
