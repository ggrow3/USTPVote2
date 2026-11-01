<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { RouterLink } from 'vue-router';
import { brightAccent, effectiveAccent, HUB_IMAGE_SIZES, hubInitials, linkTarget, type ClickTarget, type PublicHub, type Video } from 'ustp-domain';
import VideoPlayer from '../components/VideoPlayer.vue';
import { toggleTheme } from '../theme.js';
import { countHubClick, discordLive, hubImageUrl } from './api.js';
import { hubIcon } from './hub-icons.js';
import { liveText } from './hub-text.js';
import './hub-fonts.css';

/**
 * The home page hub (design §10.6): share and theme buttons, the party's profile under its cover banner if it has one,
 * its icon row, the Discord card and the sections of link cards, in one column. Every link counts its clicks. A link with
 * a video plays it in a dialog on the hub (§10.10) instead of opening an address.
 */
const props = defineProps<{ hub: PublicHub }>();
const COVER = HUB_IMAGE_SIZES.cover;

const $q = useQuasar();
const profile = computed(() => props.hub.profile);
const initials = computed(() => hubInitials(profile.value.name));
/** The accent fills the button and letters the light theme; its bright tone glows, and letters the dark theme. */
const colours = computed(() => {
  const accent = effectiveAccent(profile.value);
  return { '--hub-accent': accent, '--hub-bright': brightAccent(accent) };
});

/** How many are online, from the API (never from Discord directly); none until it answers. */
const online = ref<number | null>(null);
watch(
  () => !!props.hub.discord?.live,
  (live) => {
    online.value = null;
    if (live) discordLive().then((r) => (online.value = r.online), () => undefined);
  },
  { immediate: true },
);

type Linked = { readonly id: string; readonly title: string; readonly url: string; readonly video: Video | null };
const isPage = (url: string) => url.startsWith('/');
/** A video plays here, from a button; a page of this app goes through the router; anything else is a plain link. */
const tag = (l: Linked) => (l.video ? 'button' : isPage(l.url) ? RouterLink : 'a');
const where = (l: Linked) => (l.video ? { type: 'button' } : isPage(l.url) ? { to: l.url } : { href: l.url });

/** The video a link is playing, in the dialog; it stays set while the dialog closes, so the dialog keeps its content. */
const playing = ref<{ title: string; video: Video } | null>(null);
const playerOpen = ref(false);
function choose(l: Linked) {
  count(linkTarget(l.id));
  if (!l.video) return;
  playing.value = { title: l.title, video: l.video };
  playerOpen.value = true;
}

const count = (target: ClickTarget) => countHubClick(target);
/** A middle click opens the link in a new tab without a click event. */
function countAux(event: MouseEvent, target: ClickTarget) {
  if (event.button === 1) count(target);
}

