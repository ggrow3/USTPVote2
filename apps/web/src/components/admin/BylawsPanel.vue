<script setup lang="ts">
import { useQuasar } from 'quasar';
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import {
  diffLines,
  publishBylawsSchema,
  splitLines,
  type BylawsCheckScope,
  type BylawsRecord,
  type BylawsVersionSummary,
} from 'ustp-domain';
import { focusElement, focusFirstInvalid } from '../../a11y.js';
import { api, errorMessage } from '../../api.js';
import { flaggedLines, findingsLabel, SEVERITY_LABELS, SOURCE_LABELS } from '../../bylaws-check-text.js';
import { useBylawsCheck } from '../../bylaws-check.js';
import { downloadBylawsDocx, importBylawsDocx } from '../../bylaws-files.js';
import { attempt } from '../../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../../forms.js';
import BylawsCheckSection from './BylawsCheckSection.vue';

/**
 * Bylaws for Membership Admins (design §5.2). Published versions are permanent, so changing the bylaws means drafting
 * the next version: from the current text, from a Word document, or blank; editing it line by line or as a whole; and
 * publishing it as an amendment of the version it started from. An advisory check by Claude can flag lines that may
 * contradict the US Constitution, Transhumanist principles or the USTP Constitution; it never blocks publishing.
 */
const $q = useQuasar();
const current = ref<BylawsRecord | null>(null);
const versions = ref<BylawsVersionSummary[]>([]);
const errors = ref<FieldErrors>({});
const draft = reactive({
  open: false,
  /** The version the draft amends (the current one when it was started), whose text the changes are shown against. */
  base: null as BylawsRecord | null,
  source: '',
  version: '',
  title: 'USTP Bylaws',
  changeNote: '',
  lines: [''] as string[],
});
const wholeText = ref(false);
const importFile = ref<File | null>(null);
const importing = ref(false);
const goTo = ref<number | null>(null);
const editor = reactive({ open: false, index: -1, text: '' });

const draftText = computed({
  get: () => draft.lines.join('\n'),
  set: (text: string) => {
    draft.lines = splitLines(text);
  },
});
const changes = computed(() => (draft.base ? diffLines(draft.base.text, draftText.value).filter((l) => l.kind !== 'same') : []));
const changedLines = computed(() => new Set(changes.value.filter((l) => l.kind === 'added').map((l) => l.after)));
/** The line being edited as it reads in the version the draft amends, if that version has such a line. */
const baseLine = computed(() => (draft.base ? splitLines(draft.base.text)[editor.index] : undefined));
const added = computed(() => changes.value.filter((l) => l.kind === 'added').length);
const removed = computed(() => changes.value.filter((l) => l.kind === 'removed').length);
const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;
const changeSummary = computed(() => `${lines(added.value)} added or changed, ${lines(removed.value)} removed`);

const checker = useBylawsCheck();
/** Draft line number → the numbers of the findings that name it. */
const flags = computed(() => flaggedLines(checker.state.check?.findings ?? [], checker.state.checkedLines, draft.lines));
/** What a screen reader hears before a flagged line: the findings, worded. */
function flagDescription(line: number): string {
  const findings = checker.state.check?.findings ?? [];
  return (flags.value.get(line) ?? [])
    .map((n) => `finding ${n}, ${SEVERITY_LABELS[findings[n - 1]!.severity].toLowerCase()} with the ${SOURCE_LABELS[findings[n - 1]!.source]}`)
    .join('; ');
}

function startCheck(scope: BylawsCheckScope) {
  checker.start({ title: draft.title.trim() || 'Bylaws', text: draftText.value, amends: draft.base?.version ?? null, scope });
}

/** From a finding: show the line in the line-by-line list and put focus on its edit button. */
async function goToLineInList(line: number) {
  wholeText.value = false;
  await nextTick();
  const button = document.querySelector<HTMLElement>(`[data-draft-line="${line}"]`);
  button?.closest('.draft-line')?.scrollIntoView({ block: 'center' });
  focusElement(button);
}

async function load() {
  current.value = await api<BylawsRecord>('GET', '/v1/bylaws/current').catch(() => null);
  versions.value = await api<BylawsVersionSummary[]>('GET', '/v1/bylaws').catch(() => []);
}

