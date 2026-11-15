<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { queueBadge, type AdminSection } from 'ustp-domain';
import { useRoute } from 'vue-router';
import type { ShownGroup } from './admin-menu.js';

/**
 * The admin console's sections as a side menu (design §10.1): a heading per group, a row per section with its icon,
 * and the section shown highlighted. Each row is a link to the section's address (`?tab=`), so it can be opened in a
 * new tab; choosing one replaces the address, as the tabs did, rather than adding to the history. A star beside each
 * row adds it to the person's favourites, at the top, or takes it off.
 */
const props = defineProps<{
  groups: readonly ShownGroup[];
  current: string;
  /** Applications waiting for a decision, shown on Applications. */
  pending: number;
  /** Prefix for the headings' ids, so the menu can be on the page twice (beside the section, and in the drawer). */
  idPrefix: string;
  favourites: readonly AdminSection[];
}>();
const emit = defineEmits<{ chosen: [section: AdminSection]; star: [section: AdminSection] }>();
const route = useRoute();
const root = ref<HTMLElement | null>(null);
const starred = (section: AdminSection) => props.favourites.includes(section);

/** The row moves to or from Favourites, so its star is drawn anew: focus follows it there, as its new name says. */
async function star(section: AdminSection): Promise<void> {
  emit('star', section);
  await nextTick();
  root.value?.querySelector<HTMLElement>(`[data-star="${section}"]`)?.focus();
}
</script>

<template>
  <div ref="root" class="admin-menu">
    <template v-for="g in groups" :key="g.label">
      <div :id="`${idPrefix}-${g.label.toLowerCase()}`" class="admin-menu__heading">{{ g.label }}</div>
      <ul class="admin-menu__list" :aria-labelledby="`${idPrefix}-${g.label.toLowerCase()}`">
        <li v-for="s in g.sections" :key="s.name" class="admin-menu__row">
          <q-item
            :to="{ query: { ...route.query, tab: s.name } }"
            replace
            :active="s.name === current"
            active-class="admin-menu__item--active"
            :aria-current="s.name === current ? 'page' : undefined"
            class="admin-menu__item"
            @click="emit('chosen', s.name)"
          >
            <q-item-section avatar class="admin-menu__icon">
              <q-icon :name="s.icon" size="20px" />
            </q-item-section>
            <q-item-section class="admin-menu__label">{{ s.label }}</q-item-section>
            <q-item-section v-if="s.name === 'applications' && pending" side>
              <q-badge color="warning" text-color="black">
                {{ queueBadge(pending) }}<span class="sr-only"> waiting</span>
              </q-badge>
            </q-item-section>
          </q-item>
          <!-- Beside the link, not in it: a button inside a link is neither. -->
          <q-btn
            flat
            round
            dense
            size="sm"
            class="admin-menu__star"
            :class="{ 'admin-menu__star--on': starred(s.name) }"
            :icon="starred(s.name) ? 'star' : 'star_border'"
            :aria-label="starred(s.name) ? `Remove ${s.label} from favourites` : `Add ${s.label} to favourites`"
            :data-star="s.name"
            @click="star(s.name)"
          />
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.admin-menu {
  padding-bottom: 8px;
}
/* Small headings over each group, as the Cloud console's "Products". */
.admin-menu__heading {
  padding: 16px 12px 4px;
  color: rgba(0, 0, 0, 0.6);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
}
.admin-menu__heading:first-child {
  padding-top: 0;
}
.body--dark .admin-menu__heading {
  color: rgba(255, 255, 255, 0.7);
}
.admin-menu__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
/* The star sits over the row's right end, which the row keeps clear for it. */
.admin-menu__row {
  position: relative;
}
.admin-menu__item {
  min-height: 40px;
  margin: 1px 0;
  padding: 4px 40px 4px 12px;
  border-radius: 999px;
  font-size: 0.9375rem;
  line-height: 1.3;
}
.admin-menu__icon {
  min-width: 36px;
  padding-right: 0;
  color: rgba(0, 0, 0, 0.6);
}
.body--dark .admin-menu__icon {
  color: rgba(255, 255, 255, 0.7);
}
/*
 * The section shown: an orange pill, bold. Light theme: primary darkened 10% on a 10% primary tint (5.1:1); dark: the
 * accent on a 14% accent tint of the dark card (4.8:1). Bold and aria-current say it too, not only the colour. No hover
 * wash on it, which would take the contrast under 4.5:1; keyboard focus keeps its ring.
 */
.admin-menu__item--active {
  background: rgba(189, 78, 0, 0.1);
  color: #aa4600;
  font-weight: 700;
}
.admin-menu__item--active .admin-menu__icon {
  color: inherit;
}
.body--dark .admin-menu__item--active {
  background: rgba(255, 105, 0, 0.14);
  color: var(--q-accent);
}
.admin-menu__item--active > :deep(.q-focus-helper) {
  display: none;
}
/*
 * A section's star shows while its row is pointed at or has focus, as the Cloud console's do, and always once starred
 * or where there is no hovering (a touch screen). Hidden by opacity, so it stays in the tab order and shows on focus.
 */
.admin-menu__star {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  color: rgba(0, 0, 0, 0.6);
  opacity: 0;
}
.body--dark .admin-menu__star {
  color: rgba(255, 255, 255, 0.7);
}
.admin-menu__row:hover .admin-menu__star,
.admin-menu__row:focus-within .admin-menu__star,
.admin-menu__star--on {
  opacity: 1;
}
@media (hover: none) {
  .admin-menu__star {
    opacity: 1;
  }
}
/* A starred section's star in the site's orange: primary on the light card, the accent on the dark one. */
.admin-menu__star--on {
  color: var(--q-primary);
}
.body--dark .admin-menu__star--on {
  color: var(--q-accent);
}
</style>
