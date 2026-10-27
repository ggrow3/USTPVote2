<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import {
  appointmentInputSchema,
  freeSeats,
  planAppointment,
  type ApprovalRequestRecord,
  type MemberMatch,
  type MemberStatus,
  type PositionsView,
} from 'ustp-domain';
import { announce, focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { session } from '../session.js';
import { requestAppointment } from './api.js';
import MemberPicker from './MemberPicker.vue';
import {
  appointmentInput,
  appointmentPreview,
  dayStart,
  emptyAppointmentForm,
  latestEndInput,
  officeShape,
  seatsLine,
  todayInput,
} from './office-text.js';

/**
 * Asks an Auditor to appoint a member to an office without an election (design §6.4). From an office's card the
 * member is chosen here; from a member's profile the office is. The same rules the api applies explain a refusal
 * before anything is sent.
 */
const props = defineProps<{
  view: PositionsView;
  /** Appointments and term endings already waiting for an Auditor. */
  pending: readonly ApprovalRequestRecord[];
  /** The office, when appointing from its card. */
  positionId?: string;
  /** The member, when appointing from their profile. */
  member?: { readonly accountId: string; readonly legalName: string; readonly status: MemberStatus };
}>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ requested: [] }>();

const titleId = useId();
const officeId = ref('');
const chosen = ref<MemberMatch | null>(null);
const form = reactive(emptyAppointmentForm());
const errors = ref<FieldErrors>({});
const now = ref(new Date().toISOString());
const me = computed(() => session.me?.account?.accountId ?? null);

// Each time it opens: the preset office or none, nobody chosen, the defaults, and the time now.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    officeId.value = props.positionId ?? '';
    chosen.value = null;
    Object.assign(form, emptyAppointmentForm());
    errors.value = {};
    now.value = new Date().toISOString();
  },
  { immediate: true },
);

const office = computed(() => props.view.positions.find((p) => p.positionId === officeId.value) ?? null);
const officeTerms = computed(() => props.view.terms.filter((t) => t.positionId === officeId.value && t.status === 'active'));
/** Members found by the search are Active; on the profile the status is the member's own. */
const appointee = computed(() =>
  props.member ?? (chosen.value ? { accountId: chosen.value.accountId, legalName: chosen.value.legalName, status: 'active' as const } : null),
);
const title = computed(() => {
  if (props.member) return `Appoint ${props.member.legalName} to an office`;
  return office.value ? `Appoint to ${office.value.title}` : 'Appoint to an office';
});

const officeOptions = computed(() =>
  props.view.positions.map((p) => {
    const terms = props.view.terms.filter((t) => t.positionId === p.positionId && t.status === 'active');
    return { label: p.title, value: p.positionId, caption: `${officeShape(p)} · ${seatsLine(p, terms)}` };
  }),
);

/** Why this member cannot be chosen for this office, before searching further. */
function unavailable(match: Pick<MemberMatch, 'accountId'>): string | null {
  if (match.accountId === me.value) return 'You cannot ask for your own appointment';
  if (officeTerms.value.some((t) => t.accountId === match.accountId)) return 'Already holds this office';
  if (props.pending.some((r) => r.action === 'position.appoint' && r.subject === match.accountId)) return 'An appointment is already waiting';
  return null;
}

const input = computed(() => (appointee.value ? appointmentInput(appointee.value.accountId, form) : null));
/** The rules' answer for what the form says now: the payload, or why not. */
const plan = computed(() => {
  if (!input.value || !office.value || !appointee.value) return null;
  const parsed = appointmentInputSchema.safeParse(input.value);
  if (!parsed.success) return null;
  const { reason: _reason, ...appointment } = parsed.data;
  const context = { office: office.value, member: appointee.value, terms: officeTerms.value };
  return planAppointment(office.value.positionId, appointment, context, now.value);
});
const blocker = computed(() => {
  const who = appointee.value;
  if (who && unavailable(who)) return `${who.legalName}: ${unavailable(who)!.toLowerCase()}.`;
  if (!who && office.value && freeSeats(office.value, officeTerms.value) === 0) {
    return `${office.value.title} has no free seat: end a term first, then appoint.`;
  }
  return plan.value && !plan.value.ok ? `${plan.value.reason[0]!.toUpperCase()}${plan.value.reason.slice(1)}.` : null;
});
const preview = computed(() => (plan.value?.ok ? appointmentPreview(plan.value.value, now.value) : null));
const latestEnd = computed(() => {
  if (!office.value) return undefined;
  const start = form.start === 'date' ? dayStart(form.startDate) : now.value;
  return start ? latestEndInput(start, office.value.termMonths) : undefined;
});

// Say what changed for screen readers once the choices settle: the term's dates, or why it cannot be asked for.
let spoken = '';
watch([preview, blocker], () => {
  const message = blocker.value ?? (preview.value ? `Term ${preview.value}.` : '');
  if (open.value && message && message !== spoken) announce(message);
  spoken = message;
});

