<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ApprovalRequestRecord, MemberStatus, PositionsView } from 'ustp-domain';
import { attempt } from '../dialogs.js';
import AppointDialog from './AppointDialog.vue';
import { offices, pendingOfficeRequests } from './api.js';
import { day, pendingLine, termBasis, termDates } from './office-text.js';

/**
 * A member's offices on their profile (design §5.2, §6.4): the terms they hold or held, appointments waiting for an
 * Auditor, and Appoint to an office for an Active member who is not the admin themselves.
 */
const props = defineProps<{
  member: { readonly accountId: string; readonly legalName: string; readonly status: MemberStatus };
  /** The profile is the admin's own: another admin asks for their appointment. */
  isSelf: boolean;
}>();

const view = ref<PositionsView | null>(null);
const pending = ref<ApprovalRequestRecord[]>([]);
const appointing = ref(false);

async function load() {
  await attempt(async () => {
    [view.value, pending.value] = await Promise.all([offices(), pendingOfficeRequests()]);
  });
}
watch(() => props.member.accountId, load, { immediate: true });

const titleOf = (positionId: string) => view.value?.positions.find((p) => p.positionId === positionId)?.title ?? positionId;
const terms = computed(() => view.value?.terms.filter((t) => t.accountId === props.member.accountId) ?? []);
const waiting = computed(() => pending.value.filter((r) => r.action === 'position.appoint' && r.subject === props.member.accountId));
const canAppoint = computed(() => !props.isSelf && props.member.status === 'active' && !!view.value?.positions.length);
</script>

<template>
  <q-card flat bordered>
    <q-card-section class="ustp-header">
      <div>
        <h2 class="text-subtitle1">Offices</h2>
        <div class="text-caption text-grey-7">
          Terms from elections and appointments. Appointing a member takes an Auditor’s approval.
        </div>
      </div>
      <q-btn v-if="canAppoint" outline no-caps color="primary" label="Appoint to an office" @click="appointing = true" />
    </q-card-section>
    <q-list v-if="terms.length" separator>
      <q-item v-for="t in terms" :key="t.termId">
        <q-item-section>
          <q-item-label>{{ titleOf(t.positionId) }} <span class="text-grey-7">· {{ termBasis(t) }}</span></q-item-label>
          <q-item-label caption>{{ termDates(t) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="t.status === 'active' ? 'positive' : 'grey-7'" :label="t.status" />
        </q-item-section>
      </q-item>
    </q-list>
    <q-card-section v-else-if="view" class="text-grey-7">Holds no office and has held none.</q-card-section>
    <q-card-section v-if="waiting.length">
      <h3 class="text-body2 text-weight-medium">Waiting for an Auditor</h3>
      <ul class="q-my-none q-pl-md">
        <li v-for="r in waiting" :key="r.id">
          {{ titleOf(String(r.payload.positionId)) }}: {{ pendingLine(r, terms) }}
          <span class="text-grey-7">· asked {{ day(r.requestedAt) }}</span>
        </li>
      </ul>
    </q-card-section>
    <q-card-section v-if="!isSelf && member.status !== 'active'" class="text-caption text-grey-7">
      Only an Active member can be appointed to an office.
    </q-card-section>
    <AppointDialog v-if="view" v-model="appointing" :view="view" :pending="pending" :member="member" @requested="load" />
  </q-card>
</template>
