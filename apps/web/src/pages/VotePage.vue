<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { newSalt, type BallotPart } from 'ustp-audit';
import {
  commitmentsOf,
  definitionHash,
  proposalContentHash,
  type BallotReceipt,
  type BallotView,
  type CastResult,
  type ElectionDefinition,
} from 'ustp-domain';
import { announce, focusSoon, usePageTitle } from '../a11y.js';
import { api } from '../api.js';
import { attempt } from '../dialogs.js';
import { rulesText } from '../election-text.js';
import { downloadReceipt, forgetReceipt, keepReceipt, savedReceipt } from '../receipts.js';

type Contest = ElectionDefinition['contests'][number];

const route = useRoute();
const electionId = String(route.params.id);
const view = ref<BallotView | null>(null);
/** Per contest: a proposal choice, or the chosen / ranked candidate IDs. Unanswered contests are left off the ballot. */
const answers = reactive<Record<string, string | string[] | null>>({});
const reviewing = ref(false);
const casting = ref(false);
const receipt = ref<BallotReceipt | null>(savedReceipt(electionId));
const kept = ref(!!receipt.value);
/** The server's commitments equal the ones this browser computed before sending. */
const commitmentsMatch = ref<boolean | null>(null);
usePageTitle(() => view.value?.definition.title ?? 'Ballot');
/** The voting window as a calendar event (design §12): public, so a plain link with no credentials fetches it. */
const calendarPath = `/v1/public/elections/${encodeURIComponent(electionId)}/calendar.ics`;

async function load() {
  await attempt(async () => {
    const v = await api<BallotView>('GET', `/v1/elections/${electionId}/ballot`);
    for (const c of v.definition.contests) answers[c.contestId] ??= c.spec.kind === 'proposal' ? null : [];
    view.value = v;
  });
}
onMounted(load);

/**
 * Checked here rather than taken on trust: the ballot shown is the definition frozen at scheduling, and each proposal
 * text is the one that definition commits to.
 */
const integrity = computed(() => {
  const v = view.value;
  if (!v) return null;
  const hashOk = definitionHash(v.definition) === v.definitionHash;
  const textsOk = v.definition.contests.every((c) => {
    if (!c.proposal) return true;
    const text = v.proposals.find((p) => p.snapshotId === c.proposal!.snapshotId);
    return !!text && proposalContentHash(text.title, text.body) === c.proposal.contentHash;
  });
  return hashOk && textsOk;
});

const proposalText = (c: Contest) => view.value?.proposals.find((p) => p.snapshotId === c.proposal?.snapshotId) ?? null;
const nameOf = (c: Contest, id: string) => c.candidates.find((k) => k.candidateId === id)?.name ?? id;
const list = (c: Contest) => (answers[c.contestId] as string[] | null) ?? [];
const answered = (c: Contest) => (c.spec.kind === 'proposal' ? answers[c.contestId] != null : list(c).length > 0);
const maxFor = (c: Contest) =>
  c.spec.kind === 'choose_n' ? c.spec.maxSelections : c.spec.kind === 'irv' ? (c.spec.maxRanks ?? c.candidates.length) : 1;

function choiceOptions(c: Contest) {
  const full = list(c).length >= maxFor(c);
  return c.candidates.map((k) => ({ label: k.name, value: k.candidateId, disable: full && !list(c).includes(k.candidateId) }));
}

const unranked = (c: Contest) => c.candidates.filter((k) => !list(c).includes(k.candidateId));

// Ranked choice works from the keyboard: each change is announced, and focus moves to a control that still exists
// (the button just pressed may have gone, or moved with its row).
const addButton = (c: Contest, id: string) => `[data-rank-add="${CSS.escape(`${c.contestId}/${id}`)}"]`;
const rowButton = (c: Contest, id: string, action: 'up' | 'down' | 'remove') =>
  `[data-rank-row="${CSS.escape(`${c.contestId}/${id}/${action}`)}"]`;
const rankingText = (c: Contest) => list(c).map((id, i) => `${i + 1}. ${nameOf(c, id)}`).join(', ');

