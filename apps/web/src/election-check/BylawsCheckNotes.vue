<script setup lang="ts">
import { computed } from 'vue';
import type { PublicElectionCheck } from 'ustp-domain';
import { SEVERITY_ICONS } from '../bylaws-check-text.js';
import { NOTE_SEVERITY_LABELS, noteSource, notesFor, quotedLine, TOPIC_LABELS } from './election-check-text.js';

/**
 * Side notes from the election setup check (design §6.9) beside one contest, or the election as a whole: what the
 * bylaws say and how the setup may differ. Shown to every user on the ballot and the results, and in the editor. A
 * named region of its own, after the contest's rules, so a screen reader meets it in reading order.
 */
const props = defineProps<{
  check: Pick<PublicElectionCheck, 'findings' | 'quotedLines' | 'checker'> | null;
  /** The contest the notes are about, or null for the election as a whole. */
  contestId: string | null;
  /** What the notes are about, for the region's name: the contest's title, or "this election". */
  subject: string;
}>();

const notes = computed(() => notesFor(props.check, props.contestId));
</script>

<template>
  <aside v-if="check && notes.length" class="bylaws-notes" :aria-label="`Bylaws check notes on ${subject}`">
    <div class="bylaws-notes__source text-caption text-grey-7">
      <q-icon name="gavel" size="16px" aria-hidden="true" />
      <span>{{ noteSource(check) }}</span>
    </div>
    <ul class="bylaws-notes__list">
      <li v-for="(n, i) in notes" :key="i" class="bylaws-note">
        <div class="text-weight-medium">
          <span class="text-deep-orange-10"><q-icon :name="SEVERITY_ICONS[n.severity]" size="16px" aria-hidden="true" /> {{ NOTE_SEVERITY_LABELS[n.severity] }}</span>
          <span class="text-grey-7"> · {{ TOPIC_LABELS[n.topic] }}</span>
        </div>
        <div>{{ n.explanation }}</div>
        <template v-for="line in n.bylawsLines" :key="line">
          <blockquote v-if="quotedLine(check, line)" class="bylaws-quote text-caption">
            <span class="text-grey-7">Bylaws, line {{ line }}:</span> “{{ quotedLine(check, line) }}”
          </blockquote>
        </template>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.bylaws-notes {
  border-left: 3px solid rgba(128, 128, 128, 0.6);
  background: rgba(128, 128, 128, 0.08);
  border-radius: 0 4px 4px 0;
  padding: 8px 12px;
  margin: 8px 0 0;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
/* Between a page's cards, the column's own gap is the space around it. */
:is(.ustp-content, .ustp-stack) > .bylaws-notes {
  margin: 0;
}
.bylaws-notes__source {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.bylaws-notes__source > .q-icon {
  margin-top: 1px;
  flex: none;
}
.bylaws-notes__list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}
.bylaws-note + .bylaws-note {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.35);
}
.bylaws-quote {
  margin: 4px 0;
  padding-left: 8px;
  border-left: 2px solid rgba(128, 128, 128, 0.45);
}
</style>

<style>
/* On the notes' tint the light theme's caption grey (#757575) falls to 4.2:1; one step darker keeps it above 4.5. */
.body--light .bylaws-notes .text-grey-7 {
  color: #616161 !important;
}
</style>
