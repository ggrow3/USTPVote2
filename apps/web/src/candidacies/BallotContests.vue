<script setup lang="ts">
import type { BallotContest } from 'ustp-domain';
import { CIVIC_CREDIT, electionDay } from './candidacy-text.js';

/**
 * Contests on the ballot that are in none of the area's Census districts (design §5.12): school boards, judges,
 * special districts, or a district the api could not tell. Listed with their candidates, but not on the map.
 */
defineProps<{ contests: readonly BallotContest[] }>();
</script>

<template>
  <q-card v-if="contests.length" flat bordered>
    <q-card-section class="q-pb-xs">
      <h3 class="text-subtitle1 text-weight-medium q-my-none">More on the ballot</h3>
      <div class="text-caption text-grey-7">
        Contests the map has no district for, such as school boards and judges.
        <a :href="CIVIC_CREDIT.url" target="_blank" rel="noopener noreferrer">{{ CIVIC_CREDIT.text }}</a>
      </div>
    </q-card-section>
    <q-list separator>
      <q-item v-for="(b, i) in contests" :key="i">
        <q-item-section>
          <q-item-label class="text-weight-medium">{{ b.office }}</q-item-label>
          <q-item-label caption>{{ [b.district, b.election && `Election ${electionDay(b.election)}`].filter(Boolean).join(' · ') }}</q-item-label>
          <ul class="ballot-contests__people">
            <li v-for="c in b.candidates" :key="c.name">
              {{ c.name }}<template v-if="c.party"> · {{ c.party }}</template>
              <a v-if="c.website" :href="c.website" target="_blank" rel="noopener noreferrer" class="q-ml-sm">Website</a>
            </li>
          </ul>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<style scoped>
.ballot-contests__people {
  margin: 4px 0 0;
  padding-left: 20px;
}
</style>
