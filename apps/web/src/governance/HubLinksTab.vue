<script setup lang="ts">
import { computed, ref } from 'vue';
import { HUB_LIMITS, linkProblem, linkTarget, newHubId, type Hub, type HubClickCount, type HubLink, type HubRecord, type HubSection } from 'ustp-domain';
import { focusSoon } from '../a11y.js';
import { dialog } from '../dialogs.js';
import { hubIcon } from './hub-icons.js';
import { clicksText } from './hub-text.js';
import HubLinkDialog from './HubLinkDialog.vue';

/**
 * The hub's sections and links (design §10.6) as dense rows: show or hide, move, edit and delete each, with its clicks
 * (the last 30 days, then in all). Each change is saved at once.
 */
const props = defineProps<{ saved: HubRecord; clicks: readonly HubClickCount[]; busy: boolean }>();
const emit = defineEmits<{ commit: [next: Hub, done?: () => void] }>();

const counts = computed(() => new Map(props.clicks.map((c) => [c.target, c])));
const countOf = (l: HubLink) => counts.value.get(linkTarget(l.id));
const n = (value: number | undefined) => (value ?? 0).toLocaleString('en-US');
const linkName = (l: HubLink) => l.title || 'the untitled link';
const sectionName = (s: HubSection) => s.title || 'the untitled section';

/** The hub with new sections, everything else as saved. */
function save(sections: HubSection[], done?: () => void) {
  emit('commit', { profile: props.saved.profile, discord: props.saved.discord, sections }, done);
}
const copy = () => props.saved.sections.map((s) => ({ ...s, links: [...s.links] }));

function swap<T>(items: T[], i: number, j: number) {
  [items[i], items[j]] = [items[j]!, items[i]!];
}

// --- Sections ----------------------------------------------------------------------------------------------------

function showSection(i: number, shown: boolean) {
  const sections = copy();
  sections[i] = { ...sections[i]!, shown };
  save(sections);
}

/** After a move, the same button again, or its twin once the item reaches the end it was moving to. */
const nextButton = (by: -1 | 1, at: number, count: number) => (by < 0 ? (at === 0 ? 'down' : 'up') : at === count - 1 ? 'up' : 'down');

/** Moves a section, keeping focus on the button that moved it. */
function moveSection(i: number, by: -1 | 1) {
  const sections = copy();
  const id = sections[i]!.id;
  swap(sections, i, i + by);
  save(sections, () => focusSoon(`#hub-section-${id}-${nextButton(by, i + by, sections.length)}`));
}

function askTitle(title: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    dialog({
      title,
      prompt: {
        model: value,
        type: 'text',
        label: 'Title',
        isValid: (v: string) => v.trim().length > 0 && v.trim().length <= HUB_LIMITS.sectionTitle,
      },
      cancel: true,
      persistent: true,
    })
      .onOk((v: string) => resolve(v.trim()))
      .onCancel(() => resolve(null));
  });
}

async function renameSection(i: number) {
  const section = props.saved.sections[i]!;
  const title = await askTitle(`Rename ${sectionName(section)}`, section.title);
  if (title === null) return;
  const sections = copy();
  sections[i] = { ...sections[i]!, title };
  save(sections, () => focusSoon(`#hub-section-${section.id}-edit`));
}

async function addSection() {
  const title = await askTitle('Add a section', '');
  if (title === null) return;
  const id = newHubId();
  save([...copy(), { id, title, shown: true, links: [] }], () => focusSoon(`#hub-section-${id}-add`));
}

function deleteSection(i: number) {
  const section = props.saved.sections[i]!;
  const n = section.links.length;
  dialog({
    title: `Delete ${sectionName(section)}?`,
    message: n
      ? `Its ${n === 1 ? 'link goes' : `${n} links go`} with it. Click counts are kept, under Analytics.`
      : 'It has no links.',
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Delete the section', color: 'negative', noCaps: true },
  }).onOk(() => save(copy().filter((s) => s.id !== section.id), () => focusSoon('#hub-add-section')));
}

// --- Links -------------------------------------------------------------------------------------------------------

function showLink(si: number, li: number, shown: boolean) {
  const sections = copy();
  sections[si]!.links[li] = { ...sections[si]!.links[li]!, shown };
  save(sections);
}

function moveLink(si: number, li: number, by: -1 | 1) {
  const sections = copy();
  const links = sections[si]!.links;
  const id = links[li]!.id;
  swap(links, li, li + by);
  save(sections, () => focusSoon(`#hub-link-${id}-${nextButton(by, li + by, links.length)}`));
}

