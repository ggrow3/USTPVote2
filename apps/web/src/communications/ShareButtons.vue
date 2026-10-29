<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import { mastodonHost, SHARE_TARGET_NAMES, SHARE_TARGETS, shareProblem, shareText, shareUrl, type Shareable, type ShareItem, type ShareTarget } from 'ustp-domain';
import { dialog } from '../dialogs.js';
import { countShare } from './api.js';
import { targetIcon } from './comms-text.js';

/**
 * Share buttons (design §10.9): each is a plain link to a site's own composer with the post filled in, opened in a new
 * tab; the person sharing presses Post there. Nothing from those sites loads here. Each press is counted, nothing more.
 */
const props = defineProps<{
  item: Shareable;
  /** What the presses are counted against. */
  countAs: ShareItem;
  /** Show under each button what the site will make of the post (too long, link only): for the share kit. */
  fit?: boolean;
}>();

const $q = useQuasar();
const MASTODON_KEY = 'ustp-mastodon-server';
const readServer = () => {
  try {
    return localStorage.getItem(MASTODON_KEY);
  } catch {
    return null;
  }
};
const mastodon = ref<string | null>(readServer());

const buttons = computed(() =>
  SHARE_TARGETS.map((target) => ({
    target,
    name: SHARE_TARGET_NAMES[target],
    icon: targetIcon(target),
    href: shareUrl(target, props.item, mastodon.value),
    problem: shareProblem(target, props.item),
  })).filter((b) => b.href || b.target === 'mastodon'),
);

const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

function pressed(target: ShareTarget) {
  countShare(props.countAs, target);
}

/** Mastodon has no one site: ask once for the sharer's own server, kept in this browser. */
function askServer() {
  dialog({
    title: 'Your Mastodon server',
    message: 'Mastodon has no single site, so posts are shared from your own server. Which is it? (For @you@mastodon.social, mastodon.social.)',
    prompt: { model: mastodon.value ?? '', type: 'text', isValid: (v: string) => mastodonHost(v) !== null },
    cancel: true,
  }).onOk((value: string) => {
    const host = mastodonHost(value);
    if (!host) return;
    mastodon.value = host;
    try {
      localStorage.setItem(MASTODON_KEY, host);
    } catch {
      // Not kept: it is asked again next time.
    }
    $q.notify({ message: `Now press Mastodon again to share from ${host}.` });
  });
}

async function copy() {
  const text = shareText('bluesky', props.item);
  try {
    await navigator.clipboard.writeText(text);
    $q.notify({ type: 'positive', message: 'Copied the text and link' });
  } catch {
    dialog({ title: 'Copy this', message: text });
  }
}

async function nativeShare() {
  try {
    await navigator.share({ title: props.item.title, text: shareText('x', props.item), ...(props.item.url && { url: props.item.url }) });
  } catch {
    // Cancelled, or the device could not share: nothing to do.
  }
}
</script>

<template>
  <div class="share-buttons" role="group" aria-label="Share">
    <div v-for="b in buttons" :key="b.target" class="share-buttons__item">
      <q-btn
        v-if="b.href"
        outline
        no-caps
        :icon="b.icon"
        :label="b.name"
        :href="b.href"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="`Share on ${b.name} (opens in a new tab)`"
        @click="pressed(b.target)"
      />
      <q-btn v-else outline no-caps :icon="b.icon" :label="b.name" aria-label="Share on Mastodon: choose your server first" @click="askServer" />
      <div v-if="fit && b.problem" class="text-caption text-orange-10 share-buttons__fit">{{ b.problem }}</div>
    </div>
    <q-btn flat no-caps icon="content_copy" label="Copy" @click="copy" />
    <q-btn v-if="canShare" flat no-caps icon="ios_share" label="More…" aria-label="Share with another app" @click="nativeShare" />
    <q-btn v-if="mastodon" flat dense no-caps size="sm" :label="`Mastodon: ${mastodon}`" aria-label="Change your Mastodon server" @click="askServer" />
  </div>
</template>

<style scoped>
.share-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
}
.share-buttons__item {
  display: flex;
  flex-direction: column;
  max-width: 220px;
}
.share-buttons__fit {
  margin-top: 2px;
}
</style>