const busy = ref(false);
async function submit() {
  const local: FieldErrors = {};
  if (!office.value) local.positionId = 'Choose an office.';
  if (!appointee.value) local.accountId = 'Choose a member.';
  if (form.start === 'date' && !dayStart(form.startDate)) local.startsAt = 'Enter the date the term started.';
  if (form.end === 'date' && !dayStart(form.endDate)) local.endsAt = 'Enter the date the term ends.';
  if (form.end === 'months' && !form.months) local.termMonths = 'Enter a number of months.';
  const checked = input.value ? validate(appointmentInputSchema, input.value) : null;
  errors.value = { ...(checked && !checked.ok ? checked.errors : {}), ...local };
  if (Object.keys(errors.value).length || !checked?.ok || !office.value) return focusFirstInvalid();
  if (blocker.value) {
    announce(blocker.value, 'assertive');
    return;
  }
  busy.value = true;
  const positionId = office.value.positionId;
  const ok = await attempt(async () => {
    try {
      await requestAppointment(positionId, checked.data);
    } catch (e) {
      errors.value = apiFieldErrors(e);
      throw e;
    }
  }, 'Requested; waiting for an Auditor');
  busy.value = false;
  if (!ok) return focusFirstInvalid();
  open.value = false;
  emit('requested');
}
</script>

<template>
  <q-dialog v-model="open" persistent :aria-labelledby="titleId">
    <q-card class="ustp-dialog ustp-dialog--wide">
      <q-card-section>
        <h2 :id="titleId" class="text-h6">{{ title }}</h2>
        <div class="text-caption text-grey-7">
          Without an election: for an office nobody has been elected to yet, or to fill a seat between elections. An
          Auditor must approve, and the term starts then. Only an Active member can be appointed, and only to a free
          seat; end a sitting holder’s term first.
        </div>
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" @submit.prevent="submit">
          <q-select
            v-if="!positionId"
            v-model="officeId"
            outlined
            dense
            hide-bottom-space
            emit-value
            map-options
            label="Office"
            :options="officeOptions"
            :error="!!errors.positionId"
            :error-message="errors.positionId"
          >
            <template #option="scope">
              <q-item v-bind="scope.itemProps">
                <q-item-section>
                  <q-item-label>{{ scope.opt.label }}</q-item-label>
                  <q-item-label caption>{{ scope.opt.caption }}</q-item-label>
                </q-item-section>
              </q-item>
            </template>
          </q-select>
          <div v-else-if="office" class="text-body2">
            {{ office.title }} · {{ officeShape(office) }} · {{ seatsLine(office, officeTerms) }}
          </div>
          <MemberPicker v-if="!member" v-model="chosen" :unavailable="unavailable" :error="errors.accountId" />

          <fieldset class="ustp-fieldset">
            <legend class="text-body2 text-weight-medium">Starts</legend>
            <div class="ustp-options">
              <q-radio v-model="form.start" val="approval" dense label="When an Auditor approves" />
              <q-radio v-model="form.start" val="date" dense label="On an earlier date, for someone already serving" />
            </div>
            <q-input
              v-if="form.start === 'date'"
              v-model="form.startDate"
              class="q-mt-sm"
              outlined
              dense
              hide-bottom-space
              type="date"
              stack-label
              label="Started on"
              :max="todayInput()"
              :error="!!errors.startsAt"
              :error-message="errors.startsAt"
            />
          </fieldset>

          <fieldset class="ustp-fieldset">
            <legend class="text-body2 text-weight-medium">Ends</legend>
            <div class="ustp-options">
              <q-radio
                v-model="form.end"
                val="full"
                dense
                :label="office ? `After a full term of ${office.termMonths} months` : 'After a full term of the office'"
              />
              <q-radio v-model="form.end" val="months" dense label="After fewer months" />
              <q-radio v-model="form.end" val="date" dense label="On a date (the end of a vacated term, the next election)" />
            </div>
            <q-input
              v-if="form.end === 'months'"
              v-model.number="form.months"
              class="q-mt-sm"
              outlined
              dense
              hide-bottom-space
              type="number"
              min="1"
              :max="office?.termMonths"
              label="Months"
              :error="!!errors.termMonths"
              :error-message="errors.termMonths"
            />
            <q-input
              v-if="form.end === 'date'"
              v-model="form.endDate"
              class="q-mt-sm"
              outlined
              dense
              hide-bottom-space
              type="date"
              stack-label
              label="Ends on"
              :max="latestEnd"
              :error="!!errors.endsAt"
              :error-message="errors.endsAt"
            />
          </fieldset>

          <q-input
            v-model="form.reason"
            outlined
            dense
            autogrow
            hide-bottom-space
            type="textarea"
            label="Reason"
            hint="Published with the appointment. Name the authority: the bylaws article, the officers’ vote."
            :error="!!errors.reason"
            :error-message="errors.reason"
          />

          <div v-if="preview && !blocker" class="text-body2">
            Term if approved now: <strong>{{ preview }}</strong>
          </div>
          <q-banner v-if="blocker" class="bg-orange-1 text-black" rounded>{{ blocker }}</q-banner>
          <q-banner v-if="errors._" class="bg-negative text-white" rounded>{{ errors._ }}</q-banner>
        </q-form>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn v-close-popup flat no-caps label="Cancel" />
        <q-btn color="primary" no-caps label="Ask an Auditor to approve" :loading="busy" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
