<script setup lang="ts">
import { computed } from 'vue';
import { linkTarget, RECENT_DAYS, type HubClickCount, type HubIcon, type HubRecord } from 'ustp-domain';
import { hubIcon } from './hub-icons.js';

/**
 * How often each hub link is followed (design §10.6): the last 30 days and in all, busiest first. Only counts are kept,
 * nothing about who clicked, so these are a guide: anyone can click a link many times.
 */
const props = defineProps<{ saved: HubRecord; clicks: readonly HubClickCount[] }>();
const emit = defineEmits<{ refresh: [] }>();

interface Row {
  readonly target: string;
  readonly title: string;
  readonly where: string;
  readonly icon: HubIcon | null;
  readonly recent: number;
  readonly total: number;
}

const rows = computed<Row[]>(() => {
  const counts = new Map(props.clicks.map((c) => [c.target, c]));
  const known = new Set<string>();
  const row = (target: string, title: string, where: string, icon: HubIcon | null): Row => {
    known.add(target);
    const c = counts.get(target);
    return { target, title, where, icon, recent: c?.recent ?? 0, total: c?.total ?? 0 };
  };
  const all = [
    ...props.saved.sections.flatMap((s) =>
      s.links.map((l) => row(linkTarget(l.id), l.title || 'Untitled link', `${s.title || 'Untitled section'}${l.shown ? '' : ' · hidden'}`, l.icon)),
    ),
    row('discord', 'Join our Discord', props.saved.discord.invite ? 'The Discord card' : 'The Discord card · hidden', 'discord'),
    // Links since removed keep their counts.
    ...props.clicks.filter((c) => !known.has(c.target)).map((c) => row(c.target, 'A removed link', c.target, null)),
  ];
  return all.sort((a, b) => b.recent - a.recent || b.total - a.total);
});

const recent = computed(() => props.clicks.reduce((sum, c) => sum + c.recent, 0));
const total = computed(() => props.clicks.reduce((sum, c) => sum + c.total, 0));
const since = computed(() => props.clicks.map((c) => c.since).filter((d): d is string => !!d).sort()[0] ?? null);
const busiest = computed(() => Math.max(1, ...rows.value.map((r) => r.recent)));
const n = (value: number) => value.toLocaleString('en-US');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
</script>

<template>
  <div class="hx">
    <div class="hx-stats">
      <div class="hx-stat">
        <div class="hx-stat__label">Last {{ RECENT_DAYS }} days</div>
        <div class="hx-stat__value">{{ n(recent) }}</div>
      </div>
      <div class="hx-stat">
        <div class="hx-stat__label">In all</div>
        <div class="hx-stat__value">{{ n(total) }}</div>
      </div>
      <div class="hx-stat">
        <div class="hx-stat__label">Counted since</div>
        <div class="hx-stat__value hx-stat__value--small">{{ since ? day(since) : 'No clicks yet' }}</div>
      </div>
    </div>

    <div class="hx-head">
      <p class="hx-note">
        Clicks on each link, card or icon, and the Discord button. Only counts are kept, per day: nothing about who
        clicked or from where. Anyone can click a link many times, so read them as a guide.
      </p>
      <q-btn flat no-caps color="primary" icon="refresh" label="Refresh" @click="emit('refresh')" />
    </div>

    <div class="hx-table-box">
      <table class="hx-table">
        <caption class="sr-only">Clicks on each hub link, busiest in the last {{ RECENT_DAYS }} days first</caption>
        <thead>
          <tr>
            <th scope="col">Link</th>
            <th scope="col" class="hx-num">Last {{ RECENT_DAYS }} days</th>
            <th scope="col" class="hx-num">In all</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.target">
            <th scope="row">
              <span class="hx-link">
                <span class="hx-tile" aria-hidden="true"><q-icon v-if="r.icon" :name="hubIcon(r.icon)" size="18px" /></span>
                <span class="hx-link__text">
                  <span class="hx-link__title">{{ r.title }}</span>
                  <span class="hx-link__where">{{ r.where }}</span>
                </span>
              </span>
            </th>
            <td class="hx-num">
              <span class="hx-bar" aria-hidden="true"><span :style="{ width: `${(r.recent / busiest) * 100}%` }" /></span>
              {{ n(r.recent) }}
            </td>
            <td class="hx-num">{{ n(r.total) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.hx {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 860px;
}
.hx-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  gap: 12px;
}
.hx-stat {
  padding: 14px 16px;
  border: 1px solid var(--ha-line);
  border-radius: var(--signal-radius);
  background: var(--ha-card);
}
.hx-stat__label {
  color: var(--ha-muted);
  font-family: var(--signal-mono);
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.hx-stat__value {
  margin-top: 4px;
  font-family: var(--signal-mono);
  font-size: 1.75rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.hx-stat__value--small {
  font-size: 1.125rem;
}
.hx-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.hx-note {
  flex: 1 1 320px;
  margin: 0;
  color: var(--ha-muted);
  font-size: 0.875rem;
}
/* The table scrolls inside its box at 320 px rather than widening the page (WCAG 1.4.10). */
.hx-table-box {
  overflow-x: auto;
  border: 1px solid var(--ha-line);
  border-radius: var(--signal-radius);
  background: var(--ha-card);
}
.hx-table {
  width: 100%;
  border-collapse: collapse;
}
.hx-table :is(th, td) {
  padding: 8px 12px;
  text-align: left;
  vertical-align: middle;
}
.hx-table thead th {
  color: var(--ha-muted);
  font-family: var(--signal-mono);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}
.hx-table tbody tr {
  border-top: 1px solid var(--ha-line);
}
.hx-table tbody th {
  font-weight: inherit;
}
.hx-num {
  font-family: var(--signal-mono);
  font-variant-numeric: tabular-nums;
  text-align: right !important;
  white-space: nowrap;
}
.hx-link {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hx-tile {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--ha-tile);
}
.hx-link__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.hx-link__title {
  font-family: var(--signal-display);
  font-weight: 650;
}
.hx-link__where {
  color: var(--ha-muted);
  font-size: 0.8125rem;
}
.hx-bar {
  display: inline-block;
  width: 64px;
  height: 6px;
  margin-right: 8px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--ha-tile);
  vertical-align: middle;
}
.hx-bar > span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--ha-letters);
}
</style>