function deleteLink(si: number, li: number) {
  const section = props.saved.sections[si]!;
  const l = section.links[li]!;
  dialog({
    title: `Delete ${linkName(l)}?`,
    message: 'Its click count is kept, under Analytics.',
    cancel: true,
    focus: 'cancel',
    ok: { label: 'Delete the link', color: 'negative', noCaps: true },
  }).onOk(() => {
    const sections = copy();
    sections[si]!.links.splice(li, 1);
    save(sections, () => focusSoon(`#hub-section-${section.id}-add`));
  });
}

/** The link being edited or added, and the button to return focus to when the dialog closes. */
const editing = ref<{ link: HubLink | null; section: string; from: string } | null>(null);

function openEditor(link: HubLink | null, section: string, from: string) {
  editing.value = { link, section, from };
}

/** Closed without saving: back to the button that opened it (Quasar would refocus its inner helper after a click). */
function closeEditor() {
  const from = editing.value?.from;
  editing.value = null;
  if (from) focusSoon(from);
}

/** Puts the edited link in its section, at its place there or, when added or moved, at the end. */
function saveLink({ section, link }: { section: string; link: HubLink }) {
  const from = editing.value?.from;
  const sections = copy();
  const old = sections.flatMap((s) => s.links.map((l, i) => ({ s, i, l }))).find((x) => x.l.id === link.id);
  if (old && old.s.id === section) old.s.links[old.i] = link;
  else {
    if (old) old.s.links.splice(old.i, 1);
    sections.find((s) => s.id === section)?.links.push(link);
  }
  save(sections, () => {
    editing.value = null;
    focusSoon(old ? `#hub-link-${link.id}-edit` : (from ?? '#hub-add-link'));
  });
}
</script>

<template>
  <div class="ha">
    <div class="ha__actions">
      <q-btn
        id="hub-add-link"
        unelevated
        no-caps
        color="primary"
        icon="add"
        label="Add link"
        :disable="busy || !saved.sections.length"
        @click="openEditor(null, saved.sections[0]!.id, '#hub-add-link')"
      />
      <q-btn id="hub-add-section" outline no-caps icon="add" label="Add section" :disable="busy" @click="addSection" />
      <span v-if="!saved.sections.length" class="ha__note">Add a section first: links go in sections.</span>
    </div>

    <section v-for="(s, si) in saved.sections" :key="s.id" class="ha-section" :aria-labelledby="`hub-section-${s.id}-title`">
      <div class="ha-section__head">
        <h3 :id="`hub-section-${s.id}-title`" class="ha-section__title" :class="{ 'ha--off': !s.shown }">
          {{ s.title || 'Untitled section' }}<span v-if="!s.shown" class="sr-only"> (hidden)</span>
        </h3>
        <div class="ha-tools">
          <q-toggle
            :model-value="s.shown"
            :disable="busy"
            :aria-label="`Show the section ${sectionName(s)}`"
            @update:model-value="showSection(si, $event)"
          />
          <q-btn
            :id="`hub-section-${s.id}-up`"
            flat
            round
            dense
            icon="arrow_upward"
            :aria-label="`Move ${sectionName(s)} up`"
            :disable="busy || si === 0"
            @click="moveSection(si, -1)"
          />
          <q-btn
            :id="`hub-section-${s.id}-down`"
            flat
            round
            dense
            icon="arrow_downward"
            :aria-label="`Move ${sectionName(s)} down`"
            :disable="busy || si === saved.sections.length - 1"
            @click="moveSection(si, 1)"
          />
          <q-btn
            :id="`hub-section-${s.id}-edit`"
            flat
            round
            dense
            icon="edit"
            :aria-label="`Rename ${sectionName(s)}`"
            :disable="busy"
            @click="renameSection(si)"
          />
          <q-btn flat round dense icon="delete" :aria-label="`Delete ${sectionName(s)}`" :disable="busy" @click="deleteSection(si)" />
          <q-btn
            :id="`hub-section-${s.id}-add`"
            outline
            no-caps
            dense
            icon="add"
            :disable="busy || s.links.length >= HUB_LIMITS.linksPerSection"
            class="ha-section__add"
            @click="openEditor(null, s.id, `#hub-section-${s.id}-add`)"
          >
            <span aria-hidden="true">Link</span><span class="sr-only">Add a link to {{ sectionName(s) }}</span>
          </q-btn>
        </div>
      </div>

      <ul v-if="s.links.length" class="ha-rows">
        <li v-for="(l, li) in s.links" :key="l.id" class="ha-row">
          <span class="ha-tile" :class="{ 'ha--off': !l.shown }" aria-hidden="true"><q-icon :name="hubIcon(l.icon)" size="20px" /></span>
          <div class="ha-row__text" :class="{ 'ha--off': !l.shown }">
            <div class="ha-row__title">
              <span>{{ l.title || 'Untitled link' }}</span>
              <q-icon v-if="l.featured" name="star" size="16px" class="ha-star" aria-hidden="true" />
              <span v-if="l.featured" class="sr-only">, starred</span>
              <span v-if="l.iconRow" class="ha-badge">icon row</span>
              <span v-if="!l.shown" class="sr-only">, hidden</span>
            </div>
            <div class="ha-row__url">
              <template v-if="l.url">{{ l.url }}</template>
              <template v-else>Draft: {{ linkProblem(l) }}</template>
            </div>
          </div>
          <span class="ha-count" :title="clicksText(countOf(l))">
            <span aria-hidden="true"><span class="ha-count__recent">{{ n(countOf(l)?.recent) }}</span> / {{ n(countOf(l)?.total) }}</span>
            <span class="sr-only">Clicks: {{ clicksText(countOf(l)) }}</span>
          </span>
          <div class="ha-tools">
            <q-toggle
              :model-value="l.shown"
              :disable="busy || (!l.shown && !!linkProblem(l))"
              :aria-label="`Show ${linkName(l)} on the hub`"
              @update:model-value="showLink(si, li, $event)"
            />
            <q-btn
              :id="`hub-link-${l.id}-up`"
              flat
              round
              dense
              icon="arrow_upward"
              :aria-label="`Move ${linkName(l)} up`"
              :disable="busy || li === 0"
              @click="moveLink(si, li, -1)"
            />
            <q-btn
              :id="`hub-link-${l.id}-down`"
              flat
              round
              dense
              icon="arrow_downward"
              :aria-label="`Move ${linkName(l)} down`"
              :disable="busy || li === s.links.length - 1"
              @click="moveLink(si, li, 1)"
            />
            <q-btn
              :id="`hub-link-${l.id}-edit`"
              flat
              round
              dense
              icon="edit"
              :aria-label="`Edit ${linkName(l)}`"
              :disable="busy"
              @click="openEditor(l, s.id, `#hub-link-${l.id}-edit`)"
            />
            <q-btn flat round dense icon="delete" :aria-label="`Delete ${linkName(l)}`" :disable="busy" @click="deleteLink(si, li)" />
          </div>
        </li>
      </ul>
      <p v-else class="ha__empty">No links yet.</p>
    </section>

    <HubLinkDialog
      v-if="editing"
      :link="editing.link"
      :section="editing.section"
      :sections="saved.sections"
      :busy="busy"
      @save="saveLink"
      @close="closeEditor"
    />
  </div>
