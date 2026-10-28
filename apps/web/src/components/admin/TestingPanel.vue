<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { MAX_TEST_VOTERS, type PersonaSummary } from 'ustp-domain';
import { api } from '../../api.js';
import { roleLabel } from '../../approval-text.js';
import { attempt } from '../../dialogs.js';
import { actAs } from '../../session.js';
import DemoElectionCard from './DemoElectionCard.vue';

/**
 * Testing mode (design §10.4): create test personas, act as them, and make a demo election. Shown to System Admins when
 * the deployment allows it.
 */
const router = useRouter();
const personas = ref<PersonaSummary[] | null>(null);
const voters = ref(5);
const hasAdmins = computed(() => personas.value?.some((p) => p.kind !== 'voter') ?? false);
const room = computed(() => MAX_TEST_VOTERS - (personas.value?.filter((p) => p.kind === 'voter').length ?? 0));

function describe(p: PersonaSummary): string {
  if (p.roles.length) return p.roles.map(roleLabel).join(', ');
  return p.memberStatus ? `Voter · ${p.memberStatus} member` : 'Voter';
}

async function load() {
  await attempt(async () => {
    personas.value = await api<PersonaSummary[]>('GET', '/v1/testing/personas');
  });
}

async function create(count: number) {
  const done = count ? `Added ${count} test voter${count === 1 ? '' : 's'}` : 'Admin personas ready';
  await attempt(async () => {
    personas.value = await api<PersonaSummary[]>('POST', '/v1/testing/personas', { voters: count });
  }, done);
}

async function actAsPersona(p: PersonaSummary) {
  if (await attempt(() => actAs({ accountId: p.accountId, label: p.label }))) {
    await router.push(p.kind === 'voter' ? '/ballot' : '/admin');
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <q-card flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">Test personas</h2>
        <p class="q-mt-sm q-mb-none">
          This deployment lets System Admins rehearse elections. Test personas are accounts with no login: one for each
          admin role, and as many voters as you need. Act as one and the app shows and does exactly what that person
          could, so every two-person step is still done by two different accounts. Actions are recorded under the
          persona; the server log records that you were acting. Open another browser tab to be a second persona at the
          same time.
        </p>
      </q-card-section>
      <q-card-section v-if="personas && !hasAdmins" class="ustp-actions">
        <q-btn color="primary" no-caps label="Create admin personas" @click="create(0)" />
      </q-card-section>
      <q-list v-if="personas?.length" separator>
        <q-item v-for="p in personas" :key="p.accountId">
          <q-item-section>
            <q-item-label>{{ p.label }}</q-item-label>
            <q-item-label caption>{{ describe(p) }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn flat dense no-caps color="primary" label="Act as" :aria-label="`Act as ${p.label}`" @click="actAsPersona(p)" />
          </q-item-section>
        </q-item>
      </q-list>
      <q-card-section v-if="hasAdmins" class="ustp-row">
        <q-input
          v-model.number="voters"
          type="number"
          outlined
          dense
          hide-bottom-space
          :min="1"
          :max="room"
          label="Test voters to add"
          :hint="`Up to ${room} more`"
        />
        <q-btn color="primary" no-caps label="Add voters" :disable="!(voters >= 1 && voters <= room)" @click="create(voters)" />
      </q-card-section>
    </q-card>

    <DemoElectionCard :personas="personas" @created="load" />

    <q-card flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">Rehearse an election</h2>
        <ol class="q-mt-sm q-mb-none q-pl-md">
          <li>
            If no bylaws are published, act as the Test Membership Admin and publish them under Admin → Bylaws. Test
            voters join on the current bylaws.
          </li>
          <li>Stop acting, come back here and add test voters.</li>
          <li>
            Act as the Test Election Admin: create an election under Admin → Elections, add its contests, then request the
            voter roll and the schedule.
          </li>
          <li>Act as the Test Auditor and approve both under Admin → Approvals.</li>
          <li>Once voting opens, act as each test voter and vote under Ballot.</li>
          <li>
            After voting closes and the results are in, the Test Election Admin requests certification and the Test
            Auditor approves it.
          </li>
          <li>To clear it away, the Test Election Admin deletes it from its page in the election editor.</li>
        </ol>
        <p class="q-mt-sm q-mb-none">Create demo election, above, does steps 2 to 4 for you with an election made up at random.</p>
      </q-card-section>
    </q-card>
  </div>
</template>
