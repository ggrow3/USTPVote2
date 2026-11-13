<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  BILL_LIMITS,
  checkTags,
  congressLabel,
  lawLabel,
  tidyTags,
  type BillDetail,
  type BillNoteView,
  type BillRef,
  type BillText,
  type PublicBillTeamView,
} from 'ustp-domain';
import { announce, focusSoon, usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { attempt, dialog } from '../dialogs.js';
import { addBillNote, deleteBillNote, editBillNote, getBill, getBillText, unwatchBill, watchBill } from './api.js';
import { day, editedLine, latestActionLine, STATUS_COLORS, statusLabel, unwatchConfirmText } from './bill-text.js';
import PublicBillPanel from './PublicBillPanel.vue';

/**
 * One bill (design §5.14): its sponsor, status and latest action, its place on the team's watchlist with tags and
 * notes, and on the public Legislation page, its CRS summary, the text of each printed version, and every action, from
 * Congress.gov and GovInfo.
 */
const route = useRoute();
const ref_ = computed<BillRef>(() => ({ congress: Number(route.params.congress), type: String(route.params.type) as BillRef['type'], number: Number(route.params.number) }));
const bill = ref<BillDetail | null>(null);
const error = ref('');
const refused = ref(false);
usePageTitle(() => (bill.value ? `${bill.value.label}: ${bill.value.title}` : 'A bill'));

async function load() {
  error.value = '';
  try {
    bill.value = await getBill(ref_.value);
    tags.value = [...(bill.value.watch?.tags ?? [])];
    const first = bill.value.textVersions[0];
    if (first && !textVersion.value) textVersion.value = first.version;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) refused.value = true;
    error.value = errorMessage(e);
  }
}

/* Tags and the watchlist. */
const tags = ref<string[]>([]);
const tagError = ref('');
const savingTags = ref(false);
const tagsChanged = computed(() => JSON.stringify(tidyTags(tags.value)) !== JSON.stringify(bill.value?.watch?.tags ?? []));
async function saveWatch() {
  if (!bill.value) return;
  const tidy = tidyTags(tags.value);
  const checked = checkTags(tidy);
  if (!checked.ok) {
    tagError.value = checked.reason[0]!.toUpperCase() + checked.reason.slice(1) + '.';
    return;
  }
  tagError.value = '';
  savingTags.value = true;
  try {
    const adding = !bill.value.watch;
    const entry = await watchBill(bill.value.id, tidy, bill.value.watch?.version ?? null);
    bill.value = { ...bill.value, watch: entry };
    tags.value = [...entry.tags];
    announce(adding ? `${bill.value.label} is on the watchlist.` : 'Tags saved.');
  } catch (e) {
    tagError.value = errorMessage(e);
  } finally {
    savingTags.value = false;
  }
}

function unwatch() {
  const b = bill.value;
  if (!b?.watch) return;
  dialog({
    title: `Take ${b.label} off the watchlist?`,
    message: unwatchConfirmText(b.label, b.notes.length),
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Take it off', color: 'negative', noCaps: true },
  }).onOk(async () => {
    const ok = await attempt(() => unwatchBill(b.id));
    if (ok) {
      bill.value = { ...b, watch: null, notes: [] };
      tags.value = [];
      announce(`${b.label} is off the watchlist.`);
      await focusSoon('#bill-watch');
    }
  });
}

/* The public page. */
function publicChanged(view: PublicBillTeamView | null) {
  if (!bill.value) return;
  bill.value = { ...bill.value, public: view, watch: bill.value.watch && { ...bill.value.watch, public: view !== null } };
}

/* Notes. */
const newNote = ref('');
const noteError = ref('');
const addingNote = ref(false);
const editing = ref<string | null>(null);
const editText = ref('');
async function addNote() {
  if (!bill.value) return;
  const text = newNote.value.trim();
  if (!text) {
    noteError.value = 'Write the note first.';
    return;
  }
  noteError.value = '';
  addingNote.value = true;
  try {
    const note = await addBillNote(bill.value.id, text);
    bill.value = { ...bill.value, notes: [...bill.value.notes, note], watch: bill.value.watch && { ...bill.value.watch, notes: bill.value.watch.notes + 1 } };
    newNote.value = '';
    announce('Note added.');
  } catch (e) {
    noteError.value = errorMessage(e);
  } finally {
    addingNote.value = false;
  }
}
function startEdit(note: BillNoteView) {
  editing.value = note.noteId;
  editText.value = note.text;
  void focusSoon(`#note-edit-${note.noteId}`);
}
async function saveEdit(note: BillNoteView) {
  const ok = await attempt(async () => {
    const saved = await editBillNote(note.noteId, editText.value);
    if (bill.value) bill.value = { ...bill.value, notes: bill.value.notes.map((n) => (n.noteId === note.noteId ? saved : n)) };
  }, 'Note saved.');
  if (ok) editing.value = null;
}
function removeNote(note: BillNoteView) {
  dialog({ title: 'Delete this note?', message: 'It is deleted for everyone and cannot be brought back.', cancel: true, focus: 'cancel', ok: { label: 'Delete', color: 'negative', noCaps: true } }).onOk(
    async () => {
      const ok = await attempt(() => deleteBillNote(note.noteId), 'Note deleted.');
      if (ok && bill.value) {
        bill.value = {
          ...bill.value,
          notes: bill.value.notes.filter((n) => n.noteId !== note.noteId),
          watch: bill.value.watch && { ...bill.value.watch, notes: Math.max(0, bill.value.watch.notes - 1) },
        };
      }
    },
  );
}