</template>

<style scoped>
.ha {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.ha__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ha__note,
.ha__empty {
  margin: 0;
  color: var(--ha-muted);
}
.ha__empty {
  padding: 12px 16px;
}
.ha-section {
  overflow: hidden;
  border: 1px solid var(--ha-line);
  border-radius: var(--signal-radius);
  background: var(--ha-card);
}
.ha-section__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--ha-line);
}
.ha-section__title {
  margin: 0;
  font-family: var(--signal-display);
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.ha-section__add {
  margin-left: 4px;
  padding-inline: 8px;
  border-radius: 10px;
}
.ha-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}
.ha-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
/* Tile, words, clicks, controls on one line; on phones the clicks and controls go under the words. */
.ha-row {
  display: grid;
  grid-template-areas: 'tile text count tools';
  grid-template-columns: 40px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 4px 12px;
  padding: 8px 12px 8px 16px;
  background: var(--ha-row);
}
.ha-row + .ha-row {
  border-top: 1px solid var(--ha-line);
}
@media (max-width: 719.98px) {
  .ha-row {
    grid-template-areas:
      'tile text text'
      'count count tools';
    grid-template-columns: 40px minmax(0, 1fr) auto;
  }
}
.ha-tile {
  display: grid;
  grid-area: tile;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--ha-tile);
}
.ha-row__text {
  grid-area: text;
  min-width: 0;
}
.ha-row__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  font-family: var(--signal-display);
  font-size: 1rem;
  font-weight: 650;
}
.ha-row__url {
  overflow: hidden;
  color: var(--ha-muted);
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ha-star {
  color: var(--ha-letters);
}
/* Outlined on the row's own colour: the accent on a tinted fill would fall under 4.5:1 in the light theme. */
.ha-badge {
  padding: 0 6px;
  border: 1px solid var(--ha-line);
  border-radius: 6px;
  color: var(--ha-letters);
  font-family: var(--signal-mono);
  font-size: 0.75rem;
  font-weight: 500;
}
.ha-count {
  grid-area: count;
  font-family: var(--signal-mono);
  font-size: 0.875rem;
  white-space: nowrap;
}
.ha-count__recent {
  color: var(--ha-letters);
}
.ha-row > .ha-tools {
  grid-area: tools;
  justify-self: end;
}
/* Hidden things are dimmed where their words keep 4.5:1 (the dark theme; HubPanel sets --ha-off), and their icon always. */
.ha--off {
  opacity: var(--ha-off, 1);
}
.ha-tile.ha--off {
  opacity: 0.5;
}
</style>
