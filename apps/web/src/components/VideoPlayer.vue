<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { videoSrc, youtubeEmbedSrc, youtubeWatchUrl, type Video } from 'ustp-domain';

/**
 * A lesson's, post's or hub link's video (design §10.10): an upload plays from this site; a YouTube video loads
 * YouTube's privacy-enhanced player only once the viewer presses play, so nothing reaches YouTube before they choose to.
 * `autoplay` starts either at once, for a player opened by choosing it.
 */
const props = defineProps<{ video: Video; title: string; autoplay?: boolean }>();
const playing = ref(!!props.autoplay);
const frame = ref<HTMLIFrameElement | null>(null);
watch(
  () => props.video,
  () => (playing.value = !!props.autoplay),
);

async function play() {
  playing.value = true;
  await nextTick();
  frame.value?.focus();
}
</script>

<template>
  <figure class="video-player">
    <video
      v-if="video.kind === 'upload'"
      :key="video.videoId"
      class="video-player__frame"
      controls
      preload="metadata"
      playsinline
      :autoplay="autoplay"
      :src="videoSrc(video.videoId)"
      :aria-label="`Video: ${title}`"
    ></video>
    <template v-else>
      <iframe
        v-if="playing"
        ref="frame"
        class="video-player__frame"
        :src="youtubeEmbedSrc(video)"
        :title="`Video: ${title}`"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
      <button v-else type="button" class="video-player__frame video-player__start" @click="play">
        <q-icon name="play_circle" size="72px" />
        <span class="text-subtitle1 text-weight-medium">Play the video</span>
        <span class="text-caption">It plays from YouTube once you press play.</span>
      </button>
      <figcaption class="text-caption q-mt-xs">
        <a :href="youtubeWatchUrl(video)" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>
      </figcaption>
    </template>
  </figure>
</template>

<style scoped>
.video-player { margin: 0 0 16px; max-width: 960px; }
.video-player__frame { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 8px; background: #0b2948; }
.video-player__start { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: white; cursor: pointer; font: inherit; }
.video-player__start:hover .q-icon, .video-player__start:focus-visible .q-icon { transform: scale(1.08); }
.video-player__start:focus-visible { outline: 3px solid #ffb74d; outline-offset: 2px; }
</style>
