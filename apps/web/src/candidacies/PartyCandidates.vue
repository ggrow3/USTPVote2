<script setup lang="ts">
import { isAmong, type PublicCandidacy, type SeatPerson } from 'ustp-domain';
import { ballotLabelText, districtText, electionText } from './candidacy-text.js';
import PersonBadges from './PersonBadges.vue';

/**
 * The Transhumanist Party's candidates on the Candidates and Your area pages (design §5.8): members' approved candidacies,
 * each opening its own page, marked as the party's and, when they hold an office in the member's area now, as the
 * member's representative too. A member on the ballot under another label says so.
 */
defineProps<{
  candidacies: readonly PublicCandidacy[];
  /** The area's people in office, to mark a candidate who is one of them; none outside the member's own area. */
  holders?: readonly SeatPerson[];
}>();
</script>

<template>
  <q-list bordered separator class="rounded-borders party-candidates">
    <q-item v-for="c in candidacies" :key="c.candidacyId" clickable :to="`/candidates/${c.candidacyId}`">
      <q-item-section>
        <q-item-label class="text-weight-medium">
          {{ c.name }}
          <PersonBadges :marks="{ party: true, representative: isAmong(c, holders ?? []) }" />
        </q-item-label>
        <q-item-label>{{ c.officeTitle }}<template v-if="ballotLabelText(c.ballotLabel)"> · {{ ballotLabelText(c.ballotLabel) }}</template></q-item-label>
        <q-item-label caption>{{ districtText(c) }} · {{ electionText(c) }}</q-item-label>
      </q-item-section>
      <q-item-section side><q-icon name="chevron_right" /></q-item-section>
    </q-item>
  </q-list>
</template>

<style scoped>
.party-candidates {
  border-left: 4px solid var(--q-primary);
}
</style>
