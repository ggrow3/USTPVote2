<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { REFERRAL_PERIODS, type ReferralLeaderboard, type ReferralPeriod } from 'ustp-domain';
import { errorMessage } from '../api.js';
import TeamBadge from '../teams/TeamBadge.vue';
import { referralLeaderboard } from './api.js';

/**
 * The team leaderboard (design §5.17), for Active members on the Teams page: teams ranked by how many people joined by
 * their members' referral links, over a period. Only teams' totals: nobody's own count is shown to anyone else.
 */
const days = ref<ReferralPeriod>(90);
const board = ref<ReferralLeaderboard | null>(null);
const problem = ref<string | null>(null);

const periodOptions = REFERRAL_PERIODS.map((d) => ({ value: d, label: d === 0 ? 'All time' : `Last ${d} days` }));

async function load() {
  problem.value = null;
  try {
    board.value = await referralLeaderboard(days.value);
  } catch (e) {
    problem.value = errorMessage(e);
  }
}
watch(days, load);
onMounted(load);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<template>
  <q-card flat bordered tag="section" aria-labelledby="leaderboard-title">
    <q-card-section class="row items-center q-col-gutter-sm">
      <div class="col-12 col-sm">
        <h2 id="leaderboard-title" class="text-subtitle1 q-my-none">Who brought the most people in</h2>
        <div class="text-caption text-grey-7">
          People who joined by the referral links of each team's members, once approved. Your own link is on
          <router-link to="/account">your Account page</router-link>.
        </div>
      </div>
      <div class="col-12 col-sm-auto">
        <q-select v-model="days" :options="periodOptions" emit-value map-options outlined dense label="Period" style="min-width: 160px" />
      </div>
    </q-card-section>
    <q-card-section v-if="problem" class="q-pt-none" role="alert">{{ problem }}</q-card-section>
    <q-card-section v-else-if="!board" class="q-pt-none text-grey-7">Loading…</q-card-section>
    <template v-else>
      <q-card-section class="q-pt-none" role="status">
        {{ plural(board.joined, 'person', 'people') }} joined by members' links {{ board.days ? `in the last ${board.days} days` : 'so far' }}.
      </q-card-section>
      <q-markup-table v-if="board.teams.length" flat dense wrap-cells class="leaderboard">
        <caption class="sr-only">Teams ranked by the people their members brought in</caption>
        <thead>
          <tr>
            <th scope="col" class="text-right">Rank</th>
            <th scope="col" class="text-left">Team</th>
            <th scope="col" class="text-right">Joined</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in board.teams" :key="t.teamId" :class="{ leaderboard__mine: t.mine }">
            <td class="text-right">{{ t.rank }}</td>
            <td>
              <div class="row items-center no-wrap q-gutter-sm">
                <TeamBadge :team="t" size="28px" />
                <router-link :to="`/teams/${encodeURIComponent(t.teamId)}`">{{ t.name }}</router-link>
                <span v-if="t.mine" class="text-caption text-grey-7">(your team)</span>
              </div>
            </td>
            <td class="text-right">{{ t.joined }}</td>
          </tr>
        </tbody>
      </q-markup-table>
      <q-card-section v-else class="q-pt-none text-grey-7">There are no teams yet.</q-card-section>
    </template>
  </q-card>
</template>

<style scoped>
.leaderboard__mine {
  background: rgba(189, 78, 0, 0.08);
}
</style>
