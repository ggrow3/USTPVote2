<script setup lang="ts">
import { computed } from 'vue';
import type { ResultsSynopsis } from 'ustp-domain';
import {
  ballotsText,
  chooseNText,
  count,
  irvText,
  outcomeLabel,
  quorumText,
  share,
  synopsisFacts,
  tallyText,
  yesShareText,
  type Tone,
} from './synopsis-text.js';

/**
 * A synopsis of published results (design §9), as the party publishes its own: the window, roll, ballots and turnout,
 * one entry per contest with its counts, shares and outcome, then the closing tally. It prints as a document of its
 * own (`app.css`, "Printing"), so the party can publish it as it is.
 */
const props = defineProps<{
  synopsis: ResultsSynopsis;
  resultsHash: string;
  /** This results page's address, printed under the synopsis. */
  resultsUrl: string;
}>();
const emit = defineEmits<{ fullResults: [] }>();

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
const facts = computed(() => synopsisFacts(props.synopsis, when));
const tally = computed(() => tallyText(props.synopsis.tally));

const TONE_ICON: Record<Tone, string> = { passed: 'check', failed: 'close', neutral: 'remove' };

/** The browser's print dialog; `app.css` prints the page's content without the menu or the controls. */
const print = () => window.print();
</script>

<template>
  <q-card flat bordered class="synopsis">
    <q-card-section>
      <div class="ustp-header">
        <div>
          <h2 id="synopsis-heading" class="text-h6">Synopsis</h2>
          <div class="text-caption text-grey-7">
            How each contest came out, in brief. The full results have every count, round and tie-break.
          </div>
        </div>
        <q-btn outline no-caps color="primary" icon="print" label="Print" class="ustp-no-print" @click="print">
          <span class="sr-only"> the synopsis</span>
        </q-btn>
      </div>
    </q-card-section>
    <q-card-section>
      <dl class="ustp-facts">
        <template v-for="f in facts" :key="f.label">
          <dt>{{ f.label }}</dt>
          <dd :class="{ 'text-weight-bold': f.label === 'Status' }">{{ f.value }}</dd>
        </template>
      </dl>
    </q-card-section>

    <template v-for="c in synopsis.contests" :key="c.contestId">
      <q-separator />
      <q-card-section class="synopsis-contest">
        <div class="ustp-header">
          <h3 :id="`synopsis-${c.contestId}`" class="text-subtitle1">{{ c.number }}. {{ c.title }}</h3>
          <span class="synopsis-pill" :class="`synopsis-pill--${outcomeLabel(c).tone}`">
            <q-icon :name="TONE_ICON[outcomeLabel(c).tone]" size="16px" aria-hidden="true" />{{ outcomeLabel(c).text }}
          </span>
        </div>

        <template v-if="c.kind === 'proposal'">
          <q-markup-table flat dense separator="horizontal" class="synopsis-table">
            <caption class="sr-only">Votes on {{ c.title }}: {{ ballotsText(c) }}</caption>
            <thead>
              <tr>
                <th scope="col" class="text-left">Choice</th>
                <th scope="col" class="text-right">Votes</th>
                <th scope="col" class="text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[choice, s] in [['Yes', c.yes], ['No', c.no], ['Abstain', c.abstain]] as const" :key="choice">
                <th scope="row" class="text-left">{{ choice }}</th>
                <td class="text-right">{{ count(s.part) }}</td>
                <td class="text-right">{{ share(s) }}</td>
              </tr>
            </tbody>
          </q-markup-table>
          <div>{{ yesShareText(c) }}</div>
          <div class="text-caption text-grey-7">{{ [`${ballotsText(c)}.`, quorumText(c)].filter(Boolean).join(' ') }}</div>
        </template>

        <template v-else-if="c.kind === 'choose_n'">
          <q-markup-table flat dense separator="horizontal" class="synopsis-table">
            <caption class="sr-only">Votes in {{ c.title }}: {{ ballotsText(c) }}</caption>
            <thead>
              <tr>
                <th scope="col" class="text-left">Candidate</th>
                <th scope="col" class="text-right">Votes</th>
                <th scope="col" class="text-right">Share</th>
                <th scope="col" class="text-left">Result</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in c.candidates" :key="k.candidateId">
                <th scope="row" class="text-left">{{ k.name }}</th>
                <td class="text-right">{{ count(k.votes.part) }}</td>
                <td class="text-right">{{ share(k.votes) }}</td>
                <td :class="{ 'text-weight-bold': k.elected }">{{ k.elected ? 'Elected' : 'Not elected' }}</td>
              </tr>
              <tr v-if="c.blank.part">
                <th scope="row" class="text-left">Blank (no choice)</th>
                <td class="text-right">{{ count(c.blank.part) }}</td>
                <td class="text-right">{{ share(c.blank) }}</td>
                <td></td>
              </tr>
            </tbody>
          </q-markup-table>
          <div class="text-caption text-grey-7">{{ chooseNText(c) }}</div>
        </template>

        <template v-else>
          <div>{{ irvText(c) }}</div>
          <div class="text-caption text-grey-7">
            {{ ballotsText(c) }}.
            <template v-if="c.rounds > 1">
              <a href="#results-tab-full" class="ustp-no-print" @click.prevent="emit('fullResults')">Every round</a>
              <span class="ustp-no-print"> is in the full results.</span>
            </template>
          </div>
        </template>
      </q-card-section>
    </template>

    <q-separator />
    <q-card-section class="synopsis-contest">
      <h3 class="text-subtitle1">Altogether</h3>
      <p v-for="line in tally" :key="line" class="q-mb-none">{{ line }}</p>
      <div class="text-caption text-grey-7 q-mt-sm">
        A summary of the signed results (hash <code>{{ resultsHash }}</code>), which are the record and can be checked at
        <a :href="resultsUrl">{{ resultsUrl }}</a>.
      </div>
    </q-card-section>
  </q-card>
