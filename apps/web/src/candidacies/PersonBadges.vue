<script setup lang="ts">
import type { PersonMarks } from 'ustp-domain';
import { MARK_TEXT } from './candidacy-text.js';

/**
 * What a person on the Candidates and Your area pages is to the member (design §5.8), wherever they show: one of the
 * Transhumanist Party's candidates, in the party's colour; one of the member's representatives; or, for someone who
 * holds the seat but is not known to represent them (a ZIP code someone typed), an incumbent.
 */
defineProps<{ marks: PersonMarks; incumbent?: boolean }>();
</script>

<template>
  <span v-if="marks.party || marks.representative || incumbent" class="person-badges">
    <q-badge v-if="marks.party" color="primary" class="person-badges__badge">
      {{ MARK_TEXT.party.label }}
      <q-tooltip>{{ MARK_TEXT.party.meaning }}</q-tooltip>
    </q-badge>
    <q-badge v-if="marks.representative" color="indigo-8" class="person-badges__badge">
      {{ MARK_TEXT.representative.label }}
      <q-tooltip>{{ MARK_TEXT.representative.meaning }}</q-tooltip>
    </q-badge>
    <q-badge v-else-if="incumbent" outline color="primary" class="person-badges__badge">Incumbent</q-badge>
  </span>
</template>

<style scoped>
.person-badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: 6px;
  vertical-align: 2px;
}
.person-badges__badge {
  font-size: 12px;
  font-weight: 500;
}
</style>
