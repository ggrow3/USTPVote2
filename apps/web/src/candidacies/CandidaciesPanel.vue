<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { awaitingReview, currentContent, type AdminCandidacy } from 'ustp-domain';
import { errorMessage } from '../api.js';
import { askReason, attempt } from '../dialogs.js';
import { session } from '../session.js';
import { allCandidacies, decideCandidacy, removeCandidacy } from './api.js';
import CandidacyDetails from './CandidacyDetails.vue';
import { day, districtText, electionText, stateName, STATUS_TEXT } from './candidacy-text.js';
import DistrictMap from './DistrictMap.vue';
import EmailTemplatesAdmin from './EmailTemplatesAdmin.vue';

/**
 * Reviewing members' candidacies for public office (design §5.8): approve or decline each declaration and each change
 * before the Candidates page shows it, and take a candidacy down. Decisions are in the audit ledger. A second tab keeps
 * the emails members send from the Your area page (§5.12), which Communications Admins keep too.
 */
const view = ref<'review' | 'templates'>('review');
const list = ref<AdminCandidacy[] | null>(null);
const error = ref<string | null>(null);
const showEnded = ref(false);

const waiting = computed(() => (list.value ?? []).filter(awaitingReview));
const others = computed(() => (list.value ?? []).filter((c) => !awaitingReview(c) && (showEnded.value || c.status === 'open')));
const ended = computed(() => (list.value ?? []).filter((c) => c.status !== 'open').length);
const me = computed(() => session.me?.account?.accountId ?? null);

async function load() {
  try {
    list.value = await allCandidacies();
    error.value = null;
  } catch (e) {
    error.value = errorMessage(e);
  }
}
onMounted(load);

async function approve(c: AdminCandidacy) {
  if (await attempt(() => decideCandidacy(c.candidacyId, { decision: 'approve', note: null, basedOn: c.version }), 'Approved: it is on the Candidates page')) {
    await load();
  }
}

async function decline(c: AdminCandidacy) {
  const note = await askReason(`Ask ${c.name} for changes`, 'They see this note, change their candidacy and send it again.');
  if (note === null) return;
  if (await attempt(() => decideCandidacy(c.candidacyId, { decision: 'decline', note, basedOn: c.version }), 'Sent back to the member')) await load();
}

async function takeDown(c: AdminCandidacy) {
  const reason = await askReason(`Take down ${c.name}’s candidacy`, 'It leaves the Candidates page at once and cannot come back; the member sees your reason.');
  if (reason === null) return;
  if (await attempt(() => removeCandidacy(c.candidacyId, reason), 'Taken down')) await load();
}

const outlineOf = (c: AdminCandidacy) => ({ kind: currentContent(c).district.kind, geoid: currentContent(c).district.geoid });
const markersOf = (c: AdminCandidacy) => {
  const { district } = currentContent(c);
  return district.point ? [{ id: c.candidacyId, point: district.point, title: c.name, caption: districtText(currentContent(c)) }] : [];
};
</script>

