<script setup lang="ts">
import { computed, ref } from 'vue';
import { NETWORK_NAMES, personPath, phoneLink, type AreaContact } from 'ustp-domain';
import { hubIcon } from '../governance/hub-icons.js';
import { CONTACT_SOURCE_TEXT, websiteText } from './candidacy-text.js';
import PersonProfile from './PersonProfile.vue';

/**
 * One representative on the Representatives page (design §5.19): who they are, then every way to reach them the
 * records give, each a button or link with its own name: write an email, call their office, their contact form, their
 * website and their official accounts; no Call button without a phone number. *About* unfolds their biography; their name opens their own page, where they
 * have one (design §5.17).
 */
const props = defineProps<{ person: AreaContact }>();
defineEmits<{ write: []; call: [] }>();

/** A photo that does not load is left out, with its credit. */
const broken = ref(false);
const photo = computed(() => (broken.value ? null : props.person.photo));
const initials = computed(() =>
  props.person.name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .map((w) => w[0]!.toUpperCase())
    .filter((_, i, all) => i === 0 || i === all.length - 1)
    .join(''),
);
const page = computed(() => personPath(props.person.contactId));
const dial = computed(() => (props.person.phone ? phoneLink(props.person.phone) : null));
const caption = computed(() => [props.person.officeTitle, props.person.party, CONTACT_SOURCE_TEXT[props.person.source]].filter(Boolean).join(' · '));
const about = ref(false);
const aboutId = computed(() => `representative-about-${props.person.contactId.replace(/[^A-Za-z0-9_-]/g, '-')}`);
</script>

<template>
  <q-card flat bordered class="representative">
    <q-card-section class="representative__who">
      <q-avatar size="64px" rounded class="representative__avatar">
        <img v-if="photo" :src="photo.url" alt="" referrerpolicy="no-referrer" loading="lazy" @error="broken = true" />
        <span v-else aria-hidden="true">{{ initials }}</span>
      </q-avatar>
      <div class="representative__text">
        <div class="text-subtitle1 text-weight-medium representative__name">
          <router-link v-if="page" :to="page">{{ person.name }}</router-link>
          <template v-else>{{ person.name }}</template>
        </div>
        <div class="text-grey-7">{{ caption }}</div>
        <div v-if="person.phone && dial">
          <a :href="dial" :aria-label="`Call ${person.name}’s office at ${person.phone}`">{{ person.phone }}</a>
        </div>
      </div>
    </q-card-section>

    <q-card-section class="q-pt-none representative__ways">
      <q-btn unelevated dense no-caps color="primary" icon="mail" label="Write" :aria-label="`Write to ${person.name}`" @click="$emit('write')" />
      <q-btn v-if="dial" outline dense no-caps color="primary" icon="call" label="Call" :aria-label="`Call ${person.name}`" @click="$emit('call')" />
      <q-btn
        v-if="person.contactUrl"
        outline
        dense
        no-caps
        color="primary"
        icon="contact_mail"
        label="Contact form"
        :aria-label="`${person.name}’s contact form`"
        :href="person.contactUrl"
        target="_blank"
        rel="noopener noreferrer"
      />
      <q-btn
        v-if="person.website"
        flat
        dense
        no-caps
        color="primary"
        icon="language"
        :label="websiteText(person.website)"
        :aria-label="`${person.name}’s website`"
        :href="person.website"
        target="_blank"
        rel="noopener noreferrer"
        class="representative__site"
      />
    </q-card-section>

    <q-card-section v-if="person.social?.length || person.profile || person.sourceUrl || photo" class="q-pt-none representative__more">
      <a
        v-for="s in person.social ?? []"
        :key="s.network"
        :href="s.url"
        target="_blank"
        rel="noopener noreferrer"
        class="representative__account"
        :aria-label="`${person.name} on ${NETWORK_NAMES[s.network]}: ${s.handle}`"
      >
        <q-icon :name="hubIcon(s.network)" size="20px" />
        <q-tooltip>{{ NETWORK_NAMES[s.network] }}: {{ s.handle }}</q-tooltip>
      </a>
      <button v-if="person.profile" type="button" class="representative__about" :aria-expanded="about" :aria-controls="aboutId" @click="about = !about">
        About<q-icon :name="about ? 'expand_less' : 'expand_more'" size="16px" />
      </button>
      <a v-if="person.sourceUrl" :href="person.sourceUrl" target="_blank" rel="noopener noreferrer" class="text-caption">Public record</a>
      <a v-if="photo?.creditUrl" :href="photo.creditUrl" target="_blank" rel="noopener noreferrer" class="text-caption">{{ photo.credit }}</a>
      <span v-else-if="photo" class="text-caption text-grey-7">{{ photo.credit }}</span>
    </q-card-section>
    <q-card-section v-if="about && person.profile" class="q-pt-none">
      <PersonProfile :id="aboutId" :person="{ name: person.name, photo, profile: person.profile }" />
    </q-card-section>
  </q-card>
</template>

<style scoped>
.representative__who {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.representative__avatar {
  flex: none;
  background: rgba(127, 127, 127, 0.18);
  font-size: 22px;
  font-weight: 500;
}
.representative__avatar img {
  object-fit: cover;
}
.representative__text {
  min-width: 0;
}
.representative__name a {
  color: inherit;
}
.representative__ways,
.representative__more {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.representative__ways .q-btn {
  padding-left: 10px;
  padding-right: 10px;
}
.representative__site {
  max-width: 100%;
}
.representative__site :deep(.q-btn__content) {
  flex-wrap: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.representative__account {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  border-radius: 6px;
  color: var(--q-primary);
}
.representative__account:hover,
.representative__about:hover {
  background: rgba(127, 127, 127, 0.15);
}
.representative__about {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 0;
  border-radius: 6px;
  background: none;
  padding: 0 4px;
  font: inherit;
  color: var(--q-primary);
  cursor: pointer;
}
</style>