function rank(c: Contest, candidateId: string) {
  const from = unranked(c).findIndex((k) => k.candidateId === candidateId);
  answers[c.contestId] = [...list(c), candidateId];
  const full = list(c).length >= maxFor(c);
  announce(`${nameOf(c, candidateId)} added as choice ${list(c).length}.${full ? ' That is the most you can rank.' : ''}`);
  const rest = unranked(c);
  const next = full ? undefined : rest[Math.min(from, rest.length - 1)];
  void focusSoon(next ? addButton(c, next.candidateId) : rowButton(c, candidateId, 'remove'));
}
function unrank(c: Contest, i: number) {
  const id = list(c)[i]!;
  answers[c.contestId] = list(c).filter((_, j) => j !== i);
  announce(`${nameOf(c, id)} removed. ${list(c).length ? `Your ranking: ${rankingText(c)}.` : 'Nobody is ranked.'}`);
  const neighbour = list(c)[Math.min(i, list(c).length - 1)];
  void focusSoon(neighbour ? rowButton(c, neighbour, 'remove') : addButton(c, id));
}
function move(c: Contest, i: number, by: -1 | 1) {
  const next = [...list(c)];
  const id = next[i]!;
  [next[i], next[i + by]] = [next[i + by]!, next[i]!];
  answers[c.contestId] = next;
  announce(`${nameOf(c, id)} is now choice ${i + by + 1}, ${nameOf(c, next[i]!)} choice ${i + 1}.`);
  const atEnd = by < 0 ? i + by === 0 : i + by === next.length - 1;
  void focusSoon(rowButton(c, id, atEnd ? (by < 0 ? 'down' : 'up') : by < 0 ? 'up' : 'down'));
}

function choose(c: Contest, chosen: string[]) {
  if (chosen.length === maxFor(c)) announce(`${chosen.length} chosen, the most allowed. Untick one to choose another.`);
}

function clear(c: Contest) {
  answers[c.contestId] = c.spec.kind === 'proposal' ? null : [];
  announce(`${c.title}: cleared. This contest will be skipped unless you answer it.`);
  void focusSoon(`#contest-${CSS.escape(c.contestId)}`);
}

function answerText(c: Contest, selection: unknown): string {
  if (c.spec.kind === 'proposal') return { yes: 'Yes', no: 'No', abstain: 'Abstain' }[selection as string] ?? String(selection);
  const ids = selection as string[];
  if (c.spec.kind === 'irv') return ids.map((id, i) => `${i + 1}. ${nameOf(c, id)}`).join(', ');
  return ids.map((id) => nameOf(c, id)).join(', ');
}

const contests = computed(() => view.value?.definition.contests ?? []);
const skipped = computed(() => contests.value.filter((c) => !answered(c)));

async function cast() {
  const v = view.value;
  if (!v) return;
  casting.value = true;
  const parts: BallotPart[] = contests.value
    .filter(answered)
    .map((c) => ({ v: 1, electionId, contestId: c.contestId, selection: answers[c.contestId], salt: newSalt() }));
  // Computed before sending, so the receipt does not depend on what the server says back.
  const commitments = commitmentsOf(parts);
  announce('Casting your ballot…');
  const ok = await attempt(async () => {
    const result = await api<CastResult>('POST', `/v1/elections/${electionId}/ballots`, { definitionHash: v.definitionHash, parts });
    commitmentsMatch.value = JSON.stringify(result.commitments) === JSON.stringify(commitments);
    receipt.value = { v: 1, electionId, title: v.definition.title, definitionHash: v.definitionHash, castAt: result.castAt, parts, commitments };
    kept.value = false;
  }, 'Your ballot was cast');
  casting.value = false;
  reviewing.value = false;
  if (!ok) return;
  await load();
  // The button that opened the dialog is gone; the receipt takes its place.
  await focusSoon('#receipt-heading');
}

function toggleKeep(keep: boolean) {
  if (!receipt.value) return;
  if (keep) kept.value = keepReceipt(receipt.value);
  else {
    forgetReceipt(electionId);
    kept.value = false;
  }
}

const contestTitle = (contestId: string) => contests.value.find((c) => c.contestId === contestId)?.title ?? contestId;
</script>

