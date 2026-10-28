<script setup lang="ts">
import { onMounted, ref } from 'vue';
const props = defineProps<{ title: string; name: string }>();
const image = ref('');
onMounted(async () => {
  try {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    url.searchParams.set('prop', 'pageimages');
    url.searchParams.set('pithumbsize', '240');
    url.searchParams.set('titles', props.title.replaceAll('_', ' '));
    const response = await fetch(url);
    if (!response.ok) return;
    const data: unknown = await response.json();
    const pages = (data as { query?: { pages?: Record<string, { thumbnail?: { source?: string } }> } }).query?.pages;
    image.value = Object.values(pages ?? {})[0]?.thumbnail?.source ?? '';
  } catch { /* Offline or unavailable images fall back to initials. */ }
});
</script>
<template>
  <div class="thinker-portrait">
    <img v-if="image" :src="image" :alt="`Portrait of ${name}`" loading="lazy" referrerpolicy="no-referrer" />
    <span v-else aria-hidden="true">{{ name.split(' ').map(part => part[0]).slice(0,2).join('') }}</span>
  </div>
</template>
<style scoped>
.thinker-portrait { width: 88px; height: 88px; flex: none; display: grid; place-items: center; border-radius: 12px; overflow: hidden; background: #ece8e2; color: #333; font-weight: 700; font-size: 1.4rem; }
.thinker-portrait img { width: 100%; height: 100%; object-fit: cover; }
</style>