</template>

<style scoped>
/* Outcome pills: the outcome in words, with a tick, cross or dash as decoration; docs/ACCESSIBILITY.md has the figures. */
.synopsis-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px 2px 6px;
  border-radius: 999px;
  background: var(--tone-bg);
  color: var(--tone);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}
.synopsis-pill--passed {
  --tone: #2e7d32;
  --tone-bg: #e8f5e9;
}
.synopsis-pill--failed {
  --tone: #c62828;
  --tone-bg: #ffebee;
}
.synopsis-pill--neutral {
  --tone: #616161;
  --tone-bg: #eeeeee;
}
.synopsis.q-card--dark .synopsis-pill--passed {
  --tone: #81c784;
  --tone-bg: #1e3320;
}
.synopsis.q-card--dark .synopsis-pill--failed {
  --tone: #ef9a9a;
  --tone-bg: #3d1e1e;
}
.synopsis.q-card--dark .synopsis-pill--neutral {
  --tone: #bdbdbd;
  --tone-bg: #2e2e2e;
}

.synopsis-contest {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* As wide as its content up to the card's width; a row's name reads as text, not as a column header. */
.synopsis-table {
  align-self: flex-start;
  max-width: 100%;
}
.synopsis-table tbody th {
  font-size: inherit;
  font-weight: 400;
}
/*
 * Names and results wrap (Quasar keeps cells on one line), and the first column starts on the headings' edge rather
 * than 16px in, so four columns fit a 320px screen.
 */
.synopsis-table tbody th,
.synopsis-table td:last-child {
  white-space: normal;
}
.synopsis-table :is(th, td):first-child {
  padding-left: 0;
}
/* Quasar's horizontal separator rules only the data cells. */
.synopsis-table tbody tr:not(:last-child) > th {
  border-style: solid;
  border-width: 0 0 1px;
}

@media print {
  .synopsis {
    border: 0;
  }
  .synopsis-contest {
    break-inside: avoid;
  }
  /* Black on white whatever the theme; the words carry the outcome. */
  .synopsis-pill {
    border: 1px solid currentColor;
    background: transparent;
    color: #000;
  }
}
</style>
