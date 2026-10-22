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

function rank(c: Contest, candidateId: string) {
  answers[c.contestId] = [...list(c), candidateId];
}
function unrank(c: Contest, i: number) {
  answers[c.contestId] = list(c).filter((_, j) => j !== i);
}
function move(c: Contest, i: number, by: -1 | 1) {
  const next = [...list(c)];
  [next[i], next[i + by]] = [next[i + by]!, next[i]!];
  answers[c.contestId] = next;
}
const unranked = (c: Contest) => c.candidates.filter((k) => !list(c).includes(k.candidateId));

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
  const ok = await attempt(async () => {
    const result = await api<CastResult>('POST', `/v1/elections/${electionId}/ballots`, { definitionHash: v.definitionHash, parts });
    commitmentsMatch.value = JSON.stringify(result.commitments) === JSON.stringify(commitments);
    receipt.value = { v: 1, electionId, title: v.definition.title, definitionHash: v.definitionHash, castAt: result.castAt, parts, commitments };
    kept.value = false;
  }, 'Your ballot was cast');
  casting.value = false;
  reviewing.value = false;
  if (ok) await load();
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
    <q-btn flat no-caps icon="arrow_back" label="Your ballots" to="/ballot" class="q-mb-sm" />
    <template v-if="view">
      <div class="text-h5">{{ view.definition.title }}</div>
      <div class="text-caption text-grey-7 q-mb-md">
        Voting {{ new Date(view.election.opensAt).toLocaleString() }} – {{ new Date(view.election.closesAt).toLocaleString() }}
        · {{ view.election.secrecy === 'secret' ? 'Secret ballot' : 'Roll-call: how you vote is published with your name' }}
      </div>
      <p v-if="view.definition.description" style="white-space: pre-wrap">{{ view.definition.description }}</p>

      <q-banner v-if="integrity === false" class="bg-negative text-white q-mb-md" rounded>
        This ballot does not match the definition frozen when the election was scheduled. Do not vote; tell an Auditor.
      </q-banner>
      <div v-else class="text-caption text-grey-7 q-mb-md">
        <q-icon name="verified" color="positive" /> Checked in this browser: this is the ballot frozen at scheduling
        (<code>{{ view.definitionHash.slice(0, 16) }}…</code>), proposal texts included.
      </div>

      <!-- Receipt after casting, or the record that this voter already voted. -->
      <q-card v-if="view.election.castAt" flat bordered class="q-mb-md" style="max-width: 860px">
        <q-card-section>
          <div class="text-subtitle1">You voted on {{ new Date(view.election.castAt).toLocaleString() }}</div>
          <div v-if="commitmentsMatch === true" class="text-positive">
            The server's commitments match the ones this browser computed before sending.
          </div>
          <div v-else-if="commitmentsMatch === false" class="text-negative">
            The server's commitments differ from the ones this browser computed. Keep your receipt and tell an Auditor.
          </div>
        </q-card-section>
        <template v-if="receipt">
          <q-card-section class="q-pt-none">
            <div class="text-caption text-grey-7 q-mb-sm">
              Your receipt: one commitment per contest. After voting closes you can check on the Verify page that each
              one is in the published record. Anyone who sees the full receipt can tell how you voted, so keep it to
              yourself.
            </div>
            <q-markup-table flat dense>
              <tbody>
                <tr v-for="c in receipt.commitments" :key="c.contestId">
                  <td>{{ contestTitle(c.contestId) }}</td>
                  <td><code>{{ c.commitment }}</code></td>
                </tr>
              </tbody>
            </q-markup-table>
          </q-card-section>
          <q-card-actions>
            <q-btn color="primary" no-caps icon="download" label="Download receipt" @click="downloadReceipt(receipt)" />
            <q-toggle :model-value="kept" label="Keep a copy in this browser" @update:model-value="toggleKeep" />
          </q-card-actions>
        </template>
        <q-card-section v-else class="q-pt-none text-caption text-grey-7">
          This browser has no copy of your receipt. If you downloaded it, open it on the Verify page after voting closes.
        </q-card-section>
      </q-card>

      <q-banner v-else-if="view.election.state === 'scheduled'" class="bg-grey-3 text-black q-mb-md" rounded>
        Voting opens {{ new Date(view.election.opensAt).toLocaleString() }}. You can read the ballot now.
      </q-banner>
      <q-banner v-else-if="view.election.state !== 'open'" class="bg-grey-3 text-black q-mb-md" rounded>
        Voting has closed.
      </q-banner>

      <div class="column q-gutter-md" style="max-width: 860px">
        <q-card v-for="c in contests" :key="c.contestId" flat bordered>
          <q-card-section>
            <div class="text-subtitle1">{{ c.title }}</div>
            <div v-if="c.description" class="text-body2" style="white-space: pre-wrap">{{ c.description }}</div>
            <div v-for="line in rulesText(c.spec)" :key="line" class="text-caption text-grey-7">{{ line }}</div>
          </q-card-section>
          <q-expansion-item v-if="proposalText(c)" dense label="Read the full text" class="q-px-sm">
            <div class="q-pa-md text-body2" style="white-space: pre-wrap">{{ proposalText(c)!.body }}</div>
          </q-expansion-item>

          <q-card-section v-if="view.election.state === 'open' && !view.election.castAt">
            <q-option-group
              v-if="c.spec.kind === 'proposal'"
              v-model="answers[c.contestId]"
              inline
              :options="[
                { label: 'Yes', value: 'yes' },
                { label: 'No', value: 'no' },
                { label: 'Abstain', value: 'abstain' },
              ]"
            />
            <template v-else-if="c.spec.kind === 'choose_n'">
              <div class="text-caption q-mb-xs">Choose up to {{ maxFor(c) }}.</div>
              <q-option-group v-model="answers[c.contestId]" type="checkbox" :options="choiceOptions(c)" />
            </template>
            <template v-else>
              <div class="text-caption q-mb-xs">Rank up to {{ maxFor(c) }}, most preferred first.</div>
              <q-list v-if="list(c).length" dense bordered separator class="q-mb-sm">
                <q-item v-for="(id, i) in list(c)" :key="id">
                  <q-item-section avatar>{{ i + 1 }}</q-item-section>
                  <q-item-section>{{ nameOf(c, id) }}</q-item-section>
                  <q-item-section side>
                    <div class="row no-wrap">
                      <q-btn flat dense round icon="arrow_upward" :disable="i === 0" aria-label="Move up" @click="move(c, i, -1)" />
                      <q-btn
                        flat
                        dense
                        round
                        icon="arrow_downward"
                        :disable="i === list(c).length - 1"
                        aria-label="Move down"
                        @click="move(c, i, 1)"
                      />
                      <q-btn flat dense round icon="close" aria-label="Remove" @click="unrank(c, i)" />
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
              <div class="row q-gutter-sm">
                <q-btn
                  v-for="k in unranked(c)"
                  :key="k.candidateId"
                  outline
                  no-caps
                  icon="add"
                  :label="k.name"
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
              size="sm"
              label="Clear (skip this contest)"
              class="q-mt-sm"
              @click="answers[c.contestId] = c.spec.kind === 'proposal' ? null : []"
            />
          </q-card-section>
        </q-card>
      </div>

      <div v-if="view.election.state === 'open' && !view.election.castAt" class="q-mt-lg">
        <q-btn
          color="primary"
          size="lg"
          label="Review and cast"
          :disable="skipped.length === contests.length || integrity === false"
          @click="reviewing = true"
        />
        <span v-if="skipped.length === contests.length" class="q-ml-md text-grey-7">Answer at least one contest.</span>
      </div>

      <q-dialog v-model="reviewing">
        <q-card style="min-width: 360px; max-width: 640px">
          <q-card-section class="text-h6">Cast this ballot?</q-card-section>
          <q-card-section class="q-pt-none">
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
  </q-page>
</template>
