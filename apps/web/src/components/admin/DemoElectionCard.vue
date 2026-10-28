<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { DEMO_VOTING_MINUTES, type DemoElectionResult, type DemoOpening, type PersonaSummary, type Secrecy } from 'ustp-domain';
import { api } from '../../api.js';
import { attempt } from '../../dialogs.js';
import { demoSummary, demoWindow, votingLength } from '../../elections/demo-text.js';
import { actAs } from '../../session.js';

/**
 * Demo elections (design §10.4): one click makes up an election on Transhumanist themes and schedules it as a rehearsal,
 * the Test Election Admin and Test Auditor doing each step. Part of Admin → Testing, so only where testing mode is on.
 */
const props = defineProps<{ personas: readonly PersonaSummary[] | null }>();
const emit = defineEmits<{ created: [] }>();
const router = useRouter();

const opens = ref<DemoOpening>('now');
const votingMinutes = ref<number>(15);
const secrecy = ref<Secrecy | 'random'>('random');
const creating = ref(false);
const made = ref<DemoElectionResult | null>(null);

const openings = [
  { label: 'Now (at the next minute)', value: 'now' },
  { label: 'In 5 minutes', value: 'soon' },
];
const lengths = DEMO_VOTING_MINUTES.map((m) => ({ label: votingLength(m), value: m }));
const ballots = [
  { label: 'Either, at random', value: 'random' },
  { label: 'Secret', value: 'secret' },
  { label: 'Roll-call (open)', value: 'open' },
];

const electionAdmin = computed(() => props.personas?.find((p) => p.kind === 'election_admin') ?? null);
const firstVoter = computed(() => props.personas?.find((p) => p.kind === 'voter' && p.memberStatus === 'active') ?? null);

async function create() {
  creating.value = true;
  try {
    await attempt(async () => {
      made.value = await api<DemoElectionResult>('POST', '/v1/testing/demo-elections', {
        opens: opens.value,
        votingMinutes: votingMinutes.value,
        ...(secrecy.value !== 'random' && { secrecy: secrecy.value }),
      });
      emit('created');
    }, 'Demo election scheduled');
  } finally {
    creating.value = false;
  }
}

async function open(persona: PersonaSummary | null, path: string) {
  if (persona && (await attempt(() => actAs({ accountId: persona.accountId, label: persona.label })))) await router.push(path);
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section>
      <h2 class="text-subtitle1">Demo election</h2>
      <p class="q-mt-sm q-mb-none">
        Makes up an election on Transhumanist themes at random: a few offices with invented candidates and their platforms,
        sometimes a committee or ballot measures, counted by ranked choice, plurality or approval. It is scheduled at once,
        the Test Election Admin building it and the Test Auditor approving its rehearsal roll and schedule. Its voters are
        the test voters (five are added if there are fewer), so it sends no email: its notices go to the outbox. Its title
        starts “[Demo]”, and once certified it can be deleted from its page in the election editor.
      </p>
    </q-card-section>
    <q-card-section class="ustp-row">
      <q-select v-model="opens" outlined dense emit-value map-options :options="openings" label="Voting opens" />
      <q-select v-model="votingMinutes" outlined dense emit-value map-options :options="lengths" label="Voting lasts" />
      <q-select v-model="secrecy" outlined dense emit-value map-options :options="ballots" label="Ballot" />
    </q-card-section>
    <q-card-section class="ustp-actions">
      <q-btn color="primary" no-caps icon="casino" label="Create demo election" :loading="creating" @click="create" />
    </q-card-section>
    <q-card-section v-if="made" role="status" class="ustp-stack">
      <p class="q-mb-none">
        <strong>{{ made.election.election.title }}</strong> is scheduled.
        {{ demoWindow(made.election.election) }}
      </p>
      <p class="q-mb-none text-caption">{{ demoSummary(made.election) }}</p>
      <div class="ustp-actions">
        <q-btn
          v-if="firstVoter"
          color="primary"
          no-caps
          :label="`Vote as ${firstVoter.label}`"
          @click="open(firstVoter, `/ballot/${made.election.election.electionId}`)"
        />
        <q-btn
          v-if="electionAdmin"
          outline
          color="primary"
          no-caps
          label="Open as the Test Election Admin"
          @click="open(electionAdmin, `/admin/elections/${made.election.election.electionId}`)"
        />
      </div>
    </q-card-section>
  </q-card>
</template>