<template>
  <div>
    <q-tabs v-model="view" dense no-caps align="left" class="text-primary">
      <q-tab id="candidacies-tab-review" name="review" icon="how_to_vote" label="Review" aria-controls="candidacies-panel-review" />
      <q-tab id="candidacies-tab-templates" name="templates" icon="mail" label="Your area emails" aria-controls="candidacies-panel-templates" />
    </q-tabs>
    <q-separator />
    <q-tab-panels v-model="view" keep-alive class="bg-transparent">
      <q-tab-panel id="candidacies-panel-review" name="review" aria-labelledby="candidacies-tab-review" class="q-px-none">
          <div class="ustp-content">
            <p class="text-grey-7">
              Active members declare their candidacies for public office; each one, and each later change, waits here until a
              Membership Admin approves it for the public <router-link to="/candidates">Candidates page</router-link>. Check that the
              member is really running for that office, and that the platform is fit to show under the party’s name.
            </p>
            <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
            <div v-else-if="!list" class="text-grey-7">Loading…</div>
            <template v-else>
              <h2 class="text-subtitle1">Waiting for review ({{ waiting.length }})</h2>
              <div v-if="!waiting.length" class="text-grey-7">Nothing is waiting.</div>
              <q-card v-for="c in waiting" :key="c.candidacyId" flat bordered>
                <q-card-section class="ustp-header">
                  <div>
                    <div class="text-subtitle1">{{ c.name }}</div>
                    <div class="text-caption text-grey-7">
                      {{ c.published ? 'A change to a public candidacy' : 'A new candidacy' }} · sent {{ day(c.proposedAt ?? c.updatedAt) }} · member in
                      {{ c.memberState ? stateName(c.memberState) : 'no state' }}<template v-if="c.memberStatus !== 'active'"> · not an Active member</template>
                    </div>
                  </div>
                </q-card-section>
                <q-card-section class="row q-col-gutter-md">
                  <div class="col-12 col-md-7">
                    <CandidacyDetails :content="c.proposed!" />
                    <q-expansion-item v-if="c.published" dense label="The version public now" class="q-mt-sm" header-class="text-grey-7">
                      <CandidacyDetails :content="c.published" class="q-pa-sm" />
                    </q-expansion-item>
                  </div>
                  <div class="col-12 col-md-5">
                    <DistrictMap :markers="markersOf(c)" :outline="outlineOf(c)" :label="`Map of ${districtText(c.proposed!)}`" height="220px" />
                  </div>
                </q-card-section>
                <q-card-actions v-if="c.accountId !== me" class="q-px-md q-pb-md">
                  <q-btn color="primary" unelevated no-caps label="Approve" :disable="c.memberStatus !== 'active'" @click="approve(c)" />
                  <q-btn outline color="primary" no-caps label="Ask for changes" @click="decline(c)" />
                  <q-btn flat color="negative" no-caps label="Take down" @click="takeDown(c)" />
                </q-card-actions>
                <q-card-section v-else class="text-caption text-grey-7">Your own candidacy: another Membership Admin reviews it.</q-card-section>
              </q-card>

              <div class="row items-center">
                <h2 class="text-subtitle1 col">All candidacies</h2>
                <q-toggle v-if="ended" v-model="showEnded" :label="`Show withdrawn and taken down (${ended})`" />
              </div>
              <div v-if="!others.length" class="text-grey-7">None yet.</div>
              <q-list v-else bordered separator class="rounded-borders">
                <q-item v-for="c in others" :key="c.candidacyId">
                  <q-item-section>
                    <q-item-label>{{ c.name }} · {{ currentContent(c).officeTitle }}</q-item-label>
                    <q-item-label caption>{{ districtText(currentContent(c)) }} · {{ electionText(currentContent(c)) }}</q-item-label>
                    <q-item-label v-if="c.declined && c.status === 'open'" caption>Asked for changes: {{ c.declined.note }}</q-item-label>
                    <q-item-label v-if="c.ended?.reason" caption>Taken down: {{ c.ended.reason }}</q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-badge :color="STATUS_TEXT[c.stage].color" :label="STATUS_TEXT[c.stage].label" />
                  </q-item-section>
                  <q-item-section v-if="c.public" side>
                    <q-btn flat dense no-caps color="primary" label="View" :to="`/candidates/${c.candidacyId}`" />
                  </q-item-section>
                  <q-item-section v-if="c.status === 'open' && c.accountId !== me" side>
                    <q-btn flat dense no-caps color="negative" label="Take down" @click="takeDown(c)">
                      <span class="sr-only">&nbsp;{{ c.name }}’s candidacy</span>
                    </q-btn>
                  </q-item-section>
                </q-item>
              </q-list>
            </template>
          </div>
      </q-tab-panel>
      <q-tab-panel id="candidacies-panel-templates" name="templates" aria-labelledby="candidacies-tab-templates" class="q-px-none"><EmailTemplatesAdmin /></q-tab-panel>
    </q-tab-panels>
  </div>
</template>