/* Text. */
const textVersion = ref<string | null>(null);
const text = ref<BillText | null>(null);
const textError = ref('');
const textLoading = ref(false);
const shownVersion = computed(() => bill.value?.textVersions.find((v) => v.version === textVersion.value) ?? null);
async function loadText() {
  if (!bill.value || !textVersion.value) return;
  textLoading.value = true;
  textError.value = '';
  try {
    text.value = await getBillText(ref_.value, textVersion.value);
  } catch (e) {
    text.value = null;
    textError.value = errorMessage(e);
  } finally {
    textLoading.value = false;
  }
}
const textOpen = ref(false);
watch([textVersion, textOpen], () => {
  if (textOpen.value && textVersion.value && text.value?.version !== textVersion.value) void loadText();
});

/* Actions. */
const allActions = ref(false);
const actions = computed(() => (allActions.value ? (bill.value?.actions ?? []) : (bill.value?.actions ?? []).slice(0, 10)));
const sponsor = computed(() => bill.value?.sponsors[0] ?? null);
const olderSummaries = computed(() => bill.value?.summaries.slice(1) ?? []);

/* Load the bill, and again when the address names another (after every ref above exists). */
watch(
  ref_,
  () => {
    bill.value = null;
    text.value = null;
    textVersion.value = null;
    textOpen.value = false;
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div>
        <q-btn flat dense no-caps icon="arrow_back" label="Bills" to="/bills?tab=search" class="ustp-back" />
      </div>

      <q-banner v-if="refused" class="bg-blue-1 text-black" rounded>
        The Bills page is for the party's legislative team: the teams a System or Site Admin names under Admin › Bills, and
        System and Site Admins.
      </q-banner>
      <q-banner v-else-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!bill" class="text-grey-7">Loading the bill from Congress.gov…</div>

      <template v-else>
        <div class="ustp-header">
          <div>
            <h1 class="text-h5 q-mb-xs">{{ bill.label }}: {{ bill.title }}</h1>
            <div class="text-grey-7">{{ congressLabel(bill.congress) }}<template v-if="bill.chamber"> · {{ bill.chamber }}</template></div>
          </div>
          <q-chip square :color="STATUS_COLORS[bill.status]" text-color="white" :label="statusLabel(bill.status)" />
        </div>

        <dl class="bill-facts">
          <template v-if="sponsor">
            <dt>Sponsor</dt>
            <dd>{{ sponsor.fullName }}</dd>
          </template>
          <dt>Cosponsors</dt>
          <dd>{{ bill.cosponsors }}</dd>
          <template v-if="bill.introducedDate">
            <dt>Introduced</dt>
            <dd>{{ day(bill.introducedDate) }}</dd>
          </template>
          <template v-if="bill.policyArea">
            <dt>Policy area</dt>
            <dd>{{ bill.policyArea }}</dd>
          </template>
          <template v-if="bill.laws.length">
            <dt>Law</dt>
            <dd>{{ bill.laws.map(lawLabel).join(', ') }}</dd>
          </template>
          <dt>Latest action</dt>
          <dd>{{ latestActionLine(bill.latestAction) }}</dd>
        </dl>
        <div>
          <a :href="bill.url" target="_blank" rel="noopener noreferrer">{{ bill.label }} on congress.gov</a>
        </div>

        <!-- The watchlist -->
        <q-card id="bill-watch" flat bordered tag="section" tabindex="-1" aria-labelledby="bill-watch-heading">
          <q-card-section>
            <div class="ustp-header">
              <div>
                <h2 id="bill-watch-heading" class="text-subtitle1">The team's watchlist</h2>
                <div class="text-caption text-grey-7">
                  <template v-if="bill.watch">Added by {{ bill.watch.addedBy.name }} on {{ day(bill.watch.addedAt) }}. Everyone on the legislative team sees it, its tags and its notes.</template>
                  <template v-else>Not on the watchlist. Add it, with tags, for the whole legislative team.</template>
                </div>
              </div>
              <q-btn v-if="bill.watch" flat no-caps color="negative" label="Take off the watchlist" @click="unwatch" />
            </div>
          </q-card-section>
          <q-card-section>
            <form class="ustp-form" novalidate @submit.prevent="saveWatch">
              <q-select
                v-model="tags"
                outlined
                dense
                multiple
                use-chips
                use-input
                hide-dropdown-icon
                new-value-mode="add-unique"
                input-debounce="0"
                :max-values="BILL_LIMITS.tags"
                label="Tags"
                :hint="`Type a tag and press Enter: up to ${BILL_LIMITS.tags}, each up to ${BILL_LIMITS.tag} characters`"
                :error="!!tagError"
                :error-message="tagError"
              />
              <div class="ustp-actions">
                <q-btn v-if="!bill.watch" type="submit" color="primary" no-caps icon="bookmark_add" label="Add to the watchlist" :loading="savingTags" />
                <q-btn v-else type="submit" color="primary" no-caps label="Save tags" :disable="!tagsChanged" :loading="savingTags" />
              </div>
            </form>
          </q-card-section>
          <q-card-section v-if="bill.watch">
            <h3 class="text-subtitle2 q-mb-sm">Notes</h3>
            <p v-if="!bill.notes.length" class="text-grey-7">No notes yet.</p>
            <q-list v-else separator>
              <q-item v-for="note in bill.notes" :key="note.noteId" class="bill-note">
                <q-item-section>
                  <q-item-label caption>
                    {{ note.author.name }}, {{ day(note.createdAt) }}<template v-if="note.editedAt">, {{ editedLine(note.editedAt) }}</template>
                  </q-item-label>
                  <template v-if="editing === note.noteId">
                    <q-input :id="`note-edit-${note.noteId}`" v-model="editText" outlined dense autogrow type="textarea" :maxlength="BILL_LIMITS.note" label="Note" />
                    <div class="ustp-actions q-mt-sm">
                      <q-btn color="primary" no-caps label="Save" dense @click="saveEdit(note)" />
                      <q-btn flat no-caps label="Cancel" dense @click="editing = null" />
                    </div>
                  </template>
                  <div v-else class="bill-note__text">{{ note.text }}</div>
                </q-item-section>
                <q-item-section v-if="editing !== note.noteId && (note.mine || note.deletable)" side top>
                  <div class="row no-wrap">
                    <q-btn v-if="note.mine" flat round dense icon="edit" :aria-label="`Edit your note of ${day(note.createdAt)}`" @click="startEdit(note)" />
                    <q-btn v-if="note.deletable" flat round dense icon="delete" :aria-label="`Delete the note of ${day(note.createdAt)} by ${note.author.name}`" @click="removeNote(note)" />
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
            <form class="ustp-form q-mt-md" novalidate @submit.prevent="addNote">
              <q-input
                v-model="newNote"
                outlined
                dense
                autogrow
                type="textarea"
                :maxlength="BILL_LIMITS.note"
                counter
                label="Add a note for the team"
                :error="!!noteError"
                :error-message="noteError"
              />
              <q-btn type="submit" color="primary" no-caps label="Add the note" :loading="addingNote" />
            </form>
          </q-card-section>
        </q-card>

        <PublicBillPanel :bill="bill" @changed="publicChanged" />

        <!-- Summary -->
        <q-card v-if="bill.summaries.length" flat bordered tag="section" aria-labelledby="bill-summary-heading">
          <q-card-section>
            <h2 id="bill-summary-heading" class="text-subtitle1">Summary</h2>
            <div class="text-caption text-grey-7">
              By the Congressional Research Service: {{ bill.summaries[0]!.versionLabel }}, {{ day(bill.summaries[0]!.date) }}
            </div>
          </q-card-section>
          <q-card-section class="bill-summary">
            <p v-for="(para, i) in bill.summaries[0]!.paragraphs" :key="i">{{ para }}</p>
          </q-card-section>
          <q-expansion-item v-if="olderSummaries.length" dense :label="`Earlier summaries (${olderSummaries.length})`">
            <q-card-section v-for="s in olderSummaries" :key="s.date + s.versionLabel" class="bill-summary">
              <div class="text-caption text-grey-7">{{ s.versionLabel }}, {{ day(s.date) }}</div>
              <p v-for="(para, i) in s.paragraphs" :key="i">{{ para }}</p>
            </q-card-section>
          </q-expansion-item>
        </q-card>

        <!-- Text -->
        <q-card flat bordered tag="section" aria-labelledby="bill-text-heading">
          <q-card-section>
            <h2 id="bill-text-heading" class="text-subtitle1">Text</h2>
            <div v-if="!bill.textVersions.length" class="text-grey-7">No text has been printed yet.</div>
          </q-card-section>
          <q-card-section v-if="bill.textVersions.length">
            <div class="ustp-row">
              <q-select
                v-model="textVersion"
                outlined
                dense
                emit-value
                map-options
                :options="bill.textVersions.map((v) => ({ label: v.date ? `${v.label}, ${day(v.date)}` : v.label, value: v.version }))"
                label="Version"
              />
              <q-btn :color="textOpen ? undefined : 'primary'" :outline="textOpen" no-caps :label="textOpen ? 'Hide the text' : 'Read the text'" @click="textOpen = !textOpen" />
            </div>
            <div v-if="shownVersion" class="bill-links text-caption">
              <a v-if="shownVersion.pdfUrl" :href="shownVersion.pdfUrl" target="_blank" rel="noopener noreferrer">PDF</a>
              <a v-if="shownVersion.xmlUrl" :href="shownVersion.xmlUrl" target="_blank" rel="noopener noreferrer">XML</a>
              <a v-if="shownVersion.htmlUrl" :href="shownVersion.htmlUrl" target="_blank" rel="noopener noreferrer">On congress.gov</a>
            </div>
          </q-card-section>
          <q-card-section v-if="textOpen">
            <div v-if="textLoading" class="text-grey-7">Loading the text…</div>
            <q-banner v-else-if="textError" class="bg-orange-1 text-black" rounded>{{ textError }}</q-banner>
            <template v-else-if="text">
              <q-banner v-if="text.truncated" class="bg-orange-1 text-black q-mb-sm" rounded>
                This text is longer than {{ BILL_LIMITS.text.toLocaleString('en-US') }} characters and is cut there.
                <a :href="text.pdfUrl" target="_blank" rel="noopener noreferrer">Read all of it as a PDF</a>.
              </q-banner>
              <pre class="bill-text" tabindex="0" :aria-label="`${bill.label}, ${text.label}`">{{ text.text }}</pre>
            </template>
          </q-card-section>
        </q-card>

        <!-- Actions -->
        <q-card flat bordered tag="section" aria-labelledby="bill-actions-heading">
          <q-card-section>
            <h2 id="bill-actions-heading" class="text-subtitle1">Actions</h2>
            <div class="text-caption text-grey-7">Newest first, as Congress.gov lists them.</div>
          </q-card-section>
          <q-card-section>
            <p v-if="!bill.actions.length" class="text-grey-7">No actions recorded yet.</p>
            <ol v-else class="bill-actions">
              <li v-for="(a, i) in actions" :key="i">
                <span class="bill-actions__date">{{ day(a.date) }}</span>
                <span>{{ a.text }}<span v-if="a.source" class="text-grey-7 q-ml-xs">({{ a.source }})</span></span>
              </li>
            </ol>
            <q-btn v-if="bill.actions.length > 10" flat no-caps :label="allActions ? 'Show fewer' : `Show all ${bill.actions.length}`" @click="allActions = !allActions" />
          </q-card-section>
        </q-card>

        <p class="text-caption text-grey-7">
          Data retrieved from <a href="https://www.congress.gov/" target="_blank" rel="noopener noreferrer">Congress.gov</a> and
          <a href="https://www.govinfo.gov/" target="_blank" rel="noopener noreferrer">GovInfo</a>.
        </p>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.bill-facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
}
.bill-facts dt {
  font-weight: 600;
}
.bill-facts dd {
  margin: 0;
}
@media (max-width: 599.98px) {
  .bill-facts {
    grid-template-columns: 1fr;
  }
  .bill-facts dd {
    margin-bottom: 8px;
  }
}
.bill-summary p {
  margin: 0 0 8px;
}
.bill-links {
  display: flex;
  gap: 16px;
  margin-top: 8px;
}
.bill-text {
  max-height: 70vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.875rem;
  line-height: 1.5;
  background: var(--q-grey-1, #fafafa);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  padding: 12px;
  margin: 0;
}
.body--dark .bill-text {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.16);
}
.bill-actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bill-actions li {
  display: grid;
  grid-template-columns: 7.5em 1fr;
  gap: 12px;
}
.bill-actions__date {
  white-space: nowrap;
  font-weight: 600;
}
@media (max-width: 599.98px) {
  .bill-actions li {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
.bill-note__text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
