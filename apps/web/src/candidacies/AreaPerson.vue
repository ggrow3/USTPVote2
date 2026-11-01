<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AreaContact } from 'ustp-domain';
import { personCaption } from './candidacy-text.js';
import PersonProfile from './PersonProfile.vue';

/**
 * One person on the Candidates or Your area page (design §5.12), kept to two lines so a whole area fits on a screen:
 * a small photo where the records have one, their name, then party, source and election, with their links as small
 * icons, each named in full on hover and for screen readers: their site, email address, contact form, public record
 * and who to credit for the photo. *About* unfolds their biography and experience. The default slot takes the item's
 * side, such as the Your area page's Write button.
 */
const props = defineProps<{
  person: AreaContact;
  /** Link the person's email address too (the Your area page writes to it instead). */
  showEmail?: boolean;
}>();

/** A photo that does not load (a campaign's link can break) is left out, with its credit. */
const broken = ref(false);
const photo = computed(() => (broken.value ? null : props.person.photo));
const caption = computed(() => personCaption(props.person));
const initials = computed(() =>
  props.person.name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .map((w) => w[0]!.toUpperCase())
    .filter((_, i, all) => i === 0 || i === all.length - 1)
    .join(''),
);

interface Link {
  readonly icon: string;
  readonly label: string;
  readonly href: string | null;
  /** Opens in a new tab: every link but email. */
  readonly away: boolean;
}
const links = computed<Link[]>(() => {
  const p = props.person;
  return [
    p.website ? { icon: 'language', label: `Website: ${p.website.replace(/^https:\/\//, '').replace(/\/$/, '')}`, href: p.website, away: true } : null,
    props.showEmail && p.email ? { icon: 'mail', label: `Email ${p.email}`, href: `mailto:${p.email}`, away: false } : null,
    p.contactUrl ? { icon: 'contact_mail', label: 'Contact form', href: p.contactUrl, away: true } : null,
    p.sourceUrl ? { icon: 'fact_check', label: 'Public record', href: p.sourceUrl, away: true } : null,
    photo.value ? { icon: 'photo_camera', label: photo.value.credit, href: photo.value.creditUrl, away: true } : null,
  ].filter((l): l is Link => l !== null);
});

const about = ref(false);
const aboutId = computed(() => `about-${props.person.contactId.replace(/[^A-Za-z0-9_-]/g, '-')}`);
</script>

<template>
  <q-item dense class="area-person">
    <q-item-section avatar top class="area-person__photo">
      <q-avatar size="40px" rounded class="area-person__avatar">
        <img v-if="photo" :src="photo.url" :alt="`Photo of ${person.name}`" referrerpolicy="no-referrer" loading="lazy" @error="broken = true" />
        <span v-else aria-hidden="true">{{ initials }}</span>
      </q-avatar>
    </q-item-section>
    <q-item-section>
      <q-item-label class="area-person__name">
        <span class="text-weight-medium">{{ person.name }}</span>
        <q-badge v-if="person.incumbent" outline color="primary" class="q-ml-xs">Incumbent</q-badge>
      </q-item-label>
      <q-item-label caption class="area-person__line">
        <span>{{ caption }}</span>
        <span v-if="links.length || person.profile" class="area-person__links">
          <template v-for="l in links" :key="l.icon">
            <a
              v-if="l.href"
              :href="l.href"
              :target="l.away ? '_blank' : undefined"
              :rel="l.away ? 'noopener noreferrer' : undefined"
              :aria-label="l.label"
              class="area-person__link"
            >
              <q-icon :name="l.icon" size="16px" />
              <q-tooltip>{{ l.label }}</q-tooltip>
            </a>
            <span v-else class="area-person__link" tabindex="0" role="img" :aria-label="l.label">
              <q-icon :name="l.icon" size="16px" />
              <q-tooltip>{{ l.label }}</q-tooltip>
            </span>
          </template>
          <button
            v-if="person.profile"
            type="button"
            class="area-person__about"
            :aria-expanded="about"
            :aria-controls="aboutId"
            :aria-label="`About ${person.name}`"
            @click="about = !about"
          >
            About<q-icon :name="about ? 'expand_less' : 'expand_more'" size="16px" />
          </button>
        </span>
      </q-item-label>
      <PersonProfile v-if="about && person.profile" :id="aboutId" :person="{ name: person.name, photo, profile: person.profile }" />
    </q-item-section>
    <slot />
  </q-item>
</template>

<style scoped>
.area-person {
  align-items: flex-start;
  padding-top: 6px;
  padding-bottom: 6px;
}
.area-person__photo {
  min-width: 52px;
  padding-right: 12px;
}
.area-person__avatar {
  background: rgba(127, 127, 127, 0.18);
  font-size: 15px;
  font-weight: 500;
}
.area-person__avatar img {
  object-fit: cover;
}
.area-person__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 8px;
  row-gap: 2px;
}
.area-person__links {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.area-person__link,
.area-person__about {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  min-width: 24px;
  justify-content: center;
  border-radius: 4px;
  color: var(--q-primary);
  text-decoration: none;
}
.area-person__about {
  border: 0;
  background: none;
  padding: 0 0 0 4px;
  font: inherit;
  cursor: pointer;
}
.area-person__link:hover,
.area-person__about:hover {
  background: rgba(127, 127, 127, 0.15);
}
</style>