/** "2026.1" → "2026.2"; anything else gets ".1" appended. */
function nextVersion(version: string): string {
  const m = /^(.*?)(\d+)$/.exec(version);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${version}.1`;
}

function open(lines: string[], source: string, title?: string | null) {
  Object.assign(draft, {
    open: true,
    base: current.value,
    source,
    version: current.value ? nextVersion(current.value.version) : '',
    title: title ?? current.value?.title ?? 'USTP Bylaws',
    changeNote: '',
    lines: lines.length ? lines : [''],
  });
  errors.value = {};
  wholeText.value = false;
  checker.reset();
}

function discard() {
  draft.open = false;
  checker.reset();
}

function startFromCurrent() {
  if (current.value) open(splitLines(current.value.text), `version ${current.value.version}`);
}

async function startFromDocx(file: File | null) {
  if (!file) return;
  importing.value = true;
  try {
    const imported = await importBylawsDocx(file);
    open(splitLines(imported.text), file.name, current.value?.title ?? imported.title);
    $q.notify({
      type: 'positive',
      message: `Imported ${imported.lines} lines from ${file.name}${imported.numberedLines ? `, ${imported.numberedLines} of them with Word numbering written out` : ''}. Review the text before publishing.`,
    });
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    importing.value = false;
    importFile.value = null;
  }
}

function editLine(index: number) {
  if (index < 0 || index >= draft.lines.length) return;
  Object.assign(editor, { open: true, index, text: draft.lines[index] ?? '' });
}

function goToLine() {
  if (goTo.value) editLine(goTo.value - 1);
}

function saveLine() {
  // A pasted multi-line text becomes several lines.
  draft.lines.splice(editor.index, 1, ...splitLines(editor.text));
  editor.open = false;
}

function insertAfter() {
  draft.lines.splice(editor.index + 1, 0, '');
  editLine(editor.index + 1);
}

function deleteLine() {
  draft.lines.splice(editor.index, 1);
  if (draft.lines.length === 0) draft.lines.push('');
  editor.open = false;
}

async function publish() {
  const checked = validate(publishBylawsSchema, {
    version: draft.version.trim(),
    title: draft.title,
    text: draftText.value,
    amends: draft.base?.version ?? null,
    changeNote: draft.changeNote.trim() || undefined,
  });
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return;
  }
  if (draft.base && changes.value.length === 0) {
    errors.value = { _: `The text is identical to version ${draft.base.version}; change something before publishing.` };
    return;
  }
  const confirmed = await new Promise<boolean>((resolve) =>
    $q
      .dialog({
        title: `Publish version ${checked.data.version}?`,
        message: draft.base
          ? `It amends version ${draft.base.version}: ${changeSummary.value}. New applications must agree to it. Published versions are permanent and recorded in the audit ledger.`
          : 'This is the first version. New applications must agree to it. Published versions are permanent and recorded in the audit ledger.',
        cancel: true,
      })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false)),
  );
  if (!confirmed) return;
  errors.value = {};
  const ok = await attempt(async () => {
    try {
      await api('POST', '/v1/admin/bylaws', checked.data);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, `Version ${checked.data.version} published`);
  if (ok) {
    discard();
    await load();
  }
}

async function download(version: string) {
  try {
    await downloadBylawsDocx(await api<BylawsRecord>('GET', `/v1/bylaws/${encodeURIComponent(version)}`));
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

onMounted(load);
</script>

<template>
  <div class="column q-gutter-md" style="max-width: 900px">
    <q-card flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">Current bylaws</h2>
        <div v-if="current" class="text-grey-7" style="overflow-wrap: anywhere">
          {{ current.title }} · version {{ current.version }} · published
          {{ new Date(current.publishedAt).toLocaleDateString() }}<span v-if="current.amends"> · amends {{ current.amends }}</span> · SHA-256
          <code>{{ current.contentHash }}</code>
        </div>
        <div v-else class="text-grey-7">None published yet. Applications cannot be submitted until one is.</div>
      </q-card-section>
      <q-card-actions v-if="current">
        <q-btn flat no-caps color="primary" icon="download" label="Download stamped .docx" @click="download(current.version)" />
        <q-btn flat no-caps color="primary" icon="open_in_new" label="Public page" to="/bylaws" />
      </q-card-actions>
    </q-card>

    <q-card v-if="!draft.open" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">Publish a new version</h2>
        <div class="text-caption text-grey-7">
          Versions are permanent and recorded in the audit ledger. To change the bylaws, draft the next version, then
          publish it. New applications must agree to the newest version.
        </div>
      </q-card-section>
      <q-card-section class="row q-gutter-sm items-center">
        <q-btn v-if="current" color="primary" no-caps :label="`Start from version ${current.version}`" @click="startFromCurrent" />
        <q-file
          v-model="importFile"
          outlined
          dense
          accept=".docx"
          label="Import from Word (.docx)"
          style="min-width: 240px"
          :loading="importing"
          @update:model-value="startFromDocx"
        />
        <q-btn flat no-caps color="primary" label="Start blank" @click="open([''], 'a blank page')" />
      </q-card-section>
    </q-card>

    <q-card v-else flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">New version, started from {{ draft.source }}</h2>
        <div class="text-caption text-grey-7">
          <template v-if="draft.base">It will amend version {{ draft.base.version }}.</template>
          <template v-else>It will be the first version.</template>
          Nothing is saved until you publish.
        </div>
      </q-card-section>

      <q-card-section class="q-gutter-md q-pt-none">
        <div class="row q-col-gutter-md">
          <q-input
            v-model="draft.version"
            class="col-12 col-sm-4"
            outlined
            dense
            label="Version (e.g. 2026.2)"
            :error="!!errors.version"
            :error-message="errors.version"
          />
          <q-input v-model="draft.title" class="col-12 col-sm-8" outlined dense label="Title" :error="!!errors.title" :error-message="errors.title" />
        </div>
        <q-input
          v-model="draft.changeNote"
          outlined
          dense
          autogrow
          type="textarea"
          label="What changed and why (shown with the version)"
          :error="!!errors.changeNote"
          :error-message="errors.changeNote"
        />

        <div class="row items-center q-gutter-sm">
          <q-btn-toggle
            v-model="wholeText"
            no-caps
            toggle-color="primary"
            role="group"
            aria-label="Editing mode"
            :options="[
              { label: 'Line by line', value: false },
              { label: 'Whole text', value: true },
            ]"
          />
          <template v-if="!wholeText">
            <q-input
              v-model.number="goTo"
              dense
              outlined
              type="number"
              :min="1"
              :max="draft.lines.length"
              label="Line"
              style="width: 110px"
              @keyup.enter="goToLine"
            />
            <q-btn flat no-caps color="primary" label="Edit line" :disable="!goTo" @click="goToLine" />
          </template>
          <q-space />
          <span class="text-caption text-grey-7">{{ draft.lines.length }} lines</span>
        </div>

        <q-input
          v-if="wholeText"
          v-model="draftText"
          outlined
          type="textarea"
          rows="18"
          label="Full text"
          :error="!!errors.text"
          :error-message="errors.text"
        />
        <div v-else class="draft-lines" role="list" aria-label="Draft text, one entry per line">
          <div
            v-for="(line, i) in draft.lines"
            :key="i"
            role="listitem"
            class="draft-line"
            :class="{ 'draft-changed': changedLines.has(i + 1), 'draft-flagged': flags.has(i + 1) }"
          >
            <span v-if="flags.has(i + 1)" class="draft-bar text-deep-orange-10" aria-hidden="true" />
            <span class="draft-number" aria-hidden="true">{{ i + 1 }}</span>
            <span class="draft-text">
              <span v-if="flags.has(i + 1)" class="draft-flag text-deep-orange-10">
                <q-icon name="flag" size="16px" aria-hidden="true" />
                <span aria-hidden="true">{{ findingsLabel(flags.get(i + 1)!) }}</span>
                <span class="sr-only">Flagged by the check: {{ flagDescription(i + 1) }}.</span>
              </span>
              {{ line || ' ' }}
            </span>
            <q-btn
              flat
              round
              dense
              size="sm"
              icon="edit"
              :data-draft-line="i + 1"
              :aria-label="`Edit line ${i + 1}${flags.has(i + 1) ? ' (flagged)' : ''}`"
              @click="editLine(i)"
            />
          </div>
        </div>
        <div v-if="!wholeText && errors.text" class="text-negative text-caption">{{ errors.text }}</div>
      </q-card-section>

      <q-card-section v-if="draft.base" class="q-pt-none">
        <h3 class="text-subtitle2">Changes from version {{ draft.base.version }}</h3>
        <div v-if="changes.length === 0" class="text-grey-7">None yet.</div>
        <template v-else>
          <div class="text-caption text-grey-7 q-mb-xs">{{ changeSummary }}.</div>
          <div class="draft-changes">
            <div v-for="(l, i) in changes" :key="i" class="diff-line" :class="l.kind === 'added' ? 'diff-added' : 'diff-removed'">
              <span class="diff-mark">{{ l.kind === 'added' ? '+' : '−' }} {{ l.kind === 'added' ? l.after : l.before }}</span>
              <span class="sr-only">{{ l.kind === 'added' ? 'added' : 'removed' }}:</span>{{ l.text || ' ' }}
            </div>
          </div>
        </template>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <BylawsCheckSection
          :check="checker.state.check"
          :checked-lines="checker.state.checkedLines"
          :requesting="checker.state.requesting"
          :error="checker.state.error"
          :gave-up="checker.state.gaveUp"
          :draft-lines="draft.lines"
          :changes-since="draft.base && changes.length ? draft.base.version : null"
          @check="startCheck"
          @go-to-line="goToLineInList"
        />
      </q-card-section>

      <q-card-section v-if="errors._" class="q-pt-none">
        <q-banner class="bg-negative text-white" rounded>{{ errors._ }}</q-banner>
      </q-card-section>
      <q-card-actions>
        <q-btn color="primary" no-caps label="Publish" @click="publish" />
        <q-btn flat no-caps label="Discard draft" @click="discard" />
      </q-card-actions>
    </q-card>

    <q-card v-if="versions.length" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">All versions</h2>
        <q-list separator>
          <q-item v-for="v in versions" :key="v.version">
            <q-item-section>
              <q-item-label>Version {{ v.version }} · {{ v.title }}</q-item-label>
              <q-item-label caption>
                Published {{ new Date(v.publishedAt).toLocaleDateString() }}<span v-if="v.amends"> · amends {{ v.amends }}</span
                ><span v-if="v.changeNote"> · {{ v.changeNote }}</span>
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <div class="row q-gutter-xs">
                <q-btn flat dense no-caps color="primary" icon="download" :aria-label="`Download version ${v.version} as .docx`" @click="download(v.version)" />
                <q-btn flat dense no-caps color="primary" icon="open_in_new" :aria-label="`Open version ${v.version}`" :to="`/bylaws/${encodeURIComponent(v.version)}`" />
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>

    <q-dialog v-model="editor.open">
      <q-card style="min-width: min(640px, 92vw)">
        <q-card-section>
          <h2 class="text-subtitle1">Line {{ editor.index + 1 }}</h2>
          <div v-if="draft.base && baseLine !== undefined" class="text-caption text-grey-7">
            In version {{ draft.base.version }}: “{{ baseLine || ' ' }}”
          </div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input v-model="editor.text" outlined autogrow autofocus type="textarea" label="Text of this line" @keydown.ctrl.enter="saveLine" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps color="negative" label="Delete line" @click="deleteLine" />
          <q-btn flat no-caps color="primary" label="Insert line after" @click="insertAfter" />
          <q-space />
          <q-btn flat no-caps label="Cancel" @click="editor.open = false" />
          <q-btn color="primary" no-caps label="Save line" @click="saveLine" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.draft-lines {
  max-height: 460px;
  overflow-y: auto;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 4px;
}
.draft-line {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 1px 4px 1px 0;
}
/* A flagged line: a bar in the warning colour down its left edge and a worded label, never colour alone. */
.draft-bar {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: currentColor;
}
.draft-flag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 6px;
  font-weight: 500;
  white-space: nowrap;
}
.draft-line:nth-child(odd) {
  background: rgba(128, 128, 128, 0.06);
}
.draft-number {
  flex: 0 0 3.5em;
  text-align: right;
  opacity: 0.6;
  font-family: ui-monospace, monospace;
  padding-top: 4px;
}
.draft-text {
  flex: 1;
  white-space: pre-wrap;
  padding-top: 4px;
}
.draft-changed {
  background: rgba(46, 160, 67, 0.15) !important;
}
.draft-changes {
  max-height: 260px;
  overflow-y: auto;
}
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
