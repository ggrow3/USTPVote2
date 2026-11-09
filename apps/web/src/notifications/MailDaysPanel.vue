<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { addDays, MAIL_DAY_PEOPLE, zoneDay, type MailDayPerson, type MailDaysView, type MailDayView } from 'ustp-domain';
import { announce } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { browserTimeZone, mailDay, mailDays } from './api.js';
import { dayPersonAddresses, dayPersonName, emailCount, kindCounts, LOG_KIND_LABELS, LOG_STATUS_COLOURS, LOG_STATUS_LABELS } from './mail-log-text.js';
import MailDaysChart from './MailDaysChart.vue';

/**
 * Daily counts of the email log (design §10.12), for System and Site Admins: how many emails the site sent each day, and
 * on one day how many went to each person and to which address. Days run from midnight to midnight in the admin's own
 * time zone. A person's emails open in the log, narrowed to them and the day.
 */
const emit = defineEmits<{ show: [filter: { accountId: string | null; label: string | null; day: string }] }>();

const zone = browserTimeZone();
const today = () => zoneDay(new Date(), zone);

const RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];
const range = ref(30);
const totals = ref<MailDaysView | null>(null);
const selected = ref(today());
const view = ref<MailDayView | null>(null);
const loadingDays = ref(false);
const loadingDay = ref(false);

async function loadDays() {
  loadingDays.value = true;
  await attempt(async () => {
    totals.value = await mailDays(range.value);
  });
  loadingDays.value = false;
}

const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day);

async function loadDay() {
  const day = selected.value;
  if (!isDay(day)) return;
  loadingDay.value = true;
  await attempt(async () => {
    const result = await mailDay(day);
    // A later choice of day supersedes this one.
    if (selected.value !== day) return;
    view.value = result;
    announce(`${heading(day)}: ${emailCount(result.emails)} to ${people(result.peopleCount)}.`);
  });
  loadingDay.value = false;
}

function refresh() {
  void loadDays();
  void loadDay();
}

watch(range, () => void loadDays());
watch(selected, () => {
  search.value = '';
  limit.value = PAGE;
  void loadDay();
});
onMounted(refresh);

const rangeTotal = computed(() => totals.value?.days.reduce((sum, d) => sum + d.emails, 0) ?? 0);
const isToday = computed(() => selected.value === today());

function step(n: number) {
  const next = addDays(isDay(selected.value) ? selected.value : today(), n);
  if (next <= today()) selected.value = next;
}

const heading = (day: string) =>
  isDay(day) ? new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'Choose a day';