<template>
  <q-page padding>
    <div class="ustp-content">
      <q-btn flat dense no-caps icon="arrow_back" label="Your ballots" to="/ballot" class="ustp-back" />
      <div>
        <h1 class="text-h5">{{ view?.definition.title ?? 'Ballot' }}</h1>
        <div v-if="view" class="text-caption text-grey-7">
          Voting {{ new Date(view.election.opensAt).toLocaleString() }} – {{ new Date(view.election.closesAt).toLocaleString() }}
          · {{ view.election.secrecy === 'secret' ? 'Secret ballot' : 'Roll-call: how you vote is published with your name' }}
        </div>
      </div>
      <template v-if="view">
        <q-btn
          v-if="(view.election.state === 'scheduled' || view.election.state === 'open') && !view.election.castAt"
          outline
          no-caps
          color="primary"
          icon="event"
          label="Add to calendar"
          :href="calendarPath"
        >
          <span class="sr-only">: voting in {{ view.definition.title }}</span>
        </q-btn>
        <p v-if="view.definition.description" style="white-space: pre-wrap">{{ view.definition.description }}</p>

        <q-banner v-if="integrity === false" class="bg-negative text-white" rounded>
          This ballot does not match the definition frozen when the election was scheduled. Do not vote; tell an Auditor.
        </q-banner>
        <div v-else class="text-caption text-grey-7">
          <q-icon name="verified" color="positive" /> Checked in this browser: this is the ballot frozen at scheduling
          (<code>{{ view.definitionHash.slice(0, 16) }}…</code>), proposal texts included.
        </div>

        <!-- Receipt after casting, or the record that this voter already voted. -->
        <q-card
          v-if="view.election.castAt"
          tag="section"
          aria-labelledby="receipt-heading"
          flat
          bordered
        >
          <q-card-section>
            <h2 id="receipt-heading" class="text-subtitle1">You voted on {{ new Date(view.election.castAt).toLocaleString() }}</h2>
            <div v-if="commitmentsMatch === true" class="text-positive">
              The server's commitments match the ones this browser computed before sending.
            </div>
            <div v-else-if="commitmentsMatch === false" class="text-negative">
              The server's commitments differ from the ones this browser computed. Keep your receipt and tell an Auditor.
            </div>
          </q-card-section>
          <template v-if="receipt">
            <q-card-section>
              <div class="text-caption text-grey-7 q-mb-sm">
                Your receipt: one commitment per contest. Once your ballot is sealed — when enough others have voted, or
                when voting closes — the Verify page checks that each one is in the published record. Anyone who sees the
                full receipt can tell how you voted, so keep it to yourself.
              </div>
              <q-markup-table flat dense>
                <thead>
                  <tr>
                    <th class="text-left">Contest</th>
                    <th class="text-left">Commitment</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in receipt.commitments" :key="c.contestId">
                    <td>{{ contestTitle(c.contestId) }}</td>
                    <td><code>{{ c.commitment }}</code></td>
                  </tr>
                </tbody>
              </q-markup-table>
            </q-card-section>
            <q-card-section class="ustp-actions">
              <q-btn color="primary" no-caps icon="download" label="Download receipt" @click="downloadReceipt(receipt)" />
              <q-toggle :model-value="kept" label="Keep a copy in this browser" @update:model-value="toggleKeep" />
              <q-space />
              <q-btn flat no-caps icon="fact_check" label="Verify" :to="`/verify?election=${electionId}`">
                <span class="sr-only"> this receipt</span>
              </q-btn>
            </q-card-section>
          </template>
          <q-card-section v-else class="text-caption text-grey-7">
            This browser has no copy of your receipt. If you downloaded it, open it on the Verify page after voting closes.
          </q-card-section>
        </q-card>

        <q-banner v-else-if="view.election.state === 'scheduled'" class="bg-grey-3 text-black" rounded>
          Voting opens {{ new Date(view.election.opensAt).toLocaleString() }}. You can read the ballot now.
        </q-banner>
        <q-banner v-else-if="view.election.state !== 'open'" class="bg-grey-3 text-black" rounded>
          Voting has closed.
        </q-banner>

        <q-card v-for="c in contests" :key="c.contestId" tag="section" :aria-labelledby="`contest-${c.contestId}`" flat bordered>
          <q-card-section>
            <h2 :id="`contest-${c.contestId}`" class="text-subtitle1">{{ c.title }}</h2>
            <div v-if="c.description" class="text-body2" style="white-space: pre-wrap">{{ c.description }}</div>
            <div v-for="line in rulesText(c.spec)" :key="line" class="text-caption text-grey-7">{{ line }}</div>
          </q-card-section>
          <q-expansion-item v-if="proposalText(c)" dense label="Read the full text">
            <div class="q-pa-md text-body2" style="white-space: pre-wrap">{{ proposalText(c)!.body }}</div>
          </q-expansion-item>

          <q-card-section v-if="view.election.state === 'open' && !view.election.castAt">
            <q-option-group
              v-if="c.spec.kind === 'proposal'"
              v-model="answers[c.contestId]"
              :aria-labelledby="`contest-${c.contestId}`"
              inline
              :options="[
                { label: 'Yes', value: 'yes' },
                { label: 'No', value: 'no' },
                { label: 'Abstain', value: 'abstain' },
              ]"
            />
            <template v-else-if="c.spec.kind === 'choose_n'">
              <div :id="`contest-${c.contestId}-how`" class="text-caption q-mb-xs">Choose up to {{ maxFor(c) }}.</div>
              <q-option-group
                v-model="answers[c.contestId]"
                type="checkbox"
                :options="choiceOptions(c)"
                :aria-labelledby="`contest-${c.contestId}`"
                :aria-describedby="`contest-${c.contestId}-how`"
                @update:model-value="(v: string[]) => choose(c, v)"
              />
            </template>
            <template v-else>
              <div class="text-caption q-mb-xs">Rank up to {{ maxFor(c) }}, most preferred first.</div>
              <q-list
                v-if="list(c).length"
                dense
                bordered
                separator
                class="q-mb-sm"
                :aria-label="`Your ranking for ${c.title}`"
              >
                <q-item v-for="(id, i) in list(c)" :key="id">
                  <q-item-section avatar><span><span class="sr-only">Choice</span> {{ i + 1 }}</span></q-item-section>
                  <q-item-section>{{ nameOf(c, id) }}</q-item-section>
                  <q-item-section side>
                    <div class="row no-wrap">
                      <q-btn
                        flat
                        dense
                        round
                        icon="arrow_upward"
                        :disable="i === 0"
                        :aria-label="`Move ${nameOf(c, id)} up`"
                        :data-rank-row="`${c.contestId}/${id}/up`"
                        @click="move(c, i, -1)"
                      />
                      <q-btn
                        flat
                        dense
                        round
                        icon="arrow_downward"
                        :disable="i === list(c).length - 1"
                        :aria-label="`Move ${nameOf(c, id)} down`"
                        :data-rank-row="`${c.contestId}/${id}/down`"
                        @click="move(c, i, 1)"
                      />
                      <q-btn
                        flat
                        dense
                        round
                        icon="close"
                        :aria-label="`Remove ${nameOf(c, id)} from your ranking`"
                        :data-rank-row="`${c.contestId}/${id}/remove`"
                        @click="unrank(c, i)"
                      />
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
              <div v-if="unranked(c).length" class="ustp-actions" role="group" :aria-label="`Not yet ranked in ${c.title}`">
                <q-btn
                  v-for="k in unranked(c)"
                  :key="k.candidateId"
                  outline
                  no-caps
                  icon="add"
                  :label="k.name"
                  :aria-label="`Add ${k.name} as choice ${list(c).length + 1}`"
                  :data-rank-add="`${c.contestId}/${k.candidateId}`"
                  :disable="list(c).length >= maxFor(c)"
                  @click="rank(c, k.candidateId)"
                />
              </div>
            </template>
            <q-btn
              v-if="answered(c)"
              flat
              dense
              no-caps
              label="Clear (skip this contest)"
              class="q-mt-sm"
              @click="clear(c)"
            >
              <span class="sr-only">: {{ c.title }}</span>
            </q-btn>
          </q-card-section>
        </q-card>

        <div v-if="view.election.state === 'open' && !view.election.castAt" class="ustp-actions">
          <q-btn
            color="primary"
            size="lg"
            label="Review and cast"
            :disable="skipped.length === contests.length || integrity === false"
            aria-describedby="cast-hint"
            @click="reviewing = true"
          />
          <span v-if="skipped.length === contests.length" id="cast-hint" class="text-grey-7">Answer at least one contest.</span>
        </div>

        <q-dialog v-model="reviewing" aria-labelledby="review-title">
          <q-card class="ustp-dialog">
            <!-- Focus starts at the title, so a screen reader reads the summary from the top. -->
            <q-card-section>
              <h2 id="review-title" class="text-h6 ustp-focus-target" tabindex="-1" data-autofocus>Cast this ballot?</h2>
            </q-card-section>
            <q-card-section>
              <q-list dense separator>
                <q-item v-for="c in contests" :key="c.contestId">
                  <q-item-section>
                    <q-item-label>{{ c.title }}</q-item-label>
                    <q-item-label caption>{{ answered(c) ? answerText(c, answers[c.contestId]) : 'Skipped' }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
              <div class="text-caption text-grey-7 q-mt-sm">You cannot change your ballot after casting it.</div>
            </q-card-section>
            <q-card-actions align="right">
              <q-btn flat label="Back" v-close-popup />
              <q-btn color="primary" label="Cast ballot" :loading="casting" @click="cast" />
            </q-card-actions>
          </q-card>
        </q-dialog>
      </template>
    </div>
  </q-page>
</template>
