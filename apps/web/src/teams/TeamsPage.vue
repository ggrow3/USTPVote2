<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { TeamSummary } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { ApiError, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { session } from '../session.js';
import { listTeams } from './api.js';
import TeamBadge from './TeamBadge.vue';
import { leadsLine, membersLine, POLICY_LABELS, standingLabel } from './team-text.js';

/**
 * Every team (design §5.7), for Active members: what each does, who leads it, how many are on it and how to join. The
 * teams the person is on come first; a lead sees how many requests wait for them.
 */
usePageTitle('Teams');
const teams = ref<TeamSummary[] | null>(null);
const error = ref<string | null>(null);
const notMember = ref(false);
const active = computed(() => session.me?.member?.status === 'active');

/** The person's own teams, then the rest; headed only when they are on any. */
const groups = computed(() => {
  const mine = teams.value?.filter((t) => t.mine.role) ?? [];
  const others = teams.value?.filter((t) => !t.mine.role) ?? [];
  return [
    { title: 'Your teams', list: mine, headed: mine.length > 0 },
    { title: 'Other teams', list: others, headed: mine.length > 0 },
  ];
});

onMounted(async () => {
  try {
    teams.value = await listTeams('member');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notMember.value = true;
    else error.value = errorMessage(e);
  }
});
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <div>
        <h1 class="text-h5 q-mb-xs">Teams</h1>
        <div class="text-grey-7">
          Teams are where members work together between elections. Join one, or ask to: each team's leads decide who
          joins theirs. Every Active member can see who is on each team.
        </div>
      </div>
      <q-banner v-if="notMember || (session.me && !active)" class="bg-blue-1 text-black" rounded>
        Teams are for Active members. <router-link v-if="!session.me?.member" to="/register">Apply to join the party</router-link
        ><template v-else>Your membership is not active now.</template>
      </q-banner>
      <q-banner v-else-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!teams" class="text-grey-7">Loading…</div>
      <div v-else-if="teams.length === 0" class="text-grey-7">There are no teams yet. Membership Admins create them.</div>
      <template v-else>
        <template v-for="group in groups" :key="group.title">
          <section v-if="group.list.length" class="ustp-stack">
            <h2 v-if="group.headed" class="text-subtitle1">{{ group.title }}</h2>
            <div class="team-grid">
              <q-card
                v-for="t in group.list"
                :key="t.team.teamId"
                flat
                bordered
                class="team-card cursor-pointer"
                @click="$router.push(`/teams/${encodeURIComponent(t.team.teamId)}`)"
              >
                <q-card-section class="team-card__head">
                  <TeamBadge :team="t.team" />
                  <div class="team-card__title">
                    <h3 class="text-subtitle1">
                      <router-link :to="`/teams/${encodeURIComponent(t.team.teamId)}`" class="team-card__link" @click.stop>{{
                        t.team.name
                      }}</router-link>
                    </h3>
                    <div class="text-caption text-grey-7">{{ leadsLine(t) }}</div>
                  </div>
                </q-card-section>
                <q-card-section v-if="t.team.description" class="team-card__description">{{ t.team.description }}</q-card-section>
                <q-card-section class="team-card__facts">
                  <q-chip dense square icon="group" :label="membersLine(t)" />
                  <q-chip dense square icon="how_to_reg" :label="POLICY_LABELS[t.team.joinPolicy]" />
                  <q-chip v-if="standingLabel(t)" dense square color="primary" text-color="white" :label="standingLabel(t)!" />
                  <q-chip v-if="t.waiting" dense square color="orange-9" text-color="white" icon="mail">
                    {{ t.waiting }} {{ t.waiting === 1 ? 'request waits' : 'requests wait' }}
                  </q-chip>
                </q-card-section>
              </q-card>
            </div>
          </section>
        </template>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.team-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.team-card {
  display: flex;
  flex-direction: column;
}
.team-card__head {
  display: flex;
  gap: 12px;
  align-items: center;
}
.team-card__title {
  min-width: 0;
}
.team-card__link {
  color: inherit;
  text-decoration: none;
}
.team-card__link:hover,
.team-card__link:focus-visible {
  text-decoration: underline;
}
.team-card__description {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}
.team-card__facts {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.team-card__facts .q-chip {
  margin: 0;
}
</style>