const people = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`;

// --- the people ------------------------------------------------------------------------------------------------------

const PAGE = 50;
const search = ref('');
const limit = ref(PAGE);
watch(search, () => (limit.value = PAGE));

const matching = computed<readonly MailDayPerson[]>(() => {
  const q = search.value.trim().toLowerCase();
  const all = view.value?.people ?? [];
  if (!q) return all;
  return all.filter((p) => [dayPersonName(p), ...p.addresses, p.addressNow ?? ''].some((v) => v.toLowerCase().includes(q)));
});
const shown = computed(() => matching.value.slice(0, limit.value));

function show(person: MailDayPerson | null) {
  emit('show', { accountId: person?.accountId ?? null, label: person ? dayPersonName(person) : null, day: selected.value });
}

function outcome(p: MailDayPerson): string {
  const parts: string[] = [];
  if (p.delivered) parts.push(`${p.delivered} delivered`);
  if (p.waiting) parts.push(`${p.waiting} waiting for a report`);
  if (p.problems) parts.push(`${p.problems} bounced, marked as spam or not sent`);
  return parts.join(' · ');
}
</script>

<template>
  <div class="ustp-content">
    <div>
      <h2 class="text-subtitle1">Daily counts</h2>
      <p class="q-mb-none">
        How many emails the site sent each day, and on one day how many went to each person and the address each went to.
        Days run from midnight to midnight in your time zone, {{ zone }}. The site keeps its record of each email for 180
        days, and the address it went to from 9 November 2026 on.
      </p>
    </div>

    <q-card flat bordered tag="section" aria-labelledby="mail-days-heading">
      <q-card-section class="row items-center q-col-gutter-sm q-pb-none">
        <div class="col-12 col-sm">
          <h3 id="mail-days-heading" class="text-subtitle2 q-my-none">Emails per day</h3>
        </div>
        <div class="col-12 col-sm-auto row items-center no-wrap q-gutter-sm">
          <q-btn-toggle v-model="range" no-caps dense unelevated toggle-color="primary" :options="RANGES" aria-label="How many days to show" />
          <q-btn flat round dense icon="refresh" aria-label="Refresh the counts" :loading="loadingDays || loadingDay" @click="refresh" />
        </div>
      </q-card-section>
      <q-card-section>
        <p v-if="totals" class="q-mb-sm">
          <strong>{{ emailCount(rangeTotal) }}</strong> in the last {{ range }} days. Choose a day to see whom they went to.
        </p>
        <MailDaysChart v-if="totals" :days="totals.days" :selected="selected" :title="`Emails sent per day, the last ${range} days`" @select="selected = $event" />
        <q-skeleton v-else-if="loadingDays" height="180px" />
      </q-card-section>
    </q-card>

    <q-card flat bordered tag="section" aria-labelledby="mail-day-heading">
      <q-card-section class="row items-center q-col-gutter-sm">
        <div class="col-12 col-sm">
          <h3 id="mail-day-heading" class="text-subtitle2 q-my-none">{{ heading(selected) }}</h3>
        </div>
        <div class="col-12 col-sm-auto row items-center no-wrap q-gutter-xs">
          <q-btn flat round dense icon="chevron_left" aria-label="The day before" @click="step(-1)" />
          <q-input v-model="selected" outlined dense type="date" label="Day" stack-label :max="today()" class="mail-day__picker" />
          <q-btn flat round dense icon="chevron_right" aria-label="The day after" :disable="isToday" @click="step(1)" />
          <q-btn v-if="!isToday" flat dense no-caps color="primary" label="Today" @click="selected = today()" />
        </div>
      </q-card-section>

      <template v-if="view && view.day === selected">
        <q-card-section class="row q-col-gutter-md q-pt-none">
          <div class="col-4">
            <div class="text-caption text-grey-7">Emails</div>
            <div class="text-h6 text-weight-medium">{{ view.emails.toLocaleString() }}</div>
          </div>
          <div class="col-4">
            <div class="text-caption text-grey-7">People</div>
            <div class="text-h6 text-weight-medium">{{ view.peopleCount.toLocaleString() }}</div>
          </div>
          <div class="col-4">
            <div class="text-caption text-grey-7">Addresses kept</div>
            <div class="text-h6 text-weight-medium">{{ view.addresses.toLocaleString() }}</div>
          </div>
        </q-card-section>

        <q-card-section v-if="view.emails" class="q-pt-none">
          <div class="row q-gutter-xs" role="list" aria-label="What became of them">
            <q-chip
              v-for="s in view.byStatus"
              :key="s.status"
              role="listitem"
              dense
              square
              :color="LOG_STATUS_COLOURS[s.status]"
              text-color="white"
              :label="`${LOG_STATUS_LABELS[s.status]}: ${s.count.toLocaleString()}`"
            />
          </div>
          <p class="q-mt-sm q-mb-none text-body2">
            <span class="text-weight-medium">What they were:</span>
            {{ view.byKind.map((k) => `${LOG_KIND_LABELS[k.kind]} ${k.count.toLocaleString()}`).join(' · ') }}
          </p>
          <p v-if="view.scanLimited" class="q-mt-sm q-mb-none text-grey-7">
            So many emails went that day that the breakdown counts only the first {{ view.read.toLocaleString() }}; the total
            above counts them all.
          </p>
          <q-btn flat no-caps dense color="primary" icon="list" label="See this day’s emails in the log" class="q-mt-sm" @click="show(null)" />
        </q-card-section>
        <q-card-section v-else class="q-pt-none">
          <p class="q-my-none text-grey-7" role="status">The site sent no email that day.</p>
        </q-card-section>

        <template v-if="view.people.length">
          <q-separator />
          <q-card-section>
            <h4 class="text-subtitle2 q-mt-none q-mb-sm">Emails to each person, the most first</h4>
            <q-input v-model="search" outlined dense clearable label="Find a person or address" class="q-mb-sm" />
            <q-list v-if="shown.length" separator bordered class="rounded-borders" aria-label="Emails to each person">
              <q-item v-for="p in shown" :key="p.accountId ?? p.addresses.join(',')">
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{ dayPersonName(p) }}</q-item-label>
                  <q-item-label caption class="mail-day__address">{{ dayPersonAddresses(p) }}</q-item-label>
                  <q-item-label caption>{{ kindCounts(p.kinds) }}</q-item-label>
                  <q-item-label caption>{{ outcome(p) }}</q-item-label>
                  <q-item-label v-if="p.accountId">
                    <q-btn flat dense no-caps color="primary" size="sm" class="q-px-none" :label="`See ${p.emails === 1 ? 'it' : 'them'} in the log`" :aria-label="`See the emails to ${dayPersonName(p)} that day in the log`" @click="show(p)" />
                  </q-item-label>
                </q-item-section>
                <q-item-section side top>
                  <q-item-label class="text-h6 text-weight-medium">{{ p.emails.toLocaleString() }}</q-item-label>
                  <q-item-label caption>{{ p.emails === 1 ? 'email' : 'emails' }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
            <p v-else class="q-my-none text-grey-7" role="status">Nobody that day matches “{{ search }}”.</p>
            <div v-if="matching.length > shown.length" class="ustp-actions q-mt-sm">
              <q-btn outline no-caps color="primary" icon="expand_more" :label="`Show ${Math.min(PAGE, matching.length - shown.length)} more`" @click="limit += PAGE" />
            </div>
            <p v-if="view.peopleCount > view.people.length" class="q-mt-sm q-mb-none text-grey-7">
              These are the {{ MAIL_DAY_PEOPLE.toLocaleString() }} people sent the most, of {{ people(view.peopleCount) }} that day.
            </p>
          </q-card-section>
        </template>
      </template>
      <q-card-section v-else-if="loadingDay" class="q-pt-none">
        <q-skeleton height="120px" />
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.mail-day__picker {
  width: 11rem;
}
/* Addresses are long words: let them break rather than widen the page. */
.mail-day__address {
  overflow-wrap: anywhere;
}
</style>