/** The phone's share sheet where there is one; elsewhere the link is copied. */
async function share() {
  const url = `${location.origin}/`;
  if (navigator.share) {
    try {
      await navigator.share({ title: profile.value.name, text: profile.value.tagline, url });
    } catch {
      // closed without sharing
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    $q.notify({ message: 'Link to this page copied' });
  } catch {
    $q.notify({ message: `Copy this page's address to share it: ${url}`, timeout: 8000 });
  }
}
</script>

<template>
  <div class="hub ustp-signal" :class="{ 'hub--dark': $q.dark.isActive }" :style="colours">
    <div class="hub__column">
      <div class="hub__tools">
        <button type="button" class="hub__tool hub__tool--boxed" aria-label="Share this page" @click="share">
          <q-icon name="share" size="20px" />
        </button>
        <button type="button" class="hub__tool" aria-label="Dark theme" :aria-pressed="$q.dark.isActive" @click="toggleTheme">
          <q-icon :name="$q.dark.isActive ? 'dark_mode' : 'light_mode'" size="20px" />
        </button>
      </div>

      <header class="hub__profile">
        <div v-if="profile.cover" class="hub__cover">
          <img :src="hubImageUrl('cover', profile.cover)" alt="" :width="COVER.width" :height="COVER.height" />
        </div>
        <div class="hub__logo" :class="{ 'hub__logo--on-cover': profile.cover }">
          <img v-if="profile.logo" :src="hubImageUrl('logo', profile.logo)" alt="" width="104" height="104" />
          <span v-else aria-hidden="true">{{ initials }}</span>
        </div>
        <h1 class="hub__name">{{ profile.name }}</h1>
        <p v-if="profile.tagline" class="hub__tagline">{{ profile.tagline }}</p>
        <p v-if="profile.bio" class="hub__bio">{{ profile.bio }}</p>
      </header>

      <nav v-if="hub.icons.length" class="hub__icons" :aria-label="`${profile.name} online`">
        <ul>
          <li v-for="i in hub.icons" :key="i.id">
            <component
              :is="tag(i)"
              v-bind="where(i)"
              class="hub__icon"
              :aria-label="i.video ? `Play ${i.title}` : i.title"
              :title="i.title"
              @click="choose(i)"
              @auxclick="countAux($event, linkTarget(i.id))"
            >
              <q-icon :name="hubIcon(i.icon)" size="22px" />
            </component>
          </li>
        </ul>
      </nav>

      <section v-if="hub.discord" class="hub__card hub__discord" aria-labelledby="hub-discord">
        <div class="hub__discord-head">
          <span class="hub__tile" aria-hidden="true"><q-icon :name="hubIcon('discord')" size="22px" /></span>
          <div>
            <h2 id="hub-discord" class="hub__discord-title">Join the conversation</h2>
            <p class="hub__live"><span class="hub__dot" aria-hidden="true" />{{ liveText(online) }}</p>
          </div>
        </div>
        <a :href="hub.discord.invite" class="hub__button" @click="count('discord')" @auxclick="countAux($event, 'discord')">
          <q-icon :name="hubIcon('discord')" size="20px" aria-hidden="true" />
          <span>Join our Discord</span>
        </a>
      </section>

      <section v-for="s in hub.sections" :key="s.id" class="hub__section" :aria-labelledby="`hub-section-${s.id}`">
        <h2 :id="`hub-section-${s.id}`" class="hub__label">{{ s.title }}</h2>
        <ul class="hub__links">
          <li v-for="l in s.links" :key="l.id">
            <component
              :is="tag(l)"
              v-bind="where(l)"
              class="hub__card hub__link"
              :class="{ 'hub__link--featured': l.featured }"
              @click="choose(l)"
              @auxclick="countAux($event, linkTarget(l.id))"
            >
              <span class="hub__tile" aria-hidden="true"><q-icon :name="hubIcon(l.icon)" size="22px" /></span>
              <span class="hub__link-text">
                <span class="hub__link-title">{{ l.title }}</span>
                <span v-if="l.subtitle" class="hub__link-subtitle">{{ l.subtitle }}</span>
              </span>
              <q-icon :name="l.video ? 'play_circle' : isPage(l.url) ? 'arrow_forward' : 'north_east'" size="18px" class="hub__arrow" aria-hidden="true" />
            </component>
          </li>
        </ul>
      </section>
    </div>

    <q-dialog v-model="playerOpen" aria-labelledby="hub-player-title">
      <q-card v-if="playing" class="hub__player">
        <q-card-section class="row items-center no-wrap q-pb-sm">
          <h2 id="hub-player-title" class="text-h6 q-my-none col">{{ playing.title }}</h2>
          <q-btn v-close-popup flat round dense icon="close" aria-label="Close the video" />
        </q-card-section>
        <q-card-section class="q-pt-none">
          <VideoPlayer :video="playing.video" :title="playing.title" autoplay />
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
/*
 * "USTP signal" (design §10.6): black and charcoal grounds, the party's burnt orange the only strong colour, its bright
 * tone for hover and glow. Light: white cards on a warm off-white. docs/ACCESSIBILITY.md has the contrast figures.
 */
.hub {
  --hub-page: #f6f2ec;
  --hub-top: #ffffff;
  --hub-card: #ffffff;
  --hub-tile: #f6f2ec;
  --hub-line: #e2dad0;
  --hub-text: #1a1a1a;
  --hub-muted: #57524c;
  --hub-label: #645e57;
  --hub-letters: var(--hub-accent);
  --ustp-focus: var(--hub-accent);
  min-height: 100%;
  padding: 16px 16px 56px;
  background:
    radial-gradient(ellipse 70% 320px at 50% 0, color-mix(in srgb, var(--hub-bright) 12%, transparent), transparent),
    linear-gradient(var(--hub-top), var(--hub-page) 360px);
  color: var(--hub-text);
  font-family: var(--signal-body);
}
.hub--dark {
  --hub-page: #0b0b0b;
  --hub-top: #000000;
  --hub-card: #212121;
  --hub-tile: #2b2b2b;
  --hub-line: #424242;
  --hub-text: #f5f5f5;
  --hub-muted: #b8b8b8;
  --hub-label: #a6a6a6;
  --hub-letters: var(--hub-bright);
  --ustp-focus: var(--hub-bright);
}
.hub__column {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 560px;
  margin: 0 auto;
}

/* Share and theme, top right, out of the profile's way. */
.hub__tools {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: -16px;
}
.hub__tool {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: none;
  color: var(--hub-text);
  cursor: pointer;
  transition:
    border-color 200ms var(--signal-ease),
    background-color 200ms var(--signal-ease);
}
.hub__tool--boxed {
  border-color: var(--hub-line);
  background: var(--hub-card);
}
.hub__tool:hover {
  border-color: var(--hub-bright);
}

.hub__profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
/*
 * The cover banner: the column's width at 3:1, decorative (alt=""), with the logo's tile over its lower edge: half the
 * tile on the full column, less on a phone, where the banner is shorter.
 */
.hub__cover {
  width: 100%;
  aspect-ratio: 3 / 1;
  overflow: hidden;
  border: 1px solid var(--hub-line);
  border-radius: var(--signal-radius);
  background: var(--hub-card);
}
.hub__cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hub__logo--on-cover {
  position: relative;
  margin-top: clamp(-52px, -9vw, -32px);
}
.hub__logo {
  display: grid;
  place-items: center;
  width: 104px;
  height: 104px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--hub-bright) 45%, transparent);
  border-radius: 24px;
  background: var(--hub-card);
  box-shadow: 0 0 48px color-mix(in srgb, var(--hub-bright) 22%, transparent);
  color: var(--hub-letters);
  font-family: var(--signal-display);
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.hub__logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.hub__name {
  margin: 20px 0 0;
  font-family: var(--signal-display);
  font-size: clamp(2rem, 1.35rem + 3.2vw, 2.875rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.035em;
  overflow-wrap: anywhere;
}
.hub__tagline {
  margin: 12px 0 0;
  font-size: 1.125rem;
  line-height: 1.4;
}
.hub__bio {
  max-width: 30rem;
  margin: 8px 0 0;
  color: var(--hub-muted);
  font-size: 1rem;
  line-height: 1.55;
}

/* Round, monochrome, as many to a line as fit: four at 320 px. */
.hub__icons ul {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.hub__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--hub-line);
  border-radius: 50%;
  background: var(--hub-card);
  color: var(--hub-text);
  transition:
    transform 200ms var(--signal-ease),
    border-color 200ms var(--signal-ease),
    box-shadow 200ms var(--signal-ease);
}

