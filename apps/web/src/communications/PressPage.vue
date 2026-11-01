<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { videoDownloadSrc, type PublicBot, type PublicNewsSummary, type PublicPressKit } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import VideoPlayer from '../components/VideoPlayer.vue';
import NewsBody from './NewsBody.vue';
import { newsList, pressAssetUrl, pressPage } from './api.js';
import CommsNav from './CommsNav.vue';
import { BOT_SITE_NAMES, BOT_STATUS_LABELS, fileSize, longDate, siteIcon } from './comms-text.js';

/**
 * The Press page (design §10.9): for journalists, who to contact, the party's own description of itself, a few facts,
 * files to download, the latest releases, and every bot the party runs, so its accounts can be told from impostors.
 */
usePageTitle('Press');
const $q = useQuasar();
const kit = ref<PublicPressKit | null>(null);
const bots = ref<PublicBot[]>([]);
const latest = ref<PublicNewsSummary[]>([]);
const error = ref<string | null>(null);

const contact = computed(() => kit.value?.contact);
const hasContact = computed(() => !!contact.value && Object.values(contact.value).some(Boolean));
const empty = computed(
  () => !!kit.value && !kit.value.about && !hasContact.value && !kit.value.facts.length && !kit.value.assets.length && !kit.value.videos?.length,
);

async function copyAbout() {
  if (!kit.value) return;
  try {
    await navigator.clipboard.writeText(kit.value.about);
    $q.notify({ type: 'positive', message: 'Copied the description' });
  } catch {
    $q.notify({ type: 'negative', message: 'Could not copy: select the text and copy it instead.' });
  }
}

onMounted(async () => {
  try {
    const [page, news] = await Promise.all([pressPage(), newsList()]);
    kit.value = page.kit;
    bots.value = page.bots;
    latest.value = news.filter((n) => n.kind !== 'news').slice(0, 5);
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <div>
        <h1 class="text-h5 q-mb-xs">Press</h1>
        <div class="text-grey-7">For journalists: who to contact, the party in its own words, and files you may use.</div>
      </div>
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!kit" class="text-grey-7">Loading…</div>
      <template v-else>
        <div v-if="empty" class="text-grey-7">The press kit is being prepared.</div>

        <q-card v-if="hasContact" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Media contact</h2>
            <div v-if="contact!.name" class="text-weight-medium">{{ contact!.name }}</div>
            <div v-if="contact!.role" class="text-grey-7">{{ contact!.role }}</div>
            <div v-if="contact!.email"><q-icon name="mail" class="q-mr-xs" /><a :href="`mailto:${contact!.email}`">{{ contact!.email }}</a></div>
            <div v-if="contact!.phone"><q-icon name="call" class="q-mr-xs" /><a :href="`tel:${contact!.phone.replace(/[^+0-9]/g, '')}`">{{ contact!.phone }}</a></div>
            <div v-if="contact!.note" class="text-caption text-grey-7 q-mt-xs">{{ contact!.note }}</div>
          </q-card-section>
        </q-card>

        <q-card v-if="kit.about" flat bordered>
          <q-card-section>
            <div class="ustp-header">
              <h2 class="text-subtitle1">About the party</h2>
              <q-btn flat dense no-caps icon="content_copy" label="Copy" @click="copyAbout" />
            </div>
            <NewsBody :body="kit.about" />
          </q-card-section>
        </q-card>

        <q-card v-if="kit.facts.length" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Facts</h2>
            <dl class="ustp-facts">
              <template v-for="f in kit.facts" :key="f.label">
                <dt>{{ f.label }}</dt>
                <dd>{{ f.value }}</dd>
              </template>
            </dl>
          </q-card-section>
        </q-card>

        <q-card v-if="kit.assets.length" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Downloads</h2>
            <div class="press-assets">
              <a v-for="a in kit.assets" :key="a.id" class="press-asset" :href="pressAssetUrl(a.id)" :download="a.fileName">
                <img v-if="a.contentType !== 'application/pdf'" :src="pressAssetUrl(a.id)" :alt="''" loading="lazy" />
                <q-icon v-else name="picture_as_pdf" size="48px" />
                <span class="text-weight-medium">{{ a.title }}</span>
                <span v-if="a.description" class="text-caption">{{ a.description }}</span>
                <span class="text-caption text-grey-7">
                  {{ a.contentType === 'application/pdf' ? 'PDF' : a.contentType === 'image/png' ? 'PNG' : 'JPEG' }}<template v-if="a.width">, {{ a.width }}×{{ a.height }}</template>, {{ fileSize(a.bytes) }}
                </span>
              </a>
            </div>
          </q-card-section>
        </q-card>

        <q-card v-if="kit.videos?.length" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Videos</h2>
            <div v-for="v in kit.videos" :key="v.videoId" class="press-video">
              <VideoPlayer :video="{ kind: 'upload', videoId: v.videoId }" :title="v.title" />
              <div class="text-weight-medium">{{ v.title }}</div>
              <div v-if="v.description" class="text-caption">{{ v.description }}</div>
              <a :href="videoDownloadSrc(v.videoId)" :download="v.fileName" class="text-caption">
                Download {{ v.contentType === 'video/webm' ? 'WebM' : 'MP4' }}, {{ fileSize(v.bytes) }}
              </a>
            </div>
          </q-card-section>
        </q-card>

        <q-card v-if="latest.length" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Latest releases and statements</h2>
            <ul class="q-my-none">
              <li v-for="n in latest" :key="n.slug">
                <router-link :to="`/news/${n.slug}`">{{ n.title }}</router-link>
                <span class="text-grey-7"> · {{ longDate(n.publishedAt) }}</span>
              </li>
            </ul>
          </q-card-section>
        </q-card>

        <q-card v-if="bots.length" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">The party's bots</h2>
            <div class="text-caption text-grey-7">
              Every automated account the party runs. An account that claims to be the party's bot and is not listed here
              is not ours.
            </div>
          </q-card-section>
          <q-list separator>
            <q-item v-for="b in bots" :key="b.botId">
              <q-item-section avatar><q-icon :name="siteIcon(b.site)" /></q-item-section>
              <q-item-section>
                <q-item-label>
                  {{ b.name }}
                  <template v-if="b.handle">
                    · <a v-if="b.url" :href="b.url" target="_blank" rel="noopener noreferrer">{{ b.handle }}</a><template v-else>{{ b.handle }}</template>
                  </template>
                </q-item-label>
                <q-item-label caption>{{ BOT_SITE_NAMES[b.site] }}<template v-if="b.status !== 'active'"> · {{ BOT_STATUS_LABELS[b.status] }}</template></q-item-label>
                <q-item-label caption>{{ b.purpose }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.press-video {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 20px;
}
.press-video :deep(.video-player) {
  margin-bottom: 4px;
}
.press-assets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.press-asset {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.press-asset:hover,
.press-asset:focus-visible {
  border-color: var(--q-primary);
}
.press-asset img {
  width: 100%;
  height: 96px;
  object-fit: contain;
  background: repeating-conic-gradient(rgba(127, 127, 127, 0.15) 0% 25%, transparent 0% 50%) 50% / 16px 16px;
  border-radius: 4px;
}
</style>