.hub__card {
  border: 1px solid var(--hub-line);
  border-radius: var(--signal-radius);
  background: var(--hub-card);
  color: var(--hub-text);
}
/* A link that plays a video is a button, drawn as the cards and icons are. */
button.hub__link,
button.hub__icon {
  font: inherit;
  cursor: pointer;
  text-align: left;
}
button.hub__link {
  width: 100%;
}
.hub__player {
  width: min(960px, calc(100vw - 32px));
  max-width: none;
}
/* Over app.css's link colour for page content: cards and icons keep the text colour, so brand marks stay monochrome. */
.hub :is(a.hub__card, a.hub__icon) {
  color: var(--hub-text);
}
.hub a.hub__button {
  color: #fff;
}
.hub__tile {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--hub-tile);
}

.hub__discord {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
}
.hub__discord-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.hub__discord-title {
  margin: 0;
  font-family: var(--signal-display);
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.hub__live {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 0;
  color: var(--hub-muted);
  font-family: var(--signal-mono);
  font-size: 0.8125rem;
}
.hub__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hub-bright);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--hub-bright) 20%, transparent);
}
/* The accent under white text (4.5:1 or more, checked on save); hover glows rather than lightening the fill. */
.hub__button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 48px;
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--hub-accent);
  color: #fff;
  font-size: 1.0625rem;
  font-weight: 700;
  text-decoration: none;
  transition:
    transform 200ms var(--signal-ease),
    box-shadow 200ms var(--signal-ease);
}

.hub__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* A small mono label with a hairline to the column's edge. */
.hub__label {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 8px 0 0;
  color: var(--hub-label);
  font-family: var(--signal-mono);
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.hub__label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--hub-line);
}
.hub__links {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.hub__link {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 72px;
  padding: 12px 16px;
  text-decoration: none;
  transition:
    transform 200ms var(--signal-ease),
    border-color 200ms var(--signal-ease),
    box-shadow 200ms var(--signal-ease);
}
.hub__link-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.hub__link-title {
  font-family: var(--signal-display);
  font-size: 1.125rem;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.hub__link-subtitle {
  color: var(--hub-muted);
  font-size: 0.9375rem;
  line-height: 1.35;
}
.hub__arrow {
  flex: none;
  color: var(--hub-muted);
}
/* Starred: an accent edge and tile, so it reads first. */
.hub__link--featured {
  border-color: color-mix(in srgb, var(--hub-bright) 60%, var(--hub-line));
  background: linear-gradient(100deg, color-mix(in srgb, var(--hub-bright) 10%, var(--hub-card)), var(--hub-card) 60%);
}
.hub__link--featured .hub__tile {
  background: var(--hub-accent);
  color: #fff;
}

/* Hover and keyboard focus: a soft glow and a small lift. */
@media (any-hover: hover) {
  .hub__link:hover,
  .hub__icon:hover {
    border-color: var(--hub-bright);
    box-shadow: 0 6px 24px color-mix(in srgb, var(--hub-bright) 22%, transparent);
    transform: translateY(-2px);
  }
  .hub__button:hover {
    box-shadow: 0 6px 28px color-mix(in srgb, var(--hub-bright) 40%, transparent);
    transform: translateY(-1px);
  }
}
.hub__link:focus-visible,
.hub__icon:focus-visible {
  box-shadow: 0 6px 24px color-mix(in srgb, var(--hub-bright) 22%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .hub * {
    transition: none !important;
    transform: none !important;
  }
}
</style>
